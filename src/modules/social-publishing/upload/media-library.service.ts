import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GoogleDriveStorageService } from './google-drive-storage.service';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { UPLOAD_DIR } from './upload.service';

const execFileAsync = promisify(execFile);

const TABLE_NOT_FOUND = ['P2021', 'P2022', 'P2010'];

function isNotReady(err: any): boolean {
  if (TABLE_NOT_FOUND.includes(err?.code)) return true;
  if (err instanceof TypeError) return true;
  const msg: string = err?.message || '';
  return msg.includes('does not exist') || msg.includes('relation') ||
    msg.includes('social_uploaded_files') || msg.includes('is not a function') ||
    msg.includes('Cannot read propert');
}

function modelReady(prisma: any): boolean {
  return typeof (prisma as any).socialUploadedFile?.findMany === 'function';
}

const EMPTY_LIST = { items: [], total: 0, page: 1, limit: 20, pages: 0 };
const EMPTY_STATS = { count: 0, totalBytes: 0, totalMB: 0 };

function safeDriveFilename(originalname: string, fallbackExt: string): string {
  const ext = path.extname(originalname).toLowerCase() || fallbackExt;
  const base = path.basename(originalname, path.extname(originalname))
    .normalize('NFC')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'media';
  return `${base}${ext}`;
}

function thumbFilenameFor(videoFilename: string): string {
  const base = path.basename(videoFilename, path.extname(videoFilename))
    .replace(/^thumb[_\s-]*/i, '')
    .slice(0, 120) || 'video';
  return `thumb_${base}.jpg`;
}

@Injectable()
export class MediaLibraryService {
  private readonly logger = new Logger(MediaLibraryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleDrive: GoogleDriveStorageService,
  ) {}

  private resolveFFmpegPath(): string | null {
    const fromEnv = process.env.FFMPEG_PATH;
    if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
    if (fs.existsSync('/usr/bin/ffmpeg')) return '/usr/bin/ffmpeg';
    return null;
  }

  async uploadAndStore(
    userId: string,
    filePath: string,
    opts: { originalname: string; mimetype: string; isThumbnail?: boolean; thumbFor?: string },
    user?: any,
  ) {
    const isVideo = opts.mimetype.startsWith('video/');
    const ffmpegPath = this.resolveFFmpegPath();
    const ext = path.extname(opts.originalname).toLowerCase() || (isVideo ? '.mp4' : '.jpg');
    const filename = opts.isThumbnail
      ? thumbFilenameFor(opts.thumbFor || opts.originalname)
      : safeDriveFilename(opts.originalname, ext);
    let fileSize: number;
    try {
      fileSize = fs.statSync(filePath).size;
    } catch (e: any) {
      throw new Error(`Không đọc được file sau khi upload: ${e.message}`);
    }

    if (isVideo) {
      this.logger.log(`[Library] Upload video goc, khong nen: ${opts.originalname} (${(fileSize / 1024 / 1024).toFixed(1)}MB)`);
    }

    let url: string;
    let storage: string;
    let drive_file_id: string | null = null;
    let drive_web_view_url: string | null = null;

    if (!this.googleDrive.isAvailable()) {
      throw new Error('Google Drive storage chua duoc cau hinh');
    }
    const uploaded = await this.googleDrive.uploadFromPath(
      filePath,
      filename,
      opts.mimetype,
      user,
      opts.isThumbnail ? { subfolder: 'thumb' } : undefined,
    );
    url = uploaded.url;
    storage = 'google_drive';
    drive_file_id = uploaded.fileId;
    drive_web_view_url = uploaded.webViewUrl;
    this.logger.log(`[Library] Google Drive: ${filename}`);

    let thumbnail_url: string | null = null;
    let thumbnail_drive_file_id: string | null = null;
    if (isVideo && ffmpegPath) {
      const thumbName = thumbFilenameFor(filename);
      const thumbPath = path.join(UPLOAD_DIR, thumbName);
      try {
        await execFileAsync(ffmpegPath, ['-y', '-ss', '0', '-i', filePath, '-vframes', '1', '-q:v', '2', thumbPath], { timeout: 30_000 });
        if (fs.existsSync(thumbPath)) {
          const uploadedThumb = await this.googleDrive.uploadFromPath(thumbPath, thumbName, 'image/jpeg', user, { subfolder: 'thumb' });
          thumbnail_url = uploadedThumb.url;
          thumbnail_drive_file_id = uploadedThumb.fileId;
          try { fs.unlinkSync(thumbPath); } catch {}
        }
      } catch (e: any) {
        this.logger.warn(`[Library] Tao thumbnail that bai: ${e.message}`);
      }
    }

    try { fs.unlinkSync(filePath); } catch {}

    const saved = await this.save(userId, {
      filename,
      originalname: opts.originalname,
      mimetype: opts.mimetype,
      size: fileSize,
      url,
      thumbnail_url,
      storage,
      drive_file_id,
      drive_web_view_url,
      thumbnail_drive_file_id,
    });

    return saved || { url, thumbnail_url, filename, originalname: opts.originalname, mimetype: opts.mimetype, size: fileSize, storage, drive_file_id };
  }

  async extractAndUploadThumbnail(driveFileId: string, baseFilename: string, user?: any): Promise<{ url: string; fileId: string } | null> {
    const ffmpegPath = this.resolveFFmpegPath();
    if (!ffmpegPath) return null;

    try {
      const tempVideoPath = path.join(UPLOAD_DIR, `dl_${Date.now()}_${driveFileId}.mp4`);
      const thumbName = thumbFilenameFor(baseFilename);
      const thumbPath = path.join(UPLOAD_DIR, thumbName);

      this.logger.log(`[Library] Downloading Drive video ${driveFileId} to extract thumbnail...`);
      await this.googleDrive.downloadFileToLocal(driveFileId, tempVideoPath);

      this.logger.log(`[Library] Extracting frame 1s with ffmpeg...`);
      await execFileAsync(ffmpegPath, ['-y', '-ss', '00:00:01', '-i', tempVideoPath, '-vframes', '1', '-q:v', '2', thumbPath], { timeout: 30_000 });

      let result: { url: string; fileId: string } | null = null;
      if (fs.existsSync(thumbPath)) {
        this.logger.log(`[Library] Uploading thumbnail to Google Drive...`);
        const uploadedThumb = await this.googleDrive.uploadFromPath(thumbPath, thumbName, 'image/jpeg', user, { subfolder: 'thumb' });
        result = { url: uploadedThumb.url, fileId: uploadedThumb.fileId };
        this.logger.log(`[Library] Created Drive thumbnail: ${result.url}`);
        try { fs.unlinkSync(thumbPath); } catch {}
      }
      try { fs.unlinkSync(tempVideoPath); } catch {}
      return result;
    } catch (e: any) {
      this.logger.warn(`[Library] Failed to extract Drive thumbnail: ${e.message}`);
      return null;
    }
  }

  async save(userId: string, file: {
    filename: string;
    originalname: string;
    mimetype: string;
    size: number;
    url: string;
    thumbnail_url?: string | null;
    storage: string;
    drive_file_id?: string | null;
    drive_web_view_url?: string | null;
    thumbnail_drive_file_id?: string | null;
  }) {
    this.logger.log(`[Library] Luu metadata cho User: ${userId} | File: ${file.originalname}`);
    if (!modelReady(this.prisma)) {
      throw new Error('Prisma model socialUploadedFile chua san sang - can chay prisma generate/build lai');
    }
    try {
      const model = this.getModel();
      return await model.create({ data: { user_id: userId, ...file } });
    } catch (err: any) {
      if (isNotReady(err)) {
        throw new Error('Bang social_uploaded_files chua ton tai hoac chua cap nhat - can chay migration SQL Google Drive');
      }
      this.logger.error(`[Library] Loi khi luu vao DB: ${err.message}`);
      throw err;
    }
  }

  private getModel() {
    return (this.prisma as any).socialUploadedFile || (this.prisma as any).SocialUploadedFile;
  }

  async list(userId: string, page = 1, limit = 20) {
    this.logger.log(`[Library] Lay danh sach cho User: ${userId} (Page: ${page})`);
    if (!modelReady(this.prisma)) {
      this.logger.warn('[Library] Prisma generate chua chay');
      return EMPTY_LIST;
    }
    try {
      const model = this.getModel();
      const skip = (page - 1) * limit;
      const [items, total] = await Promise.all([
        model.findMany({ where: { user_id: userId }, orderBy: { created_at: 'desc' }, skip, take: limit }),
        model.count({ where: { user_id: userId } }),
      ]);
      return { items, total, page, limit, pages: Math.ceil(total / limit) };
    } catch (err: any) {
      if (isNotReady(err)) return EMPTY_LIST;
      throw err;
    }
  }

  async remove(id: string, userId: string) {
    if (!modelReady(this.prisma)) return null;
    try {
      const model = this.getModel();
      const file = await model.findFirst({ where: { id, user_id: userId } });
      if (!file) return null;

      if (file.drive_file_id) await this.googleDrive.delete(file.drive_file_id).catch((e: any) => this.logger.warn(`[Library] Drive delete failed for ${file.drive_file_id}: ${e.message}`));
      if (file.thumbnail_drive_file_id) await this.googleDrive.delete(file.thumbnail_drive_file_id).catch((e: any) => this.logger.warn(`[Library] Drive delete failed for thumbnail ${file.thumbnail_drive_file_id}: ${e.message}`));
      await model.delete({ where: { id } });
      return file;
    } catch (err: any) {
      if (isNotReady(err)) return null;
      throw err;
    }
  }

  async stats(userId: string) {
    if (!modelReady(this.prisma)) return EMPTY_STATS;
    try {
      const model = this.getModel();
      const result = await model.aggregate({
        where: { user_id: userId }, _count: { id: true }, _sum: { size: true },
      });
      return { count: result._count.id, totalBytes: result._sum.size ?? 0, totalMB: Number(((result._sum.size ?? 0) / 1024 / 1024).toFixed(2)) };
    } catch (err: any) {
      if (isNotReady(err)) return EMPTY_STATS;
      throw err;
    }
  }

  async removeByDriveFileId(driveFileId: string): Promise<void> {
    if (!modelReady(this.prisma)) return;
    try {
      const model = this.getModel();
      const file = await model.findFirst({ where: { drive_file_id: driveFileId } });
      if (file) {
        await model.delete({ where: { id: file.id } });
        this.logger.log(`[Library] Removed media library entry for Drive file ${driveFileId}`);
      }
    } catch (err: any) {
      if (isNotReady(err)) return;
      this.logger.warn(`[Library] removeByDriveFileId failed for ${driveFileId}: ${err.message}`);
    }
  }

  async getPostHistory(id: string, userId: string) {
    if (!modelReady(this.prisma)) return { posts: [] };
    try {
      const model = this.getModel();
      const file = await model.findFirst({ where: { id, user_id: userId } });
      if (!file) return { posts: [] };
      const posts = await this.prisma.socialPost.findMany({
        where: { user_id: userId, media_urls: { has: file.url } },
        orderBy: { created_at: 'desc' },
        take: 50,
        select: { id: true, platform: true, status: true, message: true, media_urls: true, created_at: true, executed_at: true, account: { select: { name: true, platform: true, avatar_url: true } } },
      });
      return { file, posts };
    } catch (err: any) {
      if (isNotReady(err)) return { posts: [] };
      throw err;
    }
  }

  /**
   * Trích xuất frame tại giây `timeSeconds` từ video Drive,
   * lưu tạm local, trả về URL để FE preview trước khi confirm.
   * File tạm tự xóa sau 5 phút.
   */
  async previewFrameAtTime(id: string, userId: string, timeSeconds: number): Promise<{ previewUrl: string }> {
    if (!modelReady(this.prisma)) throw new BadRequestException('Prisma model chưa sẵn sàng');

    const file = await this.getModel().findFirst({ where: { id, user_id: userId } });
    if (!file) throw new NotFoundException('File không tồn tại');
    if (!file.drive_file_id) throw new BadRequestException('File chưa có Google Drive ID');
    if (!file.mimetype?.startsWith('video/')) throw new BadRequestException('Chỉ hỗ trợ chọn ảnh bìa cho video');

    const ffmpegPath = this.resolveFFmpegPath();
    if (!ffmpegPath) throw new BadRequestException('FFmpeg chưa được cài đặt trên server');

    const ts = Math.max(0, Math.floor(timeSeconds));
    const tempVideoPath = path.join(UPLOAD_DIR, `dl_prev_${Date.now()}_${file.drive_file_id}.mp4`);
    const previewName = `prev_${Date.now()}_${id}.jpg`;
    const previewPath = path.join(UPLOAD_DIR, previewName);

    let previewReady = false;
    try {
      this.logger.log(`[Library] Download video ${file.drive_file_id} để preview frame tại ${ts}s`);
      await this.googleDrive.downloadFileToLocal(file.drive_file_id, tempVideoPath);

      await execFileAsync(
        ffmpegPath,
        ['-y', '-ss', String(ts), '-i', tempVideoPath, '-vframes', '1', '-q:v', '2', previewPath],
        { timeout: 60_000 },
      );

      if (!fs.existsSync(previewPath) || fs.statSync(previewPath).size === 0) {
        throw new Error(`FFmpeg không xuất được frame tại ${ts}s (video có thể ngắn hơn)`);
      }

      previewReady = true;

      // Tự xóa file preview sau 5 phút
      setTimeout(() => {
        try { if (fs.existsSync(previewPath)) fs.unlinkSync(previewPath); } catch (e: any) { this.logger.warn(`[Library] Không xóa được preview file ${previewName}: ${e.message}`); }
      }, 5 * 60 * 1000);

      const base = process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
      return { previewUrl: `${base}/api/social/media/${previewName}` };
    } finally {
      try { if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath); } catch {}
      // Nếu lỗi xảy ra trước khi preview sẵn sàng → xóa file partial (nếu có)
      if (!previewReady) {
        try { if (fs.existsSync(previewPath)) fs.unlinkSync(previewPath); } catch {}
      }
    }
  }

  /**
   * Trích xuất frame tại giây `timeSeconds`, upload lên Drive,
   * cập nhật thumbnail_url trong DB. Xóa thumbnail cũ nếu có.
   */
  async setThumbnailAtTime(id: string, userId: string, timeSeconds: number, user?: any): Promise<{ thumbnail_url: string }> {
    if (!modelReady(this.prisma)) throw new BadRequestException('Prisma model chưa sẵn sàng');

    const file = await this.getModel().findFirst({ where: { id, user_id: userId } });
    if (!file) throw new NotFoundException('File không tồn tại');
    if (!file.drive_file_id) throw new BadRequestException('File chưa có Google Drive ID');
    if (!file.mimetype?.startsWith('video/')) throw new BadRequestException('Chỉ hỗ trợ chọn ảnh bìa cho video');

    const ffmpegPath = this.resolveFFmpegPath();
    if (!ffmpegPath) throw new BadRequestException('FFmpeg chưa được cài đặt trên server');

    const ts = Math.max(0, Math.floor(timeSeconds));
    const tempVideoPath = path.join(UPLOAD_DIR, `dl_thumb_${Date.now()}_${file.drive_file_id}.mp4`);
    const thumbName = thumbFilenameFor(file.filename);
    const thumbPath = path.join(UPLOAD_DIR, thumbName);

    try {
      this.logger.log(`[Library] Download video ${file.drive_file_id} để set thumbnail tại ${ts}s`);
      await this.googleDrive.downloadFileToLocal(file.drive_file_id, tempVideoPath);

      await execFileAsync(
        ffmpegPath,
        ['-y', '-ss', String(ts), '-i', tempVideoPath, '-vframes', '1', '-q:v', '2', thumbPath],
        { timeout: 60_000 },
      );

      if (!fs.existsSync(thumbPath) || fs.statSync(thumbPath).size === 0) {
        throw new Error(`FFmpeg không xuất được frame tại ${ts}s (video có thể ngắn hơn)`);
      }

      this.logger.log(`[Library] Upload thumbnail custom lên Drive: ${thumbName}`);
      const uploadedThumb = await this.googleDrive.uploadFromPath(thumbPath, thumbName, 'image/jpeg', user, { subfolder: 'thumb' });

      // Cập nhật DB TRƯỚC — chỉ xóa Drive cũ sau khi DB update thành công
      // (tránh trường hợp DB lỗi → mất thumbnail cũ mà không có cái mới)
      await this.getModel().update({
        where: { id },
        data: { thumbnail_url: uploadedThumb.url, thumbnail_drive_file_id: uploadedThumb.fileId },
      });

      // Xóa Drive thumbnail cũ sau khi DB đã lưu thumbnail mới thành công
      if (file.thumbnail_drive_file_id) {
        await this.googleDrive.delete(file.thumbnail_drive_file_id).catch((e: any) => this.logger.warn(`[Library] Drive delete old thumbnail failed for ${file.thumbnail_drive_file_id}: ${e.message}`));
      }

      this.logger.log(`[Library] ✅ Đã cập nhật thumbnail tại ${ts}s cho file ${id}`);
      return { thumbnail_url: uploadedThumb.url };
    } finally {
      try { if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath); } catch {}
      try { if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath); } catch {}
    }
  }
}
