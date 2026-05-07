import {
  Controller, Post, UseGuards, UseInterceptors,
  UploadedFiles, Request, BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { SupabaseStorageService } from './supabase-storage.service';
import * as path from 'path';
import * as fs from 'fs';

const UPLOAD_DIR = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social');

@ApiTags('Social Upload')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social/upload')
export class UploadController {
  constructor(private readonly storage: SupabaseStorageService) {}

  @Post('media')
  @ApiOperation({ summary: 'Upload media file → trả về public URL (dùng trước khi publish)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
      limits: { fileSize: 500 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|quicktime|x-msvideo|x-matroska|webm))$/;
        if (allowed.test(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException(`Loại file không được hỗ trợ: ${file.mimetype}`), false);
        }
      },
    }),
  )
  async uploadMedia(
    @UploadedFiles() files: Express.Multer.File[],
    @Request() req: any,
  ) {
    if (!files?.length) throw new BadRequestException('Không có file nào được upload');

    const urls = await Promise.all(files.map(async (f) => {
      const ext = path.extname(f.originalname).toLowerCase();
      const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;

      let url: string;

      if (this.storage.isAvailable()) {
        url = await this.storage.upload(f.buffer, filename, f.mimetype);
      } else {
        if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        fs.writeFileSync(path.join(UPLOAD_DIR, filename), f.buffer);
        const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.headers.host}`;
        url = `${baseUrl}/api/social/media/${filename}`;
      }

      return { url, filename, originalname: f.originalname, mimetype: f.mimetype, size: f.size };
    }));

    return { success: true, urls };
  }
}
