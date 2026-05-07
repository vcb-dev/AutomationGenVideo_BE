import {
  Controller, Post, UseGuards, UseInterceptors,
  UploadedFiles, Request, BadRequestException, Body,
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
    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.headers.host}`;

    const urls = await Promise.all(files.map(async (f) => {
      const filename = this.uploadService.generateFilename(f.originalname);
      const url = await this.uploadService.saveBuffer(f.buffer, filename, f.mimetype, baseUrl);
      return { url, filename, originalname: f.originalname, mimetype: f.mimetype, size: f.size };
    }));

    return { success: true, urls };
  }

  @Post('from-drive')
  @ApiOperation({ summary: 'Tải file từ Google Drive → lưu storage → trả về public URL' })
  async uploadFromDrive(
    @Body() body: { fileId: string; accessToken: string; mimeType: string; filename: string },
    @Request() req: any,
  ) {
    const { fileId, accessToken, mimeType, filename } = body;
    if (!fileId || !accessToken) throw new BadRequestException('Thiếu fileId hoặc accessToken');
    if (!/^[a-zA-Z0-9_-]{10,128}$/.test(fileId)) throw new BadRequestException('fileId không hợp lệ');
    if (!UploadService.ALLOWED_MIME_RE.test(mimeType)) {
      throw new BadRequestException(`Loại file không được hỗ trợ: ${mimeType}`);
    }

    const buffer = await this.uploadService.downloadFromDrive(fileId, accessToken);
    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.headers.host}`;
    const savedName = this.uploadService.generateFilename(filename, mimeType);
    const url = await this.uploadService.saveBuffer(buffer, savedName, mimeType, baseUrl);

    return {
      success: true,
      urls: [{ url, filename: savedName, originalname: filename, mimetype: mimeType, size: buffer.length }],
    };
  }
}
