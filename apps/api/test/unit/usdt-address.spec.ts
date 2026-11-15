import { createHash, randomBytes } from 'crypto';
import { keccak256, sponge256 } from '../../src/modules/usdt/keccak';
import {
  addressFamily, base58Decode, base58Encode, toChecksumAddress, tronAddressFromBytes, validateAddress, validateBinanceId, validateTxid,
} from '../../src/modules/usdt/usdt-address';

/** Every address here is made from random bytes in the test: none belongs to anyone. */
const evmAddress = () => toChecksumAddress(`0x${randomBytes(20).toString('hex')}`);
const tronAddress = () => tronAddressFromBytes(randomBytes(20));

/** Flip the case of one letter in the hex part (a checksum typo). */
function breakCase(addr: string): string | null {
  for (let i = 2; i < addr.length; i++) {
    const ch = addr[i];
    if (/[a-f]/.test(ch)) return addr.slice(0, i) + ch.toUpperCase() + addr.slice(i + 1);
    if (/[A-F]/.test(ch)) return addr.slice(0, i) + ch.toLowerCase() + addr.slice(i + 1);
  }
  return null;
}

describe('keccak-256', () => {
  it('matches the published Keccak-256 vectors', () => {
    expect(keccak256('').toString('hex')).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    expect(keccak256('abc').toString('hex')).toBe('4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  });

  it('with the SHA3 padding byte agrees with Node’s sha3-256 on many lengths (the sponge is right)', () => {
    for (const len of [0, 1, 55, 135, 136, 137, 271, 272, 500, 1000]) {
      const input = randomBytes(len);
      expect(sponge256(input, 0x06).toString('hex')).toBe(createHash('sha3-256').update(input).digest('hex'));
    }
  });
});

describe('base58', () => {
  it('round-trips bytes, leading zeros included', () => {
    for (let i = 0; i < 20; i++) {
      const bytes = Buffer.concat([Buffer.alloc(i % 3), randomBytes(1 + i)]);
      expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
    }
  });

  it('refuses characters outside the alphabet', () => {
    expect(base58Decode('T0OIl')).toBeNull();
  });
});

describe('validateAddress — TRC20', () => {
  it('accepts generated TRON addresses (T…, 34 chars, valid checksum)', () => {
    for (let i = 0; i < 25; i++) {
      const a = tronAddress();
      expect(a).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
      expect(validateAddress('TRC20', a)).toEqual({ ok: true, value: a });
      expect(validateAddress('TRC20', `  ${a} `)).toEqual({ ok: true, value: a });
    }
  });

  it('refuses a one-character typo by its checksum', () => {
    const a = tronAddress();
    const i = 10;
    const swapped = a[i] === 'A' ? 'B' : 'A';
    const typo = a.slice(0, i) + swapped + a.slice(i + 1);
    expect(validateAddress('TRC20', typo)).toMatchObject({ ok: false, code: 'USDT_ADDRESS_CHECKSUM' });
  });

  it('refuses a base58check address with another version byte', () => {
    const payload = Buffer.concat([Buffer.from([0x42]), randomBytes(20)]);
    const check = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest().subarray(0, 4);
    const other = base58Encode(Buffer.concat([payload, check]));
    expect(validateAddress('TRC20', other).ok).toBe(false);
  });

  it('says so when an EVM or Bitcoin address is given for TRC20', () => {
    expect(validateAddress('TRC20', evmAddress())).toMatchObject({ ok: false, code: 'USDT_ADDRESS_WRONG_NETWORK' });
    expect(validateAddress('TRC20', `bc1q${'a'.repeat(38)}`)).toMatchObject({ ok: false, code: 'USDT_ADDRESS_WRONG_NETWORK' });
  });

  it('requires an address and a sane shape', () => {
    expect(validateAddress('TRC20', '')).toMatchObject({ ok: false, code: 'USDT_ADDRESS_REQUIRED' });
    expect(validateAddress('TRC20', undefined)).toMatchObject({ ok: false, code: 'USDT_ADDRESS_REQUIRED' });
    expect(validateAddress('TRC20', 'Tshort')).toMatchObject({ ok: false, code: 'USDT_ADDRESS_INVALID' });
  });
});

describe('validateAddress — BEP20 / ERC20', () => {
  it.each(['BEP20', 'ERC20'] as const)('%s accepts checksummed, all-lower and all-upper forms, and returns EIP-55', (net) => {
    for (let i = 0; i < 25; i++) {
      const a = evmAddress();
      expect(validateAddress(net, a)).toEqual({ ok: true, value: a });
      expect(validateAddress(net, a.toLowerCase())).toEqual({ ok: true, value: a });
      expect(validateAddress(net, `0x${a.slice(2).toUpperCase()}`)).toEqual({ ok: true, value: a });
    }
  });

  it('refuses mixed case that breaks the EIP-55 checksum', () => {
    let tested = 0;
    for (let i = 0; i < 10 && tested < 5; i++) {
      const a = evmAddress();
      const typo = breakCase(a);
      // a typo that leaves the hex all one case is not checksummed at all
      if (!typo || typo.slice(2) === typo.slice(2).toLowerCase() || typo.slice(2) === typo.slice(2).toUpperCase()) continue;
      expect(validateAddress('BEP20', typo)).toMatchObject({ ok: false, code: 'USDT_ADDRESS_CHECKSUM' });
      tested++;
    }
    expect(tested).toBeGreaterThan(0);
  });

  it('says so when a TRON or Bitcoin address is given for an EVM network', () => {
    expect(validateAddress('ERC20', tronAddress())).toMatchObject({ ok: false, code: 'USDT_ADDRESS_WRONG_NETWORK' });
    expect(validateAddress('BEP20', `3${'J'.repeat(30)}`)).toMatchObject({ ok: false, code: 'USDT_ADDRESS_WRONG_NETWORK' });
  });

  it('refuses bad shapes and the zero address', () => {
    expect(validateAddress('BEP20', '0x1234')).toMatchObject({ ok: false, code: 'USDT_ADDRESS_INVALID' });
    expect(validateAddress('BEP20', `0x${'g'.repeat(40)}`)).toMatchObject({ ok: false, code: 'USDT_ADDRESS_INVALID' });
    expect(validateAddress('ERC20', `0x${'0'.repeat(40)}`)).toMatchObject({ ok: false, code: 'USDT_ADDRESS_INVALID' });
  });

  it('tells the families apart', () => {
    expect(addressFamily(evmAddress())).toBe('EVM');
    expect(addressFamily(tronAddress())).toBe('TRON');
    expect(addressFamily('hello')).toBeNull();
  });
});

describe('validateBinanceId', () => {
  it('accepts a UID, an e-mail (lower-cased) or an international phone', () => {
    expect(validateBinanceId(' 12345678 ')).toEqual({ ok: true, value: '12345678' });
    expect(validateBinanceId('Someone@Example.TEST')).toEqual({ ok: true, value: 'someone@example.test' });
    expect(validateBinanceId('+222 2000-0000')).toEqual({ ok: true, value: '+22220000000' });
  });

  it('refuses the rest with a code', () => {
    expect(validateBinanceId('')).toMatchObject({ ok: false, code: 'USDT_BINANCE_ID_REQUIRED' });
    expect(validateBinanceId('12')).toMatchObject({ ok: false, code: 'USDT_BINANCE_ID_INVALID' });
    expect(validateBinanceId('a@b')).toMatchObject({ ok: false, code: 'USDT_BINANCE_ID_INVALID' });
    expect(validateBinanceId('2222000000000')).toMatchObject({ ok: false, code: 'USDT_BINANCE_ID_INVALID' });
    expect(validateBinanceId(evmAddress())).toMatchObject({ ok: false, code: 'USDT_BINANCE_ID_INVALID' });
  });
});

describe('validateTxid', () => {
  const hex64 = () => randomBytes(32).toString('hex');

  it('TRON: 64 hex, kept lower case; 0x form refused', () => {
    const h = hex64().toUpperCase();
    expect(validateTxid('ONCHAIN', 'TRC20', h)).toEqual({ ok: true, value: h.toLowerCase() });
    expect(validateTxid('ONCHAIN', 'TRC20', `0x${hex64()}`)).toMatchObject({ ok: false, code: 'USDT_TXID_INVALID' });
  });

  it('EVM: 0x + 64 hex, kept lower case', () => {
    const h = `0x${hex64().toUpperCase()}`;
    expect(validateTxid('ONCHAIN', 'BEP20', h)).toEqual({ ok: true, value: h.toLowerCase() });
    expect(validateTxid('ONCHAIN', 'ERC20', hex64())).toMatchObject({ ok: false, code: 'USDT_TXID_INVALID' });
    expect(validateTxid('ONCHAIN', null, '0x12')).toMatchObject({ ok: false, code: 'USDT_TXID_INVALID' });
  });

  it('Binance: an internal transfer id', () => {
    expect(validateTxid('BINANCE', null, '123456789012345678')).toEqual({ ok: true, value: '123456789012345678' });
    expect(validateTxid('BINANCE', null, 'x y')).toMatchObject({ ok: false, code: 'USDT_TXID_INVALID' });
    expect(validateTxid('BINANCE', null, undefined)).toMatchObject({ ok: false, code: 'USDT_TXID_INVALID' });
  });
});
