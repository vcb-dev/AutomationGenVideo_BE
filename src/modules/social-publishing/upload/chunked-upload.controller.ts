import {
  Controller, Post, Body, UseGuards, Request, BadRequestException, Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { UploadService } from './upload.service';
import { MediaLibraryService } from './media-library.service';
import { GoogleDriveStorageService } from './google-drive-storage.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

@ApiTags('Social Upload (Google Drive Resumable)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social/upload/chunk')
export class ChunkedUploadController {
  private readonly logger = new Logger(ChunkedUploadController.name);

  constructor(
    private readonly uploadService: UploadService,
    private readonly library: MediaLibraryService,
    private readonly googleDrive: GoogleDriveStorageService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('init')
  @ApiOperation({ summary: 'Create Google Drive resumable upload session' })
  async init(@Body() body: { filename: string; mimetype: string; totalSize: number }, @Request() req: any) {
    if (!body.filename || !body.mimetype || !body.totalSize) throw new BadRequestException('Thieu filename, mimetype hoac totalSize');
    if (body.totalSize > 2 * 1024 * 1024 * 1024) throw new BadRequestException('File vuot qua gioi han 2GB');
    if (!UploadService.ALLOWED_MIME_RE.test(body.mimetype)) throw new BadRequestException(`Loai file khong ho tro: ${body.mimetype}`);
    if (!this.googleDrive.isAvailable()) throw new BadRequestException('Google Drive storage chua duoc cau hinh');

    const origin = req.headers?.origin || process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'https://www.vcbi.vn';
    const filename = this.uploadService.generateFilename(body.filename, body.mimetype);
    const { uploadUrl, fileId } = await this.googleDrive.createResumableUpload(filename, body.mimetype, body.totalSize, req.user, origin);
    const uploadId = `${Date.now()}_${Math.random().toString(36).slice(2)}_${req.user.id}`;

    await this.expireOldSessions(req.user.id);

    await this.prisma.socialDriveUploadSession.create({
      data: {
        id: uploadId,
        user_id: req.user.id,
        filename,
        originalname: body.filename,
        mimetype: body.mimetype,
        size: body.totalSize,
        upload_url: uploadUrl,
        drive_file_id: fileId || null,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    this.logger.log(`[DriveUpload] Init ${uploadId} - ${filename} (${(body.totalSize / 1024 / 1024).toFixed(1)}MB)`);
    return { uploadId, uploadUrl, chunkSize: 8 * 1024 * 1024 };
  }

  private async expireOldSessions(userId: string) {
    await this.prisma.socialDriveUploadSession.updateMany({
      where: {
        user_id: userId,
        status: { in: ['PENDING', 'UPLOADING', 'UPLOADED'] },
        expires_at: { lt: new Date() },
      },
      data: { status: 'EXPIRED', error_msg: 'Upload session expired' },
    }).catch((err: any) => this.logger.warn(`[Upload] expireOldSessions failed: ${err.message}`));
  }

  @Post('status')
  @ApiOperation({ summary: 'Query Google Drive resumable upload status' })
  async status(@Body() body: { uploadId: string }, @Request() req: any) {
    if (!body.uploadId) throw new BadRequestException('Thieu uploadId');

    const session = await this.prisma.socialDriveUploadSession.findFirst({
      where: { id: body.uploadId, user_id: req.user.id },
    });
    if (!session) {
      this.logger.warn(`[DriveUpload] status: uploadId=${body.uploadId} không tồn tại hoặc không thuộc userId=${req.user.id}`);
      throw new BadRequestException('uploadId khong hop le');
    }
    if (session.status === 'COMPLETED') {
      return {
        status: session.status,
        uploadedBytes: session.size,
        totalSize: session.size,
        completed: true,
        driveFileId: session.drive_file_id,
      };
    }
    if (session.expires_at && session.expires_at.getTime() < Date.now()) {
      await this.prisma.socialDriveUploadSession.update({
        where: { id: session.id },
        data: { status: 'EXPIRED', error_msg: 'Upload session expired' },
      });
      this.logger.warn(`[DriveUpload] status: uploadId=${body.uploadId} đã hết hạn`);
      throw new BadRequestException('Upload session da het han');
    }

    try {
      const driveStatus = await this.googleDrive.getResumableStatus(session.upload_url, session.size);
      await this.prisma.socialDriveUploadSession.update({
        where: { id: session.id },
        data: {
          status: driveStatus.completed ? 'UPLOADED' : 'UPLOADING',
          uploaded_bytes: driveStatus.uploadedBytes,
          drive_file_id: driveStatus.fileId || session.drive_file_id,
        },
      });
      this.logger.log(`[DriveUpload] status: uploadId=${body.uploadId} — ${driveStatus.uploadedBytes}/${session.size} bytes (${driveStatus.completed ? 'DONE' : 'uploading'})`);

      return {
        status: driveStatus.completed ? 'UPLOADED' : 'UPLOADING',
        uploadedBytes: driveStatus.uploadedBytes,
        totalSize: session.size,
        completed: driveStatus.completed,
        driveFileId: driveStatus.fileId || session.drive_file_id,
      };
    } catch (err: any) {
      this.logger.error(`[DriveUpload] status: lỗi query Drive cho uploadId=${body.uploadId}: ${err.message}`, err.stack);
      throw err;
    }
  }

  @Post()
  @ApiOperation({ summary: 'Deprecated: chunks are uploaded directly to Google Drive by the browser' })
  async receiveChunk() {
    throw new BadRequestException('Endpoint nay da bo. FE upload chunk truc tiep len Google Drive resumable uploadUrl.');
  }

  @Post('finish')
  @ApiOperation({ summary: 'Verify Google Drive upload and save media metadata' })
  async finishUpload(@Body() body: { uploadId: string; driveFileId?: string }, @Request() req: any) {
    if (!body.uploadId) throw new BadRequestException('Thieu uploadId');
    this.logger.log(`[DriveUpload] finish: uploadId=${body.uploadId} userId=${req.user.id}`);

    const session = await this.prisma.socialDriveUploadSession.findFirst({
      where: { id: body.uploadId, user_id: req.user.id },
    });
    if (!session) {
      this.logger.warn(`[DriveUpload] finish: uploadId=${body.uploadId} không tồn tại hoặc không thuộc userId=${req.user.id}`);
      throw new BadRequestException('uploadId khong hop le');
    }
    if (session.status === 'COMPLETED') {
      this.logger.log(`[DriveUpload] finish: uploadId=${body.uploadId} đã COMPLETED trước đó — trả về metadata cũ`);
      if (!session.drive_file_id) throw new BadRequestException('Upload da finish nhung thieu Google Drive file ID');
      const existing = await this.prisma.socialUploadedFile.findFirst({
        where: { user_id: req.user.id, drive_file_id: session.drive_file_id },
        orderBy: { created_at: 'desc' },
      });
      if (!existing) throw new BadRequestException('Upload da finish nhung khong tim thay metadata');
      return {
        success: true,
        urls: [{
          url: existing.url,
          thumbnail_url: existing.thumbnail_url,
          filename: existing.filename,
          originalname: existing.originalname,
          mimetype: existing.mimetype,
          size: existing.size,
          storage: existing.storage,
          drive_file_id: existing.drive_file_id,
        }],
      };
    }
    if (session.expires_at && session.expires_at.getTime() < Date.now()) {
      await this.prisma.socialDriveUploadSession.update({
        where: { id: session.id },
        data: { status: 'EXPIRED', error_msg: 'Upload session expired' },
      });
      this.logger.warn(`[DriveUpload] finish: uploadId=${body.uploadId} đã hết hạn`);
      throw new BadRequestException('Upload session da het han');
    }

    let driveFileId = body.driveFileId || session.drive_file_id;
    if (!driveFileId) {
      this.logger.log(`[DriveUpload] finish: uploadId=${body.uploadId} — không có driveFileId, query Drive status`);
      const driveStatus = await this.googleDrive.getResumableStatus(session.upload_url, session.size);
      driveFileId = driveStatus.fileId;
      await this.prisma.socialDriveUploadSession.update({
        where: { id: session.id },
        data: {
          status: driveStatus.completed ? 'UPLOADED' : 'UPLOADING',
          uploaded_bytes: driveStatus.uploadedBytes,
          drive_file_id: driveFileId || session.drive_file_id,
        },
      });
      this.logger.log(`[DriveUpload] finish: uploadId=${body.uploadId} driveStatus=${driveStatus.completed ? 'completed' : 'incomplete'} fileId=${driveFileId}`);
    }
    if (!driveFileId) {
      this.logger.error(`[DriveUpload] finish: uploadId=${body.uploadId} — không tìm được Drive file ID sau khi query`);
      throw new BadRequestException('Thieu Google Drive file id sau khi upload');
    }

    this.logger.log(`[DriveUpload] finish: lấy metadata Drive fileId=${driveFileId}`);
    const file = await this.googleDrive.getFile(driveFileId, true);
    const size = file.size || session.size;
    this.logger.log(`[DriveUpload] finish: Drive file size=${size}, expected=${session.size}`);

    if (size > 0 && size < session.size) {
      await this.prisma.socialDriveUploadSession.update({
        where: { id: session.id },
        data: { status: 'UPLOADING', uploaded_bytes: size, error_msg: 'Drive file size is smaller than expected' },
      });
      this.logger.error(`[DriveUpload] finish: ❌ uploadId=${body.uploadId} — Drive size=${size} < expected=${session.size}, upload chưa hoàn tất`);
      throw new BadRequestException('Video tren Google Drive chua upload du dung luong');
    }

    const mimetype = file.mimetype || session.mimetype || '';
    let thumbnailUrl = file.thumbnailUrl || null;
    let thumbnailDriveId: string | null = null;

    if (mimetype.startsWith('video/')) {
      this.logger.log(`[DriveUpload] finish: trích xuất thumbnail cho video fileId=${driveFileId}`);
      try {
        const res = await this.library.extractAndUploadThumbnail(file.fileId, session.filename, req.user);
        if (res) {
          thumbnailUrl = res.url;
          thumbnailDriveId = res.fileId;
          this.logger.log(`[DriveUpload] finish: thumbnail OK — ${res.url}`);
        }
      } catch (thumbErr: any) {
        this.logger.warn(`[DriveUpload] finish: extractAndUploadThumbnail thất bại cho ${file.fileId}: ${thumbErr.message}`);
      }
    }

    await this.library.save(req.user.id, {
      filename: session.filename,
      originalname: session.originalname,
      mimetype,
      size,
      url: file.url,
      thumbnail_url: thumbnailUrl,
      storage: 'google_drive',
      drive_file_id: file.fileId,
      drive_web_view_url: file.webViewUrl || null,
      thumbnail_drive_file_id: thumbnailDriveId,
    });

    await this.prisma.socialDriveUploadSession.update({
      where: { id: session.id },
      data: { status: 'COMPLETED', drive_file_id: file.fileId },
    });

    this.logger.log(`[DriveUpload] ✅ finish: uploadId=${body.uploadId} hoàn tất — fileId=${file.fileId} url=${file.url}`);
    return {
      success: true,
      urls: [{
        url: file.url,
        thumbnail_url: thumbnailUrl,
        filename: session.filename,
        originalname: session.originalname,
        mimetype,
        size,
        storage: 'google_drive',
        drive_file_id: file.fileId,
      }],
    };
  }

  @Post('cancel')
  @ApiOperation({ summary: 'Cancel an upload session and delete Drive file if created' })
  async cancel(@Body() body: { uploadId: string }, @Request() req: any) {
    if (!body.uploadId) throw new BadRequestException('Thieu uploadId');
    const session = await this.prisma.socialDriveUploadSession.findFirst({
      where: { id: body.uploadId, user_id: req.user.id },
    });
    if (!session) {
      this.logger.warn(`[DriveUpload] cancel: uploadId=${body.uploadId} không tìm thấy`);
      throw new BadRequestException('uploadId khong hop le');
    }
    if (session.drive_file_id) {
      this.logger.log(`[DriveUpload] cancel: xóa Drive file=${session.drive_file_id} cho uploadId=${body.uploadId}`);
      await this.googleDrive.delete(session.drive_file_id).catch((err: any) => {
        this.logger.warn(`[DriveUpload] cancel: không xóa được Drive file=${session.drive_file_id}: ${err.message}`);
      });
    }
    await this.prisma.socialDriveUploadSession.update({
      where: { id: session.id },
      data: { status: 'CANCELLED' },
    });
    this.logger.log(`[DriveUpload] cancel: uploadId=${body.uploadId} đã huỷ`);
    return { success: true };
  }
}
