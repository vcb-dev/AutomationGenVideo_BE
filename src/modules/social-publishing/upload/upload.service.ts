import { Injectable, BadRequestException } from '@nestjs/common';
import { GoogleDriveStorageService } from './google-drive-storage.service';
import * as path from 'path';
import * as fs from 'fs';

export const UPLOAD_DIR = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social');

@Injectable()
export class UploadService {
  static readonly ALLOWED_MIME_RE = /^(image\/(jpeg|png|gif|webp)|video\/mp4)$/;

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
    return `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
  }

  async saveBuffer(buffer: Buffer, filename: string, mimetype: string, user?: any): Promise<string> {
    if (!this.googleDrive.isAvailable()) {
      throw new BadRequestException('Google Drive storage chua duoc cau hinh');
    }

    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const tempPath = path.join(UPLOAD_DIR, `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}_${filename}`);
    fs.writeFileSync(tempPath, buffer);
    try {
      const uploaded = await this.googleDrive.uploadFromPath(tempPath, filename, mimetype, user);
      return uploaded.url;
    } finally {
      try { fs.unlinkSync(tempPath); } catch (e: any) { console.warn(`[UploadService] Không xóa được temp file ${tempPath}: ${e.message}`); }
    }
  }

  /** Upload thẳng từ disk path (dùng với diskStorage — tránh load file vào RAM) */
  async saveFromDisk(filePath: string, filename: string, mimetype: string, user?: any): Promise<string> {
    if (!this.googleDrive.isAvailable()) {
      throw new BadRequestException('Google Drive storage chua duoc cau hinh');
    }
    try {
      const uploaded = await this.googleDrive.uploadFromPath(filePath, filename, mimetype, user);
      return uploaded.url;
    } finally {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }
}


