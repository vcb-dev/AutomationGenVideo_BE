import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseStorageService } from './supabase-storage.service';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';

export const UPLOAD_DIR = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social');

@Injectable()
export class UploadService {
  static readonly ALLOWED_MIME_RE = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|quicktime|x-msvideo|x-matroska|webm))$/;
  static readonly MAX_BYTES = 500 * 1024 * 1024;

  private static readonly MIME_EXT_MAP: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
    'image/gif': '.gif', 'image/webp': '.webp', 'video/mp4': '.mp4',
    'video/quicktime': '.mov', 'video/x-msvideo': '.avi', 'video/webm': '.webm',
  };

  constructor(private readonly storage: SupabaseStorageService) {}

  generateFilename(originalname: string, mimeType?: string): string {
    const ext = (mimeType ? UploadService.MIME_EXT_MAP[mimeType] : null)
      || path.extname(originalname).toLowerCase()
      || '.bin';
    return `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
  }

  async saveBuffer(buffer: Buffer, filename: string, mimetype: string, baseUrl: string): Promise<string> {
    if (this.storage.isAvailable()) {
      return this.storage.upload(buffer, filename, mimetype);
    }
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
    return `${baseUrl}/api/social/media/${filename}`;
  }

  async downloadFromDrive(fileId: string, accessToken: string): Promise<Buffer> {
    const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const headers = { Authorization: `Bearer ${accessToken}` };

    const headRes = await axios.head(driveUrl, { headers, timeout: 15_000 }).catch(() => null);
    const contentLength = headRes ? parseInt(headRes.headers['content-length'] || '0', 10) : 0;
    if (contentLength > UploadService.MAX_BYTES) {
      throw new BadRequestException('File vượt quá giới hạn 500MB');
    }

    const response = await axios.get(driveUrl, {
      headers,
      responseType: 'arraybuffer',
      timeout: 120_000,
      maxContentLength: UploadService.MAX_BYTES,
    });
    return Buffer.from(response.data);
  }
}
