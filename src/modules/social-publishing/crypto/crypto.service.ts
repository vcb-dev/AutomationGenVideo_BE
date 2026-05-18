import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';

const DEFAULT_KEY = 'vcb-social-default-key-32chars!!';

@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly algorithm = 'aes-256-gcm';
  private readonly logger = new Logger(CryptoService.name);

  // Cache key để tránh gọi scryptSync (slow by design) mỗi lần encrypt/decrypt
  private _cachedKey: Buffer | null = null;
  private _cachedSecret: string | null = null;
  private _cachedSalt: string | null = null;

  // Cache fallback keys
  private _fallbackKeys: Buffer[] | null = null;

  onModuleInit() {
    const secret = process.env.SOCIAL_TOKEN_SECRET;
    const isDefault = !secret || secret === DEFAULT_KEY;
    if (isDefault) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          '⛔ SOCIAL_TOKEN_SECRET chưa được đặt. Từ chối khởi động trong môi trường production. ' +
          'Hãy đặt SOCIAL_TOKEN_SECRET trong .env với chuỗi ngẫu nhiên >= 32 ký tự.',
        );
      }
      this.logger.warn(
        '⚠️  SOCIAL_TOKEN_SECRET chưa được đặt hoặc đang dùng default key. ' +
        'Hãy đặt SOCIAL_TOKEN_SECRET trong .env với chuỗi ngẫu nhiên >= 32 ký tự.',
      );
    }
    if (!process.env.SOCIAL_TOKEN_SALT) {
      this.logger.warn('⚠️  SOCIAL_TOKEN_SALT chưa được đặt — đang dùng salt mặc định. Hãy đặt SOCIAL_TOKEN_SALT trong .env.');
    }
  }

  private get key(): Buffer {
    const secret = process.env.SOCIAL_TOKEN_SECRET || process.env.JWT_SECRET || DEFAULT_KEY;
    const salt = process.env.SOCIAL_TOKEN_SALT || 'vcb-salt';
    if (this._cachedKey && this._cachedSecret === secret && this._cachedSalt === salt) {
      return this._cachedKey;
    }
    this._cachedKey = crypto.scryptSync(secret, salt, 32) as Buffer;
    this._cachedSecret = secret;
    this._cachedSalt = salt;
    return this._cachedKey;
  }

  /**
   * Các key cũ để thử khi decrypt fail với key hiện tại.
   * Đảm bảo tương thích ngược khi SOCIAL_TOKEN_SECRET bị thay đổi.
   */
  private get fallbackKeys(): Buffer[] {
    if (this._fallbackKeys) return this._fallbackKeys;
    const jwtSecret = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';
    const candidates = [
      { secret: jwtSecret,                                                                     salt: 'vcb-salt-production-2024' },
      { secret: jwtSecret,                                                                     salt: 'vcb-salt' },
      { secret: 'B5d6F8gH2jK4mN6pQ8rT0vW2xZ4aC6eG8iK0mN2pQ4rT6vW8xZ0aC2eG4iK6mN8p',         salt: 'vcb-salt-production-2024' },
      { secret: 'B5d6F8gH2jK4mN6pQ8rT0vW2xZ4aC6eG8iK0mN2pQ4rT6vW8xZ0aC2eG4iK6mN8p',         salt: 'vcb-salt' },
      { secret: DEFAULT_KEY,                                                                   salt: 'vcb-salt' },
      { secret: DEFAULT_KEY,                                                                   salt: 'vcb-salt-production-2024' },
    ];
    this._fallbackKeys = candidates.map(c => crypto.scryptSync(c.secret, c.salt, 32) as Buffer);
    return this._fallbackKeys;
  }

  private tryDecrypt(ciphertext: string, key: Buffer): string | null {
    try {
      const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const encrypted = Buffer.from(encryptedHex, 'hex');
      const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
      decipher.setAuthTag(authTag);
      return decipher.update(encrypted) + decipher.final('utf8');
    } catch {
      return null;
    }
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(ciphertext: string): string {
    if (!ciphertext || !ciphertext.includes(':')) return ciphertext;

    // Thử key hiện tại trước
    const result = this.tryDecrypt(ciphertext, this.key);
    if (result !== null) return result;

    // Thử fallback keys (token được mã hóa bằng key cũ)
    for (const fallbackKey of this.fallbackKeys) {
      const fallbackResult = this.tryDecrypt(ciphertext, fallbackKey);
      if (fallbackResult !== null) {
        this.logger.warn('[Crypto] Decrypted using fallback key — token should be re-encrypted on next reconnect');
        return fallbackResult;
      }
    }

    this.logger.error('[Crypto] Decryption failed with all keys (key mismatch or corrupted data)');
    throw new Error('Không thể giải mã token (Khóa bảo mật không khớp). Vui lòng vào mục Tài khoản ngắt kết nối và kết nối lại.');
  }
}
