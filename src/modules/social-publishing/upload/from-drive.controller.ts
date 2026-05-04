import {
  Controller, Post, UseGuards, Request,
  Body, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';

const UPLOAD_DIR = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

@ApiTags('Social Upload')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social/upload')
export class FromDriveController {
  private static readonly ALLOWED_MIME_RE = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|quicktime|x-msvideo|x-matroska|webm))$/;
  private static readonly MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

  @Post('from-drive')
  @ApiOperation({ summary: 'Tải file từ Google Drive → lưu server → trả về public URL' })
  async uploadFromDrive(
    @Body() body: { fileId: string; accessToken: string; mimeType: string; filename: string },
    @Request() req: any,
  ) {
    const { fileId, accessToken, mimeType, filename } = body;
    if (!fileId || !accessToken) throw new BadRequestException('Thiếu fileId hoặc accessToken');
    if (!/^[a-zA-Z0-9_-]{10,128}$/.test(fileId)) throw new BadRequestException('fileId không hợp lệ');
    if (!FromDriveController.ALLOWED_MIME_RE.test(mimeType)) {
      throw new BadRequestException(`Loại file không được hỗ trợ: ${mimeType}`);
    }

    const ext = this.extFromMime(mimeType) || path.extname(path.basename(filename)) || '.bin';
    const savedName = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    const filePath = path.join(UPLOAD_DIR, savedName);

    // Kiểm tra kích thước trước khi download
    const headRes = await axios.head(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15_000 },
    ).catch(() => null);
    const contentLength = headRes ? parseInt(headRes.headers['content-length'] || '0', 10) : 0;
    if (contentLength > FromDriveController.MAX_DOWNLOAD_BYTES) {
      throw new BadRequestException(`File vượt quá giới hạn 2GB`);
    }

    // Download từ Google Drive
    const response = await axios.get(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        responseType: 'stream',
        timeout: 120_000,
        maxContentLength: FromDriveController.MAX_DOWNLOAD_BYTES,
      },
    );

    await new Promise<void>((resolve, reject) => {
      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // Dùng PUBLIC_BASE_URL từ env để tránh Host Header Injection
    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.headers.host}`;

    return {
      success: true,
      urls: [{
        url: `${baseUrl}/api/social/media/${savedName}`,
        filename: savedName,
        originalname: filename,
        mimetype: mimeType,
        size: fs.statSync(filePath).size,
      }],
    };
  }

  private extFromMime(mimeType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
      'video/quicktime': '.mov',
      'video/x-msvideo': '.avi',
      'video/webm': '.webm',
    };
    return map[mimeType] || '';
  }
}
