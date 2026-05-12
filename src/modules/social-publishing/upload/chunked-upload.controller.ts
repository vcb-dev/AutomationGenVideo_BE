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
import { PrismaService } from '../../../common/prisma/prisma.service';

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
    private readonly prisma: PrismaService,
  ) {}

  @Post('init')
  @ApiOperation({ summary: 'Khởi tạo chunked upload — nhận uploadId' })
  async init(@Body() body: { filename: string; mimetype: string; totalSize: number }, @Request() req: any) {
    if (!body.filename || !body.mimetype || !body.totalSize) throw new BadRequestException('Thiếu filename, mimetype hoặc totalSize');
    if (body.totalSize > 2 * 1024 * 1024 * 1024) throw new BadRequestException('File vượt quá giới hạn 2GB');
    if (!UploadService.ALLOWED_MIME_RE.test(body.mimetype)) throw new BadRequestException(`Loại file không hỗ trợ: ${body.mimetype}`);

    const uploadId = `${Date.now()}_${Math.random().toString(36).slice(2)}_${req.user.id}`;
    
    // Lưu meta vào Database tạm thời để đạt chuẩn Stateless
    const metaBuffer = Buffer.from(JSON.stringify({ 
      filename: body.filename, 
      mimetype: body.mimetype, 
      totalSize: body.totalSize, 
      userId: req.user.id 
    }));
    
    await this.prisma.socialMediaFile.create({
      data: {
        filename: `_meta_${uploadId}`,
        mimetype: 'application/json',
        size: metaBuffer.length,
        data: metaBuffer,
      }
    });

    this.logger.log(`[Chunk] Init upload ${uploadId} — ${body.filename} (${(body.totalSize / 1024 / 1024).toFixed(1)}MB) (DB State)`);
    return { uploadId, chunkSize: 5 * 1024 * 1024 };
  }

  @Post()
  @ApiOperation({ summary: 'Upload một chunk — dùng multipart/form-data' })
  @UseInterceptors(FileInterceptor('chunk', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  async receiveChunk(
    @UploadedFile() chunk: Express.Multer.File,
    @Body('uploadId') uploadId: string,
    @Body('chunkIndex') chunkIndex: string,
    @Request() req: any,
  ) {
    if (!uploadId || chunkIndex === undefined || !chunk) throw new BadRequestException('Thiếu uploadId, chunkIndex hoặc chunk');
    
    const metaFile = await this.prisma.socialMediaFile.findUnique({ where: { filename: `_meta_${uploadId}` } });
    if (!metaFile) throw new BadRequestException('uploadId không hợp lệ');
    const meta = JSON.parse(metaFile.data.toString('utf8'));
    if (meta.userId !== req.user.id) throw new BadRequestException('Không có quyền');
    
    // Lưu thẳng chunk vào Database để tránh lỗi rơi rớt file khi Load Balancer đổi máy chủ
    await this.prisma.socialMediaFile.create({
      data: {
        filename: `_chunk_${uploadId}_${String(Number(chunkIndex)).padStart(6, '0')}`,
        mimetype: 'application/octet-stream',
        size: chunk.buffer.length,
        data: chunk.buffer,
      }
    });

    return { received: Number(chunkIndex), size: chunk.buffer.length };
  }

  @Post('finish')
  @ApiOperation({ summary: 'Ghép chunks → upload Supabase → trả về URL' })
  async finishUpload(@Body() body: { uploadId: string; totalChunks: number }, @Request() req: any) {
    if (!body.uploadId || !body.totalChunks) throw new BadRequestException('Thiếu uploadId hoặc totalChunks');
    
    const metaFile = await this.prisma.socialMediaFile.findUnique({ where: { filename: `_meta_${body.uploadId}` } });
    if (!metaFile) throw new BadRequestException('uploadId không hợp lệ');
    const meta = JSON.parse(metaFile.data.toString('utf8'));
    if (meta.userId !== req.user.id) throw new BadRequestException('Không có quyền');

    const finalName = this.uploadService.generateFilename(meta.filename, meta.mimetype);
    const finalPath = path.join(UPLOAD_DIR, finalName);
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    
    const writeStream = fs.createWriteStream(finalPath);
    
    for (let i = 0; i < body.totalChunks; i++) {
      const chunkName = `_chunk_${body.uploadId}_${String(i).padStart(6, '0')}`;
      const chunkFile = await this.prisma.socialMediaFile.findUnique({ where: { filename: chunkName } });
      if (!chunkFile) throw new BadRequestException(`Chunk ${i} bị thiếu trong DB`);
      
      await new Promise<void>((resolve, reject) => {
        writeStream.write(chunkFile.data, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
    await new Promise<void>((resolve, reject) => { writeStream.end(); writeStream.on('finish', resolve); writeStream.on('error', reject); });
    
    // Dọn dẹp rác Database sau khi ghép xong
    await this.prisma.socialMediaFile.deleteMany({
      where: {
        OR: [
          { filename: `_meta_${body.uploadId}` },
          { filename: { startsWith: `_chunk_${body.uploadId}_` } }
        ]
      }
    });

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
