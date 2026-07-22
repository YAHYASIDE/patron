import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';

/**
 * AES-256-GCM for reversible secrets (provider API keys, delivered codes,
 * 2FA secrets). Format: base64(iv).base64(authTag).base64(ciphertext)
 *
 * Passwords are NOT encrypted — they are bcrypt-hashed and never recoverable.
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

  hashPassword(plain: string) {
    return bcrypt.hash(plain, 12);
  }

  verifyPassword(plain: string, hash: string) {
    return bcrypt.compare(plain, hash);
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
