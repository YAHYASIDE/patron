import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';

/**
 * A valid argon2id hash used only to normalise timing on the login path.
 *
 * When an email does not exist we still run a verify against this so a
 * non-existent account takes the same time as a real one — otherwise login
 * doubles as an account-enumeration oracle. It must be argon2 (not bcrypt) so
 * the fake path costs the same as the common real path.
 */
const TIMING_NORMALISER_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$a9g41Y/c9CZdEwKADbxS2w$7HuPTaHBRVVlwZ3qSLKtLVHigLR5PhIdp6R9ukAC2Bk';

/**
 * AES-256-GCM for reversible secrets (provider API keys, delivered codes,
 * 2FA secrets). Format: base64(iv).base64(authTag).base64(ciphertext)
 *
 * Passwords are NOT encrypted — they are Argon2id-hashed and never recoverable.
 * Legacy bcrypt hashes are still verified (and transparently upgraded on the
 * next successful login), so no password reset is forced by the migration.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>('crypto.encryptionKey'), 'hex');
    if (this.key.length !== 32) {
      throw new InternalServerErrorException('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
    }
  }

  encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
  }

  decrypt(payload: string): string {
    const [iv, tag, data] = payload.split('.');
    if (!iv || !tag || !data) throw new InternalServerErrorException('Malformed ciphertext');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }

  /**
   * Hash a password with Argon2id (memory-hard, GPU-resistant). Parameters come
   * from @node-rs/argon2 defaults, which follow the OWASP recommendation
   * (m=19456 KiB, t=2, p=1).
   */
  hashPassword(plain: string): Promise<string> {
    return argon2Hash(plain);
  }

  /**
   * Verify a password against either an Argon2 or a legacy bcrypt hash, routing
   * by the encoded prefix. `argon2.verify` throws on a non-argon2 string, so the
   * algorithm must be selected up front rather than caught.
   */
  async verifyPassword(plain: string, hash: string): Promise<boolean> {
    try {
      if (hash.startsWith('$argon2')) return await argon2Verify(hash, plain);
      if (hash.startsWith('$2')) return await bcrypt.compare(plain, hash);
      return false;
    } catch {
      return false;
    }
  }

  /**
   * True when a stored hash is not Argon2id — i.e. a legacy bcrypt hash that
   * should be re-hashed after the next successful verification.
   */
  passwordNeedsRehash(hash: string): boolean {
    return !hash.startsWith('$argon2id');
  }

  /**
   * Constant-work verify for the "email not found" branch of login, so a
   * missing account is indistinguishable from a wrong password by timing.
   */
  fakeVerify(plain: string): Promise<boolean> {
    return this.verifyPassword(plain, TIMING_NORMALISER_HASH);
  }

  /** Refresh tokens and OTPs are stored as SHA-256 digests, never raw. */
  sha256(value: string) {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  /**
   * Constant-time comparison for anything an attacker can submit repeatedly:
   * OTP digests, signatures, token hashes. Both sides are fixed-length hex, so
   * the practical leak is negligible — but "negligible" is not an argument
   * that survives a security audit.
   */
  timingSafeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  randomToken(bytes = 48) {
    return crypto.randomBytes(bytes).toString('base64url');
  }

  randomNumericCode(digits = 6) {
    const max = 10 ** digits;
    return (crypto.randomInt(0, max) + max).toString().slice(1);
  }
}
