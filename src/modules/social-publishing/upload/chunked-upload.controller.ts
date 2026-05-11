import {
  Controller, Post, Body, UseGuards, Request, BadRequestException, Logger,
  UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { UploadService, UPLOAD_DIR } from './upload.service';
import { SupabaseStorageService } from './supabase-storage.service';
import { MediaLibraryService } from './media-library.service';
import * as fs from 'fs';
import * as path from 'path';

const CHUNK_DIR = path.join(UPLOAD_DIR, '_chunks');

@ApiTags('Social Upload (Chunked)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social/upload/chunk')
export class ChunkedUploadController {
  private readonly logger = new Logger(ChunkedUploadController.name);

  constructor(
    private readonly uploadService: UploadService,
    private readonly supabase: SupabaseStorageService,
    private readonly library: MediaLibraryService,
  ) {}

  @Post('init')
  @ApiOperation({ summary: 'Khởi tạo chunked upload — nhận uploadId' })
  init(@Body() body: { filename: string; mimetype: string; totalSize: number }, @Request() req: any) {
    if (!body.filename || !body.mimetype || !body.totalSize) throw new BadRequestException('Thiếu filename, mimetype hoặc totalSize');
    if (body.totalSize > 2 * 1024 * 1024 * 1024) throw new BadRequestException('File vượt quá giới hạn 2GB');
    if (!UploadService.ALLOWED_MIME_RE.test(body.mimetype)) throw new BadRequestException(`Loại file không hỗ trợ: ${body.mimetype}`);

    const uploadId = `${Date.now()}_${Math.random().toString(36).slice(2)}_${req.user.id}`;
    const chunkDir = path.join(CHUNK_DIR, uploadId);
    fs.mkdirSync(chunkDir, { recursive: true });
    fs.writeFileSync(path.join(chunkDir, '_meta.json'), JSON.stringify({ filename: body.filename, mimetype: body.mimetype, totalSize: body.totalSize, userId: req.user.id }));
    this.logger.log(`[Chunk] Init upload ${uploadId} — ${body.filename} (${(body.totalSize / 1024 / 1024).toFixed(1)}MB)`);
    return { uploadId, chunkSize: 5 * 1024 * 1024 };
  }

  @Post()
  @ApiOperation({ summary: 'Upload một chunk — dùng multipart/form-data' })
  @UseInterceptors(FileInterceptor('chunk', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  receiveChunk(
    @UploadedFile() chunk: Express.Multer.File,
    @Body('uploadId') uploadId: string,
    @Body('chunkIndex') chunkIndex: string,
    @Request() req: any,
  ) {
    if (!uploadId || chunkIndex === undefined || !chunk) throw new BadRequestException('Thiếu uploadId, chunkIndex hoặc chunk');
    const chunkDir = path.join(CHUNK_DIR, uploadId);
    if (!fs.existsSync(chunkDir)) throw new BadRequestException('uploadId không hợp lệ');
    const meta = JSON.parse(fs.readFileSync(path.join(chunkDir, '_meta.json'), 'utf8'));
    if (meta.userId !== req.user.id) throw new BadRequestException('Không có quyền');
    fs.writeFileSync(path.join(chunkDir, `chunk_${String(Number(chunkIndex)).padStart(6, '0')}`), chunk.buffer);
    return { received: Number(chunkIndex), size: chunk.buffer.length };
  }

  @Post('finish')
  @ApiOperation({ summary: 'Ghép chunks → upload Supabase → trả về URL' })
  async finishUpload(@Body() body: { uploadId: string; totalChunks: number }, @Request() req: any) {
    if (!body.uploadId || !body.totalChunks) throw new BadRequestException('Thiếu uploadId hoặc totalChunks');
    const chunkDir = path.join(CHUNK_DIR, body.uploadId);
    if (!fs.existsSync(chunkDir)) throw new BadRequestException('uploadId không hợp lệ');
    const meta = JSON.parse(fs.readFileSync(path.join(chunkDir, '_meta.json'), 'utf8'));
    if (meta.userId !== req.user.id) throw new BadRequestException('Không có quyền');

    const finalName = this.uploadService.generateFilename(meta.filename, meta.mimetype);
    const finalPath = path.join(UPLOAD_DIR, finalName);
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const writeStream = fs.createWriteStream(finalPath);
    for (let i = 0; i < body.totalChunks; i++) {
      const chunkPath = path.join(chunkDir, `chunk_${String(i).padStart(6, '0')}`);
      if (!fs.existsSync(chunkPath)) throw new BadRequestException(`Chunk ${i} bị thiếu`);
      
      await new Promise<void>((resolve, reject) => {
        const readStream = fs.createReadStream(chunkPath);
        readStream.pipe(writeStream, { end: false });
        readStream.on('end', resolve);
        readStream.on('error', reject);
      });
    }
    await new Promise<void>((resolve, reject) => { writeStream.end(); writeStream.on('finish', resolve); writeStream.on('error', reject); });
    fs.rmSync(chunkDir, { recursive: true, force: true });

    const fileSize = fs.statSync(finalPath).size;
    this.logger.log(`[Chunk] Assembled ${finalName} (${(fileSize / 1024 / 1024).toFixed(1)}MB). Processing metadata & compression...`);

    const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
    
    // Sử dụng logic chuẩn của MediaLibraryService (bao gồm nén và tạo thumbnail)
    const result = await this.library.uploadAndStore(req.user.id, finalPath, {
      originalname: meta.filename,
      mimetype: meta.mimetype,
      baseUrl
    });

    return { 
      success: true, 
      urls: [{ 
        url: result.url, 
        thumbnail_url: result.thumbnail_url,
        filename: result.filename, 
        originalname: result.originalname, 
        mimetype: result.mimetype, 
        size: result.size, 
        storage: result.storage 
      }] 
    };
  }
}
