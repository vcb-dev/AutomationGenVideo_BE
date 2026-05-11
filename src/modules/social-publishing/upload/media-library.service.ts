import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SupabaseStorageService } from './supabase-storage.service';
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
    private readonly supabase: SupabaseStorageService,
  ) { }

  /** Tìm FFmpeg: ưu tiên env → /usr/bin/ffmpeg (Docker) → null */
  private resolveFFmpegPath(): string | null {
    const fromEnv = process.env.FFMPEG_PATH;
    if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
    if (fs.existsSync('/usr/bin/ffmpeg')) return '/usr/bin/ffmpeg';
    return null;
  }

  async uploadAndStore(userId: string, filePath: string, opts: { originalname: string; mimetype: string; baseUrl: string }) {
    const isVideo = opts.mimetype.startsWith('video/');
    const ffmpegPath = this.resolveFFmpegPath();
    const ext = path.extname(opts.originalname).toLowerCase() || (isVideo ? '.mp4' : '.jpg');
    const baseName = `lib_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const filename = `${baseName}${ext}`;

    let finalPath = filePath, finalName = filename, finalMime = opts.mimetype, compressed = false;

    const originalSize = fs.statSync(filePath).size;
    if (isVideo && ffmpegPath && originalSize > 15 * 1024 * 1024) {
      const cName = `${baseName}_c.mp4`, cPath = path.join(UPLOAD_DIR, cName);
      try {
        this.logger.log(`[Library] Đang nén video ${opts.originalname} (${(originalSize / 1024 / 1024).toFixed(1)}MB) với chế độ siêu nhanh…`);
        const cmd = `"${ffmpegPath}" -y -i "${filePath}" -c:v libx264 -preset superfast -profile:v main -crf 28 -maxrate 4M -bufsize 8M `
          + `-vf "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2" `
          + `-r 30 -fps_mode cfr -pix_fmt yuv420p -c:a aac -b:a 96k -ar 44100 -ac 2 -map_metadata -1 -movflags +faststart "${cPath}"`;
        await execAsync(cmd, { timeout: 600_000, maxBuffer: 10 * 1024 * 1024 });
        if (fs.existsSync(cPath)) {
          const after = fs.statSync(cPath).size;
          this.logger.log(`[Library] Nén xong: ${(originalSize / 1024 / 1024).toFixed(1)}MB → ${(after / 1024 / 1024).toFixed(1)}MB`);
          finalPath = cPath; finalName = cName; finalMime = 'video/mp4'; compressed = true;
        }
      } catch (e: any) { this.logger.warn(`[Library] FFmpeg thất bại: ${e.message}`); }
    } else if (isVideo) {
      this.logger.log(`[Library] File nhỏ (${(originalSize / 1024 / 1024).toFixed(1)}MB), bỏ qua nén để tiết kiệm thời gian.`);
    }

    const fileSize = fs.statSync(finalPath).size;
    let url: string, storage: string;

    if (this.supabase.isAvailable()) {
      try {
        url = await this.supabase.uploadFromPath(finalPath, finalName, finalMime);
        storage = 'supabase';
        this.logger.log(`[Library] ✅ Supabase: ${finalName}`);
      } catch (e: any) {
        this.logger.warn(`[Library] Supabase thất bại (${e.message}), dùng DB`);
        url = await this._storeInDb(finalPath, finalName, finalMime, fileSize, opts.baseUrl);
        storage = 'db';
      }
    } else {
      url = await this._storeInDb(finalPath, finalName, finalMime, fileSize, opts.baseUrl);
      storage = 'db';
      this.logger.log(`[Library] ✅ Postgres DB: ${finalName}`);
    }

    // Generate Thumbnail for videos
    let thumbnail_url: string | null = null;
    if (isVideo && ffmpegPath) {
      const thumbName = `thumb_${baseName}.jpg`, thumbPath = path.join(UPLOAD_DIR, thumbName);
      try {
        this.logger.log(`[Library] Đang tạo thumbnail cho ${finalName}...`);
        await execAsync(`"${ffmpegPath}" -y -ss 1 -i "${finalPath}" -vframes 1 -q:v 2 "${thumbPath}"`, { timeout: 30_000 });
        if (fs.existsSync(thumbPath)) {
          this.logger.log(`[Library] Đã tạo xong file tạm thumbnail: ${thumbPath}`);
          if (this.supabase.isAvailable()) {
            thumbnail_url = await this.supabase.uploadFromPath(thumbPath, thumbName, 'image/jpeg');
            this.logger.log(`[Library] ✅ Đã upload thumbnail lên Supabase: ${thumbnail_url}`);
          } else {
            thumbnail_url = await this._storeInDb(thumbPath, thumbName, 'image/jpeg', fs.statSync(thumbPath).size, opts.baseUrl);
          }
          try { fs.unlinkSync(thumbPath); } catch {}
        } else {
          this.logger.warn(`[Library] ❌ FFmpeg chạy xong nhưng không thấy file thumbnail tại: ${thumbPath}`);
        }
      } catch (e: any) { 
        this.logger.error(`[Library] ❌ Lỗi tạo Thumbnail: ${e.message}`); 
      }
    }

    try { fs.unlinkSync(filePath); } catch { }
    if (compressed && finalPath !== filePath) try { fs.unlinkSync(finalPath); } catch { }

    await this.save(userId, { filename: finalName, originalname: opts.originalname, mimetype: finalMime, size: fileSize, url, thumbnail_url, storage })
      .catch(err => this.logger.error(`[Library] ❌ Lỗi lưu metadata vào DB: ${err.message}`));
    return { url, thumbnail_url, filename: finalName, originalname: opts.originalname, mimetype: finalMime, size: fileSize, storage };
  }

  private async _storeInDb(filePath: string, filename: string, mimetype: string, size: number, baseUrl: string): Promise<string> {
    const buffer = fs.readFileSync(filePath);
    await this.prisma.socialMediaFile.create({ data: { post_id: null, filename, mimetype, size, data: buffer } });
    return `${baseUrl}/api/social/media/${filename}`;
  }

  async save(userId: string, file: { filename: string; originalname: string; mimetype: string; size: number; url: string; thumbnail_url?: string | null; storage: string }) {
    this.logger.log(`[Library] Đang lưu file cho User: ${userId} | File: ${file.originalname}`);
    if (!modelReady(this.prisma)) { this.logger.warn('[Library] Model chưa sẵn sàng — bỏ qua save metadata'); return null; }
    try {
      const model = this.getModel();
      return await model.create({ data: { user_id: userId, ...file } });
    } catch (err: any) {
      if (isNotReady(err)) { this.logger.warn('[Library] Bảng chưa tồn tại — chạy migration SQL'); return null; }
      this.logger.error(`[Library] ❌ Lỗi khi lưu vào DB: ${err.message}`);
      throw err;
    }
  }

  private getModel() {
    return (this.prisma as any).socialUploadedFile || (this.prisma as any).SocialUploadedFile;
  }

  async list(userId: string, page = 1, limit = 20) {
    this.logger.log(`[Library] Đang lấy danh sách cho User: ${userId} (Page: ${page})`);
    if (!modelReady(this.prisma)) { this.logger.warn('[Library] Prisma generate chưa chạy'); return EMPTY_LIST; }
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
      await this.prisma.socialMediaFile.deleteMany({ where: { filename: file.filename } }).catch(() => { });
      if (file.storage === 'supabase') await this.supabase.delete([file.filename]).catch(() => { });
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
