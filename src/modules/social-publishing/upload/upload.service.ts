import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { GoogleDriveStorageService } from './google-drive-storage.service';
import * as path from 'path';
import * as fs from 'fs';

export const UPLOAD_DIR = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social');

@Injectable()
export class UploadService {
  static readonly ALLOWED_MIME_RE = /^(image\/(jpeg|png|gif|webp)|video\/mp4)$/;
  private readonly logger = new Logger(UploadService.name);

  private static readonly MIME_EXT_MAP: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
    'image/gif': '.gif', 'image/webp': '.webp', 'video/mp4': '.mp4',
  };

  constructor(
    private readonly googleDrive: GoogleDriveStorageService,
  ) {}

  generateFilename(originalname: string, mimeType?: string): string {
    const ext = (mimeType ? UploadService.MIME_EXT_MAP[mimeType] : null)
      || path.extname(originalname).toLowerCase()
      || '.bin';
    const base = path.basename(originalname, path.extname(originalname))
      .normalize('NFC')
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'media';
    return `${base}${ext}`;
  }

  async saveBuffer(buffer: Buffer, filename: string, mimetype: string, user?: any): Promise<string> {
    if (!this.googleDrive.isAvailable()) {
      this.logger.warn(`[saveBuffer] Google Drive chưa được cấu hình. Lưu cục bộ: ${filename}`);
      if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      const destPath = path.join(UPLOAD_DIR, filename);
      fs.writeFileSync(destPath, buffer);
      const base = process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
      return `${base}/api/social/media/${filename}`;
    }

    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const tempPath = path.join(UPLOAD_DIR, `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}_${filename}`);
    fs.writeFileSync(tempPath, buffer);
    this.logger.log(`[saveBuffer] Bắt đầu upload ${filename} (${(buffer.length / 1024 / 1024).toFixed(2)}MB) lên Drive`);
    try {
      const uploaded = await this.googleDrive.uploadFromPath(tempPath, filename, mimetype, user);
      this.logger.log(`[saveBuffer] ✅ Upload thành công: ${filename} → fileId=${uploaded.fileId}`);
      return uploaded.url;
    } catch (err: any) {
      this.logger.error(`[saveBuffer] ❌ Upload thất bại ${filename}: ${err.message}`, err.stack);
      throw err;
    } finally {
      try { fs.unlinkSync(tempPath); } catch (e: any) { this.logger.warn(`[saveBuffer] Không xóa được temp file ${tempPath}: ${e.message}`); }
    }
  }

  /** Upload thẳng từ disk path (dùng với diskStorage — tránh load file vào RAM) */
  async saveFromDisk(filePath: string, filename: string, mimetype: string, user?: any): Promise<string> {
    if (!this.googleDrive.isAvailable()) {
      this.logger.warn(`[saveFromDisk] Google Drive chưa được cấu hình. Lưu cục bộ: ${filename}`);
      const destPath = path.join(UPLOAD_DIR, filename);
      try {
        fs.renameSync(filePath, destPath);
      } catch (err: any) {
        this.logger.error(`[saveFromDisk] ❌ Không thể rename file từ ${filePath} sang ${destPath}: ${err.message}`);
        try {
          fs.copyFileSync(filePath, destPath);
          fs.unlinkSync(filePath);
        } catch (copyErr: any) {
          try { fs.unlinkSync(filePath); } catch {}
          throw new BadRequestException(`Không thể lưu file cục bộ: ${copyErr.message}`);
        }
      }
      const base = process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
      return `${base}/api/social/media/${filename}`;
    }

    const sizeMB = (() => { try { return (fs.statSync(filePath).size / 1024 / 1024).toFixed(2); } catch { return '?'; } })();
    this.logger.log(`[saveFromDisk] Bắt đầu upload ${filename} (${sizeMB}MB, ${mimetype}) lên Drive`);

    try {
      const uploaded = await this.googleDrive.uploadFromPath(filePath, filename, mimetype, user);
      this.logger.log(`[saveFromDisk] ✅ Upload thành công: ${filename} → fileId=${uploaded.fileId}`);
      return uploaded.url;
    } catch (err: any) {
      this.logger.error(`[saveFromDisk] ❌ Upload thất bại ${filename}: ${err.message}`, err.stack);
      throw err;
    } finally {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }
}


