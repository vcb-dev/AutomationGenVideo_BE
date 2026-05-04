import {
  Controller, Post, UseGuards, UseInterceptors,
  UploadedFiles, Request, BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import * as path from 'path';
import * as fs from 'fs';

const UPLOAD_DIR = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

@ApiTags('Social Upload')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social/upload')
export class UploadController {
  @Post('media')
  @ApiOperation({ summary: 'Upload media file → trả về public URL (dùng trước khi publish)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname).toLowerCase();
          const name = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
          cb(null, name);
        },
      }),
      limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
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
  uploadMedia(
    @UploadedFiles() files: Express.Multer.File[],
    @Request() req: any,
  ) {
    if (!files?.length) throw new BadRequestException('Không có file nào được upload');

    // Dùng PUBLIC_BASE_URL từ env để tránh Host Header Injection
    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.headers.host}`;

    const urls = files.map((f) => ({
      url: `${baseUrl}/api/social/media/${f.filename}`,
      filename: f.filename,
      originalname: f.originalname,
      mimetype: f.mimetype,
      size: f.size,
    }));

    return { success: true, urls };
  }
}
