import {
  Controller, Post, UseGuards, UseInterceptors,
  UploadedFiles, BadRequestException, Request, Logger,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UploadService, UPLOAD_DIR } from './upload.service';

@ApiTags('Social Upload')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social/upload')
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(private readonly uploadService: UploadService) {}

  @Post('media')
  @ApiOperation({ summary: 'Upload media file → trả về public URL (dùng trước khi publish)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      // diskStorage: ghi thẳng ra disk, không load cả file vào RAM (tránh OOM với video lớn)
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
          cb(null, UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname).toLowerCase() || '.bin';
          cb(null, `tmp_up_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
        },
      }),
      limits: { fileSize: 500 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (UploadService.ALLOWED_MIME_RE.test(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException(`Loại file không được hỗ trợ: ${file.mimetype}`), false);
        }
      },
    }),
  )
  async uploadMedia(@UploadedFiles() files: Express.Multer.File[], @Request() req: any) {
    const userId = req.user?.id || 'unknown';
    if (!files?.length) {
      this.logger.warn(`[Upload] userId=${userId} — request không có file nào`);
      throw new BadRequestException('Không có file nào được upload');
    }

    this.logger.log(`[Upload] userId=${userId} — nhận ${files.length} file: ${files.map(f => `${f.originalname} (${(f.size / 1024 / 1024).toFixed(2)}MB, ${f.mimetype})`).join(', ')}`);

    const urls = await Promise.all(files.map(async (f) => {
      const filename = this.uploadService.generateFilename(f.originalname, f.mimetype);
      this.logger.log(`[Upload] Bắt đầu upload lên Drive: ${filename} (${(f.size / 1024 / 1024).toFixed(2)}MB)`);
      try {
        const url = await this.uploadService.saveFromDisk(f.path, filename, f.mimetype, req.user);
        this.logger.log(`[Upload] ✅ Hoàn thành: ${filename} → ${url}`);
        return { url, filename, originalname: f.originalname, mimetype: f.mimetype, size: f.size };
      } catch (err: any) {
        this.logger.error(`[Upload] ❌ Lỗi upload ${filename}: ${err.message}`, err.stack);
        throw err;
      }
    }));

    this.logger.log(`[Upload] userId=${userId} — hoàn thành ${urls.length} file`);
    return { success: true, urls };
  }
}
