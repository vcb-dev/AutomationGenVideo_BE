import {
  Controller, Get, Post, Delete, Param, Query, Request, Body,
  UseGuards, UseInterceptors, UploadedFile, Logger, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { MediaLibraryService } from './media-library.service';
import { UploadService, UPLOAD_DIR } from './upload.service';

@ApiTags('Social Media Library')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social/library')
export class MediaLibraryController {
  private readonly logger = new Logger(MediaLibraryController.name);

  constructor(private readonly library: MediaLibraryService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách file trong thư viện (có phân trang)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  list(@Request() req: any, @Query('page') page = '1', @Query('limit') limit = '20') {
    return this.library.list(req.user.id, Number(page), Number(limit));
  }

  @Get('stats')
  @ApiOperation({ summary: 'Thống kê tổng dung lượng + số file đã lưu' })
  stats(@Request() req: any) {
    return this.library.stats(req.user.id);
  }

  @Get(':id/posts')
  @ApiOperation({ summary: 'Lịch sử bài đăng đã dùng file này' })
  getPostHistory(@Param('id') id: string, @Request() req: any) {
    return this.library.getPostHistory(id, req.user.id);
  }

  @Post('upload')
  @ApiOperation({ summary: 'Upload file vao thu vien - luu binary tren Google Drive, DB chi luu metadata' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
          cb(null, UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname).toLowerCase() || '.bin';
          cb(null, `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
        },
      }),
      limits: { fileSize: 2 * 1024 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (UploadService.ALLOWED_MIME_RE.test(file.mimetype)) cb(null, true);
        else cb(new BadRequestException(`Loại file không hỗ trợ: ${file.mimetype}`), false);
      },
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    if (!file) throw new BadRequestException('Không có file nào được upload');
    this.logger.log(`[Library] Upload: ${file.originalname} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
    const result = await this.library.uploadAndStore(req.user.id, file.path, {
      originalname: file.originalname, mimetype: file.mimetype,
    }, req.user);
    return { success: true, file: result };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xoá file khỏi thư viện' })
  remove(@Param('id') id: string, @Request() req: any) {
    return this.library.remove(id, req.user.id);
  }

  @Post(':id/preview-frame')
  @ApiOperation({ summary: 'Preview frame tại giây bất kỳ — trả URL tạm để FE hiện trước khi confirm (tự xóa sau 5 phút)' })
  @ApiBody({ schema: { properties: { timeSeconds: { type: 'number', example: 5 } }, required: ['timeSeconds'] } })
  async previewFrame(
    @Param('id') id: string,
    @Body() body: { timeSeconds: number },
    @Request() req: any,
  ) {
    const ts = Number(body.timeSeconds);
    if (isNaN(ts) || ts < 0) throw new BadRequestException('timeSeconds phải là số không âm');
    return this.library.previewFrameAtTime(id, req.user.id, ts);
  }

  @Post(':id/set-thumbnail')
  @ApiOperation({ summary: 'Chọn ảnh bìa tại giây bất kỳ — upload lên Drive và cập nhật thumbnail_url trong DB' })
  @ApiBody({ schema: { properties: { timeSeconds: { type: 'number', example: 10 } }, required: ['timeSeconds'] } })
  async setThumbnail(
    @Param('id') id: string,
    @Body() body: { timeSeconds: number },
    @Request() req: any,
  ) {
    const ts = Number(body.timeSeconds);
    if (isNaN(ts) || ts < 0) throw new BadRequestException('timeSeconds phải là số không âm');
    return this.library.setThumbnailAtTime(id, req.user.id, ts, req.user);
  }
}
