import { createHash } from 'crypto';
import { UsdtNetwork } from '@prisma/client';
import { keccak256 } from './keccak';

/**
 * Destination checks for USDT. USDT sent to an address on the wrong chain is
 * lost, so a customer's address is refused unless it is well formed for the
 * network they chose, with its checksum when the format carries one.
 */

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_INDEX = new Map([...B58].map((ch, i) => [ch, i]));

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

export function base58Decode(text: string): Buffer | null {
  let n = 0n;
  for (const ch of text) {
    const v = B58_INDEX.get(ch);
    if (v === undefined) return null;
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of text) {
    if (ch !== '1') break;
    bytes.unshift(0);
  }
  return Buffer.from(bytes);
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest();

/** First four bytes of SHA-256(SHA-256(payload)). */
export function doubleSha256Checksum(payload: Uint8Array): Buffer {
  return sha256(sha256(payload)).subarray(0, 4);
}

/** TRON mainnet addresses: version byte 0x41, then 20 bytes, base58check ("T…", 34 chars). */
export const TRON_VERSION = 0x41;

export function tronAddressFromBytes(body20: Uint8Array): string {
  const payload = Buffer.concat([Buffer.from([TRON_VERSION]), Buffer.from(body20)]);
  return base58Encode(Buffer.concat([payload, doubleSha256Checksum(payload)]));
}

/** EIP-55: a hex letter is upper case when the matching nibble of keccak(lowercase hex) is ≥ 8. */
export function toChecksumAddress(address: string): string {
  const hex = address.replace(/^0x/i, '').toLowerCase();
  const hash = keccak256(hex).toString('hex');
  let out = '0x';
  for (let i = 0; i < hex.length; i++) out += parseInt(hash[i], 16) >= 8 ? hex[i].toUpperCase() : hex[i];
  return out;
}

export type AddressErrorCode =
  | 'USDT_ADDRESS_REQUIRED'
  | 'USDT_ADDRESS_INVALID'
  | 'USDT_ADDRESS_CHECKSUM'
  | 'USDT_ADDRESS_WRONG_NETWORK';

export type CheckResult<C extends string> =
  | { ok: true; value: string }
  | { ok: false; code: C; message: string };

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const TRON_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

function isTronAddress(address: string): boolean {
  if (!TRON_RE.test(address)) return false;
  const raw = base58Decode(address);
  if (!raw || raw.length !== 25 || raw[0] !== TRON_VERSION) return false;
  return doubleSha256Checksum(raw.subarray(0, 21)).equals(raw.subarray(21));
}

/** Which chain family a string looks like, to tell the customer they picked the wrong network. */
export function addressFamily(address: string): 'TRON' | 'EVM' | 'BITCOIN' | null {
  const a = address.trim();
  if (EVM_RE.test(a)) return 'EVM';
  if (TRON_RE.test(a)) return 'TRON';
  if (/^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(a)) return 'BITCOIN';
  return null;
}

/** A wallet address for the chosen network, returned in its canonical form (EIP-55 for EVM). */
export function validateAddress(network: UsdtNetwork, input: string | null | undefined): CheckResult<AddressErrorCode> {
  const address = (input ?? '').trim();
  if (!address) return { ok: false, code: 'USDT_ADDRESS_REQUIRED', message: 'Enter the wallet address to receive the USDT' };
  const family = addressFamily(address);

  if (network === 'TRC20') {
    if (family === 'EVM') {
      return { ok: false, code: 'USDT_ADDRESS_WRONG_NETWORK', message: 'This is a BEP20/ERC20 address (0x…). A TRC20 address starts with T.' };
    }
    if (family === 'BITCOIN') {
      return { ok: false, code: 'USDT_ADDRESS_WRONG_NETWORK', message: 'This is a Bitcoin address, not a TRC20 (TRON) address.' };
    }
    if (!TRON_RE.test(address)) return { ok: false, code: 'USDT_ADDRESS_INVALID', message: 'A TRC20 address starts with T and has 34 characters' };
    if (!isTronAddress(address)) {
      return { ok: false, code: 'USDT_ADDRESS_CHECKSUM', message: 'This TRC20 address has a typo (its checksum does not match)' };
    }
    return { ok: true, value: address };
  }

  // BEP20 and ERC20 share the Ethereum address format.
  if (family === 'TRON') {
    return { ok: false, code: 'USDT_ADDRESS_WRONG_NETWORK', message: `This is a TRC20 (TRON) address. A ${network} address starts with 0x.` };
  }
  if (family === 'BITCOIN') {
    return { ok: false, code: 'USDT_ADDRESS_WRONG_NETWORK', message: `This is a Bitcoin address, not a ${network} address.` };
  }
  if (!EVM_RE.test(address)) {
    return { ok: false, code: 'USDT_ADDRESS_INVALID', message: `A ${network} address is 0x followed by 40 hexadecimal characters` };
  }
  const hex = address.slice(2);
  if (/^0+$/.test(hex)) return { ok: false, code: 'USDT_ADDRESS_INVALID', message: 'The zero address burns whatever is sent to it' };
  const mixed = hex !== hex.toLowerCase() && hex !== hex.toUpperCase();
  const checksummed = toChecksumAddress(address);
  if (mixed && checksummed !== `0x${hex}`) {
    return { ok: false, code: 'USDT_ADDRESS_CHECKSUM', message: 'This address has a typo (its EIP-55 checksum does not match)' };
  }
  return { ok: true, value: checksummed };
}

export type BinanceErrorCode = 'USDT_BINANCE_ID_REQUIRED' | 'USDT_BINANCE_ID_INVALID';

/** A Binance internal-transfer recipient: the UID (digits), or the account's e-mail or phone. */
export function validateBinanceId(input: string | null | undefined): CheckResult<BinanceErrorCode> {
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, code: 'USDT_BINANCE_ID_REQUIRED', message: 'Enter your Binance ID (UID), e-mail or phone' };
  if (/^\d{6,12}$/.test(raw)) return { ok: true, value: raw };
  if (raw.includes('@')) {
    const email = raw.toLowerCase();
    if (email.length <= 120 && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) return { ok: true, value: email };
    return { ok: false, code: 'USDT_BINANCE_ID_INVALID', message: 'This e-mail address is not valid' };
  }
  const phone = raw.replace(/[\s-]/g, '');
  if (/^\+\d{8,15}$/.test(phone)) return { ok: true, value: phone };
  return {
    ok: false,
    code: 'USDT_BINANCE_ID_INVALID',
    message: 'Enter the Binance UID (digits only), or the e-mail or phone (+ country code) of the Binance account',
  };
}

export type TxidErrorCode = 'USDT_TXID_INVALID';

/**
 * The proof that staff sent the USDT: a TRON transaction hash (64 hex), an EVM
 * one (0x + 64 hex), or a Binance internal transfer id. Hashes are kept in
 * lower case so the same transfer cannot be recorded twice in two spellings.
 */
export function validateTxid(
  delivery: 'ONCHAIN' | 'BINANCE',
  network: UsdtNetwork | null,
  input: string | null | undefined,
): CheckResult<TxidErrorCode> {
  const txid = (input ?? '').trim();
  if (delivery === 'BINANCE') {
    if (/^[A-Za-z0-9-]{6,64}$/.test(txid)) return { ok: true, value: txid };
    return { ok: false, code: 'USDT_TXID_INVALID', message: 'Enter the Binance transfer id (6–64 letters or digits)' };
  }
  if (network === 'TRC20') {
    if (/^[0-9a-fA-F]{64}$/.test(txid)) return { ok: true, value: txid.toLowerCase() };
    return { ok: false, code: 'USDT_TXID_INVALID', message: 'A TRON transaction hash is 64 hexadecimal characters (no 0x)' };
  }
  if (/^0x[0-9a-fA-F]{64}$/.test(txid)) return { ok: true, value: txid.toLowerCase() };
  return { ok: false, code: 'USDT_TXID_INVALID', message: `A ${network ?? 'EVM'} transaction hash is 0x followed by 64 hexadecimal characters` };
}
