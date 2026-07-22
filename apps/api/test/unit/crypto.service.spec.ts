import * as bcrypt from 'bcryptjs';
import { CryptoService } from '../../src/common/crypto/crypto.service';

// 32 bytes as hex — required by the constructor for the AES key.
const KEY = 'a'.repeat(64);
const config = { getOrThrow: () => KEY } as any;

describe('CryptoService — password hashing (Argon2id)', () => {
  const crypto = new CryptoService(config);

  it('hashes with Argon2id and verifies the correct password', async () => {
    const hash = await crypto.hashPassword('Str0ngPass!');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await crypto.verifyPassword('Str0ngPass!', hash)).toBe(true);
    expect(await crypto.verifyPassword('WrongPass!', hash)).toBe(false);
  });

  it('still verifies legacy bcrypt hashes (no forced reset on migration)', async () => {
    const legacy = await bcrypt.hash('Str0ngPass!', 10);
    expect(legacy.startsWith('$2')).toBe(true);
    expect(await crypto.verifyPassword('Str0ngPass!', legacy)).toBe(true);
    expect(await crypto.verifyPassword('nope', legacy)).toBe(false);
  });

  it('flags a legacy hash for rehash but not an Argon2id hash', async () => {
    const legacy = await bcrypt.hash('x', 10);
    const modern = await crypto.hashPassword('x');
    expect(crypto.passwordNeedsRehash(legacy)).toBe(true);
    expect(crypto.passwordNeedsRehash(modern)).toBe(false);
  });

  it('fakeVerify always resolves false without throwing (timing normaliser)', async () => {
    await expect(crypto.fakeVerify('anything')).resolves.toBe(false);
  });

  it('returns false for a malformed hash rather than throwing', async () => {
    await expect(crypto.verifyPassword('x', 'not-a-real-hash')).resolves.toBe(false);
  });
});
