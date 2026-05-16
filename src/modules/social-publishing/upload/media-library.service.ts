import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GoogleDriveStorageService } from './google-drive-storage.service';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { UPLOAD_DIR } from './upload.service';

const execAsync = promisify(exec);

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

  async uploadAndStore(userId: string, filePath: string, opts: { originalname: string; mimetype: string }, user?: any) {
    const isVideo = opts.mimetype.startsWith('video/');
    const ffmpegPath = this.resolveFFmpegPath();
    const ext = path.extname(opts.originalname).toLowerCase() || (isVideo ? '.mp4' : '.jpg');
    const baseName = `lib_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const filename = `${baseName}${ext}`;
    const fileSize = fs.statSync(filePath).size;

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
    const uploaded = await this.googleDrive.uploadFromPath(filePath, filename, opts.mimetype, user);
    url = uploaded.url;
    storage = 'google_drive';
    drive_file_id = uploaded.fileId;
    drive_web_view_url = uploaded.webViewUrl || null;
    this.logger.log(`[Library] Google Drive: ${filename}`);

    let thumbnail_url: string | null = null;
    let thumbnail_drive_file_id: string | null = null;
    if (isVideo && ffmpegPath) {
      const thumbName = `thumb_${baseName}.jpg`;
      const thumbPath = path.join(UPLOAD_DIR, thumbName);
      try {
        await execAsync(`"${ffmpegPath}" -y -ss 0 -i "${filePath}" -vframes 1 -q:v 2 "${thumbPath}"`, { timeout: 30_000 });
        if (fs.existsSync(thumbPath)) {
          const uploadedThumb = await this.googleDrive.uploadFromPath(thumbPath, thumbName, 'image/jpeg', user);
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

      if (file.drive_file_id) await this.googleDrive.delete(file.drive_file_id).catch(() => {});
      if (file.thumbnail_drive_file_id) await this.googleDrive.delete(file.thumbnail_drive_file_id).catch(() => {});
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
}
