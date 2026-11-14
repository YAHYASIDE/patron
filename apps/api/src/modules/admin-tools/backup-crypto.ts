import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCb, ScryptOptions } from 'crypto';
import { promisify } from 'util';
import { gunzip as gunzipCb, gzip as gzipCb } from 'zlib';

/**
 * Encrypted backup files (`.patronbak`).
 *
 * Layout: one line of JSON (the header: magic, format version, how the key is
 * made, salt, IV), a newline, then the AES-256-GCM ciphertext of the gzipped
 * backup JSON, then the 16-byte GCM tag. The header is authenticated as
 * additional data, so changing a byte of it (say, weaker scrypt parameters)
 * makes the file fail to open rather than open differently.
 *
 * Two ways to make the key, and the key is never inside the file:
 *  - `scrypt`: from a passphrase the owner types when downloading (random salt
 *    per file). Nobody can open the file without the passphrase — not even us.
 *  - `key`: the 32-byte BACKUP_ENCRYPTION_KEY of the deployment, for scheduled
 *    copies made while nobody is there to type a passphrase. The header holds a
 *    short HMAC of the key so a wrong key is told apart from a damaged file.
 */
export const PATRONBAK_MAGIC = 'PATRONBAK';
export const PATRONBAK_VERSION = 1;
export const PATRONBAK_EXT = '.patronbak';
export const MIN_PASSPHRASE_LENGTH = 12;

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/** OWASP's recommendation for scrypt: 128 MiB of memory, about half a second. */
export const DEFAULT_SCRYPT: ScryptParams = { N: 2 ** 17, r: 8, p: 1 };

/** What a file may ask for: a crafted header must not make the server spend gigabytes. */
const SCRYPT_LIMITS = { minLogN: 14, maxLogN: 20, maxR: 16, maxP: 4, maxMemBytes: 256 * 1024 * 1024 };
const MAX_HEADER_BYTES = 4096;
const TAG_BYTES = 16;
const KEY_CHECK_LABEL = 'patron-backup-key-check';

type Kdf = { name: 'scrypt'; N: number; r: number; p: number; salt: string } | { name: 'key'; check: string };

export interface PatronbakHeader {
  magic: typeof PATRONBAK_MAGIC;
  v: number;
  alg: 'aes-256-gcm';
  compression: 'gzip';
  kdf: Kdf;
  iv: string;
}

export type BackupCryptoCode =
  | 'PASSPHRASE_TOO_SHORT'
  | 'PASSPHRASE_REQUIRED'
  | 'KEY_REQUIRED'
  | 'BACKUP_KEY_INVALID'
  | 'WRONG_KEY'
  | 'WRONG_PASSPHRASE_OR_DAMAGED'
  | 'NOT_A_BACKUP';

/** A problem with an encrypted file or its secret; `code` is stable for the dashboard. */
export class BackupCryptoError extends Error {
  constructor(public readonly code: BackupCryptoCode, message: string) {
    super(message);
    this.name = 'BackupCryptoError';
  }
}

const scrypt = promisify(scryptCb) as (pw: string | Buffer, salt: Buffer, len: number, opts: ScryptOptions) => Promise<Buffer>;
const gzip = promisify(gzipCb);
const gunzip = promisify(gunzipCb);

/** Typed Unicode can be composed in two ways: the same passphrase must give the same key. */
const normalise = (passphrase: string) => passphrase.normalize('NFC');

export function assertPassphrase(passphrase: unknown): asserts passphrase is string {
  if (typeof passphrase !== 'string' || !passphrase) {
    throw new BackupCryptoError('PASSPHRASE_REQUIRED', 'A passphrase is required');
  }
  if ([...normalise(passphrase)].length < MIN_PASSPHRASE_LENGTH) {
    throw new BackupCryptoError('PASSPHRASE_TOO_SHORT', `The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
}

/** BACKUP_ENCRYPTION_KEY: 32 random bytes written as 64 hex characters. */
export function parseBackupKey(hex: string | undefined | null): Buffer | null {
  if (!hex) return null;
  const clean = hex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new BackupCryptoError('BACKUP_KEY_INVALID', 'BACKUP_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(clean, 'hex');
}

const keyCheck = (key: Buffer) => createHmac('sha256', key).update(KEY_CHECK_LABEL).digest('hex').slice(0, 16);

function scryptOptions({ N, r, p }: ScryptParams): ScryptOptions {
  // Node refuses above 32 MiB unless told: give it what these parameters need, with room
  return { N, r, p, maxmem: 256 * N * r + 1024 * 1024 };
}

function checkScryptParams({ N, r, p }: ScryptParams) {
  const logN = Math.log2(N);
  const ok =
    Number.isInteger(logN) && logN >= SCRYPT_LIMITS.minLogN && logN <= SCRYPT_LIMITS.maxLogN &&
    Number.isInteger(r) && r >= 1 && r <= SCRYPT_LIMITS.maxR &&
    Number.isInteger(p) && p >= 1 && p <= SCRYPT_LIMITS.maxP &&
    128 * N * r <= SCRYPT_LIMITS.maxMemBytes;
  if (!ok) throw new BackupCryptoError('NOT_A_BACKUP', 'The file asks for key settings this app does not accept');
}

async function seal(plain: Buffer, key: Buffer, kdf: Kdf): Promise<Buffer> {
  const iv = randomBytes(12);
  const header: PatronbakHeader = {
    magic: PATRONBAK_MAGIC, v: PATRONBAK_VERSION, alg: 'aes-256-gcm', compression: 'gzip', kdf, iv: iv.toString('base64'),
  };
  const head = Buffer.from(JSON.stringify(header), 'utf8');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(head);
  const body = Buffer.concat([cipher.update(await gzip(plain)), cipher.final()]);
  return Buffer.concat([head, Buffer.from('\n'), body, cipher.getAuthTag()]);
}

/** Encrypt with a key made from the owner's passphrase (scrypt, random salt). */
export async function encryptWithPassphrase(plain: Buffer, passphrase: string, params: ScryptParams = DEFAULT_SCRYPT): Promise<Buffer> {
  assertPassphrase(passphrase);
  const salt = randomBytes(16);
  const key = await scrypt(normalise(passphrase), salt, 32, scryptOptions(params));
  return seal(plain, key, { name: 'scrypt', ...params, salt: salt.toString('base64') });
}

/** Encrypt with the deployment's BACKUP_ENCRYPTION_KEY (scheduled copies). */
export async function encryptWithKey(plain: Buffer, key: Buffer): Promise<Buffer> {
  if (key.length !== 32) throw new BackupCryptoError('BACKUP_KEY_INVALID', 'The backup key must be 32 bytes');
  return seal(plain, key, { name: 'key', check: keyCheck(key) });
}

/** True when the bytes start like a `.patronbak` file. */
export function isEncryptedBackup(buf: Buffer): boolean {
  return buf.subarray(0, 32).toString('latin1').includes(`"magic":"${PATRONBAK_MAGIC}"`);
}

/** The header and where the ciphertext starts; throws NOT_A_BACKUP on anything else. */
export function readHeader(buf: Buffer): { header: PatronbakHeader; headBytes: Buffer; body: Buffer; tag: Buffer } {
  const nl = buf.subarray(0, MAX_HEADER_BYTES + 1).indexOf(0x0a);
  if (nl <= 0) throw new BackupCryptoError('NOT_A_BACKUP', 'Not an encrypted patron backup');
  const headBytes = buf.subarray(0, nl);
  let header: PatronbakHeader;
  try {
    header = JSON.parse(headBytes.toString('utf8')) as PatronbakHeader;
  } catch {
    throw new BackupCryptoError('NOT_A_BACKUP', 'Not an encrypted patron backup');
  }
  const kdfName = header?.kdf?.name;
  if (
    header?.magic !== PATRONBAK_MAGIC || header.v !== PATRONBAK_VERSION || header.alg !== 'aes-256-gcm' ||
    header.compression !== 'gzip' || typeof header.iv !== 'string' || (kdfName !== 'scrypt' && kdfName !== 'key')
  ) {
    throw new BackupCryptoError('NOT_A_BACKUP', 'Not an encrypted patron backup, or one made by a newer version');
  }
  const rest = buf.subarray(nl + 1);
  if (rest.length < TAG_BYTES) throw new BackupCryptoError('WRONG_PASSPHRASE_OR_DAMAGED', 'The file is cut short');
  return { header, headBytes, body: rest.subarray(0, rest.length - TAG_BYTES), tag: rest.subarray(rest.length - TAG_BYTES) };
}

export interface DecryptSecrets {
  passphrase?: string | null;
  /** BACKUP_ENCRYPTION_KEY as 64 hex characters. */
  keyHex?: string | null;
}

/** Open a `.patronbak` file; returns the backup JSON bytes. */
export async function decryptBackup(buf: Buffer, secrets: DecryptSecrets): Promise<Buffer> {
  const { header, headBytes, body, tag } = readHeader(buf);
  let key: Buffer;
  if (header.kdf.name === 'scrypt') {
    if (!secrets.passphrase) {
      throw new BackupCryptoError('PASSPHRASE_REQUIRED', 'This file was encrypted with a passphrase: give the passphrase');
    }
    const { N, r, p, salt } = header.kdf;
    checkScryptParams({ N, r, p });
    key = await scrypt(normalise(secrets.passphrase), Buffer.from(salt, 'base64'), 32, scryptOptions({ N, r, p }));
  } else {
    const k = parseBackupKey(secrets.keyHex);
    if (!k) throw new BackupCryptoError('KEY_REQUIRED', 'This file was encrypted with BACKUP_ENCRYPTION_KEY: give that key');
    if (keyCheck(k) !== header.kdf.check) {
      throw new BackupCryptoError('WRONG_KEY', 'This file was encrypted with a different BACKUP_ENCRYPTION_KEY');
    }
    key = k;
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'base64'));
    decipher.setAAD(headBytes);
    decipher.setAuthTag(tag);
    const zipped = Buffer.concat([decipher.update(body), decipher.final()]);
    return await gunzip(zipped);
  } catch {
    throw new BackupCryptoError(
      'WRONG_PASSPHRASE_OR_DAMAGED',
      header.kdf.name === 'scrypt' ? 'Wrong passphrase, or the file is damaged' : 'The file is damaged',
    );
  }
}

/** A backup file as bytes (plain JSON or `.patronbak`) → the parsed backup object. */
export async function readBackupFile(buf: Buffer, secrets: DecryptSecrets = {}): Promise<{ encrypted: boolean; data: unknown }> {
  const encrypted = isEncryptedBackup(buf);
  const json = encrypted ? await decryptBackup(buf, secrets) : buf;
  try {
    return { encrypted, data: JSON.parse(json.toString('utf8')) };
  } catch {
    throw new BackupCryptoError('NOT_A_BACKUP', 'The file is neither a patron backup (JSON) nor an encrypted one (.patronbak)');
  }
}

export const sha256Hex = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');
