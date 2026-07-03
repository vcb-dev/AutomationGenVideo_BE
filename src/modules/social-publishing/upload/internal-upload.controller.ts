import {
  Controller, Post, UseGuards, UseInterceptors,
  UploadedFile, BadRequestException, Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { InternalApiKeyGuard } from '../../../common/guards/internal-api-key.guard';
import { UploadService, UPLOAD_DIR } from './upload.service';

@UseGuards(InternalApiKeyGuard)
@Controller('internal/upload')
export class InternalUploadController {
  private readonly logger = new Logger(InternalUploadController.name);

  constructor(private readonly uploadService: UploadService) {}

  @Post('drive')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
          cb(null, UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname).toLowerCase() || '.bin';
          cb(null, `tmp_internal_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
        },
      }),
      limits: { fileSize: 100 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException(`Loại file không hỗ trợ: ${file.mimetype}`), false);
        }
      },
    }),
  )
  async uploadToDrive(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Không có file nào được gửi lên');

    const filename = this.uploadService.generateFilename(file.originalname, file.mimetype);
    this.logger.log(`[InternalUpload] ${filename} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);

    const url = await this.uploadService.saveFromDisk(file.path, filename, file.mimetype);
    return { url, filename, mimetype: file.mimetype, size: file.size };
  }
}
