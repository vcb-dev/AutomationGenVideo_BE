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
    // SOCIAL_TOKEN_SALT nên được đặt trong .env — salt mặc định 'vcb-salt' vẫn dùng để backward-compat
    const salt = process.env.SOCIAL_TOKEN_SALT || 'vcb-salt';
    // Chỉ re-derive nếu secret/salt thay đổi (env var hot-reload) — tránh gọi scryptSync mỗi lần
    if (this._cachedKey && this._cachedSecret === secret && this._cachedSalt === salt) {
      return this._cachedKey;
    }
    this._cachedKey = crypto.scryptSync(secret, salt, 32) as Buffer;
    this._cachedSecret = secret;
    this._cachedSalt = salt;
    return this._cachedKey;
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(ciphertext: string): string {
    try {
      if (!ciphertext || !ciphertext.includes(':')) return ciphertext;
      const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const encrypted = Buffer.from(encryptedHex, 'hex');
      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(authTag);
      return decipher.update(encrypted) + decipher.final('utf8');
    } catch (err: any) {
      this.logger.error(`[Crypto] Decryption failed (key mismatch or corrupted data): ${err.message}`);
      throw new Error('Không thể giải mã token (Khóa bảo mật không khớp). Vui lòng vào mục Tài khoản ngắt kết nối và kết nối lại.');
    }
  }
}
