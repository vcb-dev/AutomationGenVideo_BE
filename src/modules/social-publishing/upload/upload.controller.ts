import {
  Controller, Post, UseGuards, UseInterceptors,
  UploadedFiles, BadRequestException, Request
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { UploadService } from './upload.service';

@ApiTags('Social Upload')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social/upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('media')
  @ApiOperation({ summary: 'Upload media file → trả về public URL (dùng trước khi publish)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
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
    if (!files?.length) throw new BadRequestException('Không có file nào được upload');
    const urls = await Promise.all(files.map(async (f) => {
      const filename = this.uploadService.generateFilename(f.originalname, f.mimetype);
      const url = await this.uploadService.saveBuffer(f.buffer, filename, f.mimetype, req.user);
      return { url, filename, originalname: f.originalname, mimetype: f.mimetype, size: f.size };
    }));

    return { success: true, urls };
  }

}
