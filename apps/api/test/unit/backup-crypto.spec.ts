import { randomBytes, randomUUID } from 'crypto';
import {
  assertPassphrase, BackupCryptoError, decryptBackup, DEFAULT_SCRYPT, encryptWithKey, encryptWithPassphrase, isEncryptedBackup,
  parseBackupKey, PATRONBAK_MAGIC, readBackupFile, readHeader, ScryptParams, sha256Hex,
} from '../../src/modules/admin-tools/backup-crypto';

/** Cheap scrypt settings so the suite stays fast; the default is tested once. */
const FAST: ScryptParams = { N: 2 ** 14, r: 8, p: 1 };
const passphrase = () => `test-${randomUUID()}`;
const plain = Buffer.from(JSON.stringify({ version: 3, exportedAt: '2026-10-20T00:00:00.000Z', counts: {}, tables: { note: 'نسخة' } }));

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof BackupCryptoError ? e.code : `other: ${(e as Error).message}`;
  }
  return 'no error';
};

describe('backup-crypto', () => {
  it('locks with a passphrase and opens only with the same one', async () => {
    const pw = passphrase();
    const file = await encryptWithPassphrase(plain, pw, FAST);

    expect(isEncryptedBackup(file)).toBe(true);
    expect(file.toString('latin1')).not.toContain('نسخة');
    expect(file.toString('latin1')).not.toContain(pw);
    const { header } = readHeader(file);
    expect(header).toMatchObject({ magic: PATRONBAK_MAGIC, v: 1, alg: 'aes-256-gcm', compression: 'gzip', kdf: { name: 'scrypt', ...FAST } });

    expect(Buffer.compare(await decryptBackup(file, { passphrase: pw }), plain)).toBe(0);
    expect(await code(decryptBackup(file, { passphrase: `${pw}x` }))).toBe('WRONG_PASSPHRASE_OR_DAMAGED');
    expect(await code(decryptBackup(file, {}))).toBe('PASSPHRASE_REQUIRED');
  });

  it('uses a fresh salt and IV each time', async () => {
    const pw = passphrase();
    const [a, b] = await Promise.all([encryptWithPassphrase(plain, pw, FAST), encryptWithPassphrase(plain, pw, FAST)]);
    const ha = readHeader(a).header;
    const hb = readHeader(b).header;
    expect(ha.iv).not.toBe(hb.iv);
    expect((ha.kdf as { salt: string }).salt).not.toBe((hb.kdf as { salt: string }).salt);
  });

  it('uses OWASP scrypt settings by default', async () => {
    expect(DEFAULT_SCRYPT).toEqual({ N: 131072, r: 8, p: 1 });
    const pw = passphrase();
    const file = await encryptWithPassphrase(plain, pw);
    expect(readHeader(file).header.kdf).toMatchObject({ name: 'scrypt', N: 131072, r: 8, p: 1 });
    expect(Buffer.compare(await decryptBackup(file, { passphrase: pw }), plain)).toBe(0);
  });

  it('refuses a short or missing passphrase', async () => {
    expect(() => assertPassphrase('short-11ch!')).toThrow('at least 12');
    expect(() => assertPassphrase('')).toThrow('required');
    expect(() => assertPassphrase(undefined)).toThrow('required');
    expect(() => assertPassphrase('١٢٣٤٥٦٧٨٩٠١٢')).not.toThrow(); // counted in characters, not bytes
    expect(await code(encryptWithPassphrase(plain, 'too-short', FAST))).toBe('PASSPHRASE_TOO_SHORT');
  });

  it('locks with the deployment key and tells a wrong key from a damaged file', async () => {
    const hex = randomBytes(32).toString('hex');
    const file = await encryptWithKey(plain, parseBackupKey(hex)!);
    expect(readHeader(file).header.kdf.name).toBe('key');
    expect(file.toString('latin1')).not.toContain(hex);

    expect(Buffer.compare(await decryptBackup(file, { keyHex: hex }), plain)).toBe(0);
    expect(await code(decryptBackup(file, { keyHex: randomBytes(32).toString('hex') }))).toBe('WRONG_KEY');
    expect(await code(decryptBackup(file, {}))).toBe('KEY_REQUIRED');

    const damaged = Buffer.from(file);
    damaged[damaged.length - 20] ^= 0xff;
    expect(await code(decryptBackup(damaged, { keyHex: hex }))).toBe('WRONG_PASSPHRASE_OR_DAMAGED');
    expect(await code(encryptWithKey(plain, Buffer.alloc(16)))).toBe('BACKUP_KEY_INVALID');
  });

  it('authenticates the header: weakening its settings breaks the file', async () => {
    const pw = passphrase();
    const file = await encryptWithPassphrase(plain, pw, { N: 2 ** 15, r: 8, p: 1 });
    const nl = file.indexOf(0x0a);
    const header = JSON.parse(file.subarray(0, nl).toString());
    header.kdf.N = 2 ** 14;
    const forged = Buffer.concat([Buffer.from(JSON.stringify(header)), file.subarray(nl)]);
    expect(await code(decryptBackup(forged, { passphrase: pw }))).toBe('WRONG_PASSPHRASE_OR_DAMAGED');
  });

  it('refuses headers that are not ours or ask for too much memory', async () => {
    const pw = passphrase();
    const file = await encryptWithPassphrase(plain, pw, FAST);
    const nl = file.indexOf(0x0a);
    const header = JSON.parse(file.subarray(0, nl).toString());
    const withHeader = (h: unknown) => Buffer.concat([Buffer.from(JSON.stringify(h)), file.subarray(nl)]);

    expect(await code(decryptBackup(withHeader({ ...header, kdf: { ...header.kdf, N: 2 ** 22 } }), { passphrase: pw }))).toBe('NOT_A_BACKUP');
    expect(await code(decryptBackup(withHeader({ ...header, kdf: { ...header.kdf, N: 2 ** 20, r: 16 } }), { passphrase: pw }))).toBe('NOT_A_BACKUP');
    expect(await code(decryptBackup(withHeader({ ...header, v: 9 }), { passphrase: pw }))).toBe('NOT_A_BACKUP');
    expect(await code(decryptBackup(Buffer.from('{"magic":"PATRONBAK"'), { passphrase: pw }))).toBe('NOT_A_BACKUP');
    expect(await code(decryptBackup(Buffer.from('{not json}\nxx'), { passphrase: pw }))).toBe('NOT_A_BACKUP');
    expect(await code(decryptBackup(Buffer.concat([file.subarray(0, nl + 1), Buffer.alloc(3)]), { passphrase: pw }))).toBe('WRONG_PASSPHRASE_OR_DAMAGED');
  });

  it('reads plain JSON and encrypted files alike', async () => {
    const hex = randomBytes(32).toString('hex');
    expect(await readBackupFile(plain)).toEqual({ encrypted: false, data: JSON.parse(plain.toString()) });
    const enc = await encryptWithKey(plain, parseBackupKey(hex)!);
    expect(await readBackupFile(enc, { keyHex: hex })).toEqual({ encrypted: true, data: JSON.parse(plain.toString()) });
    expect(await code(readBackupFile(Buffer.from('hello')))).toBe('NOT_A_BACKUP');
  });

  it('validates BACKUP_ENCRYPTION_KEY', () => {
    expect(parseBackupKey(undefined)).toBeNull();
    expect(parseBackupKey('')).toBeNull();
    expect(parseBackupKey(` ${'ab'.repeat(32)} `)).toHaveLength(32);
    expect(() => parseBackupKey('xyz')).toThrow('64 hex');
  });

  it('hashes with SHA-256', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
