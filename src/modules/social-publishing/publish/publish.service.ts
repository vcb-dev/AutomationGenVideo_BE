import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AccountsService } from '../accounts/accounts.service';
import { CryptoService } from '../crypto/crypto.service';
import { FacebookPublisher } from './platforms/facebook.platform';
import { InstagramPublisher } from './platforms/instagram.platform';
import { ThreadsPublisher } from './platforms/threads.platform';
import { YoutubePublisher } from './platforms/youtube.platform';
import { GoogleDriveStorageService } from '../upload/google-drive-storage.service';
import { HistoryService } from '../history/history.service';
import { NotificationStreamService } from '../../../common/push/notification-stream.service';
import { SocialPlatform, SocialPostSource, SocialPostStatus } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type PreparedMedia = { url: string; tempFile: string | null };

/** Semaphore đơn giản: giới hạn số tác vụ nặng (FFmpeg/transcode, Drive download) chạy đồng thời */
class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly max: number) {}

  acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve(() => this.release());
    }
    return new Promise(resolve => {
      this.queue.push(() => {
        this.active++;
        resolve(() => this.release());
      });
    });
  }

  private release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

function extractDriveFileId(url: string): string | null {
  try {
    const u = new URL(url);
    const id = u.searchParams.get('id');
    if (id) return id;
  } catch { }
  const match = url.match(/\/file\/d\/([^/?#]+)/);
  return match?.[1] || null;
}

function extensionForMime(mimetype?: string | null, fallback = '.mp4'): string {
  if (mimetype === 'image/jpeg' || mimetype === 'image/jpg') return '.jpg';
  if (mimetype === 'image/png') return '.png';
  if (mimetype === 'image/gif') return '.gif';
  if (mimetype === 'image/webp') return '.webp';
  if (mimetype === 'video/mp4') return '.mp4';
  return fallback;
}

function ensureExt(filename: string, ext: string): string {
  return path.extname(filename) ? filename : `${filename}${ext}`;
}

@Injectable()
export class PublishService {
  private readonly logger = new Logger(PublishService.name);
  private readonly driveLocalCache = new Map<string, Promise<PreparedMedia>>();
  // Đếm số lượt đăng đang dùng mỗi file tạm — bộ dọn rác không xoá file còn người dùng.
  private readonly mediaInUse = new Map<string, number>();

  // Giới hạn số request publishNow chạy đồng thời (FFmpeg transcode + Drive download
  // rất nặng CPU/RAM) — tránh nhiều người bấm "Đăng ngay" cùng lúc làm sập server.
  private readonly publishNowSemaphore = new Semaphore(4);
  // Chặn double-click / submit trùng: nếu 1 request publishNow giống hệt (cùng user +
  // account + nội dung) đang xử lý, trả lại promise đang chạy thay vì đăng 2 lần.
  private readonly inFlightPublishNow = new Map<string, Promise<any>>();
  // Trần ffmpeg DÙNG CHUNG cho CẢ worker lẫn sync publishNow. publishNowSemaphore chỉ chặn
  // đường sync; worker transcode riêng (cap MAX_HEAVY_JOBS=5). Không có trần chung này thì
  // worst case 4 (sync) + 5 (worker) = 9 ffmpeg × threads=4 → bão CPU/OOM trên Railway.
  // Tune qua env SOCIAL_TRANSCODE_CONCURRENCY (mặc định 2).
  private readonly transcodeSemaphore = new Semaphore(
    Math.max(1, parseInt(process.env.SOCIAL_TRANSCODE_CONCURRENCY || '2', 10) || 2),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly crypto: CryptoService,
    private readonly fb: FacebookPublisher,
    private readonly ig: InstagramPublisher,
    private readonly threads: ThreadsPublisher,
    private readonly yt: YoutubePublisher,
    private readonly googleDrive: GoogleDriveStorageService,
    private readonly history: HistoryService,
    private readonly notifyStream: NotificationStreamService,
  ) { }

  private async makeUrlsPublic(mediaUrls: string[], _platform?: SocialPlatform): Promise<string[]> {
    if (!mediaUrls || mediaUrls.length === 0) return [];

    const publicBaseUrl = process.env.PUBLIC_BASE_URL;
    const resultUrls: string[] = [];

    for (const url of mediaUrls) {
      if (url.includes('localhost') || url.includes('127.0.0.1')) {
        try {
          const localUrl = new URL(url);
          if (!publicBaseUrl) {
            this.logger.warn('[makeUrlsPublic] PUBLIC_BASE_URL chưa được cấu hình — localhost URLs sẽ không được convert');
            resultUrls.push(url);
            continue;
          }

          const converted = `${publicBaseUrl}${localUrl.pathname}`;
          this.logger.log(`[makeUrlsPublic] ${url} → ${converted}`);
          resultUrls.push(converted);
        } catch (e) {
          resultUrls.push(url);
        }
      } else {
        resultUrls.push(url);
      }
    }

    return resultUrls;
  }

  /** Khởi động download Drive trước (non-blocking) để sẵn sàng trong cache khi executePost chạy */
  preWarmDownloads(posts: { platform: string; media_urls: string[] }[]): void {
    for (const post of posts) {
      if (!post.media_urls?.length) continue;
      const platform = post.platform as SocialPlatform;
      const useDirectDriveUrl = platform === SocialPlatform.YOUTUBE;
      if (useDirectDriveUrl) continue;
      this.prepareMediaUrlsForPublishing(post.media_urls, platform)
        .catch((err: any) => this.logger.warn(`[PreWarm] ${post.platform}: ${err.message}`));
    }
  }

  private async prepareMediaUrlsForPublishing(mediaUrls: string[], platform?: SocialPlatform): Promise<{ urls: string[]; tempFiles: string[] }> {
    if (!mediaUrls || !mediaUrls.length) return { urls: [], tempFiles: [] };

    const uploadBase = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social');
    if (!fs.existsSync(uploadBase)) fs.mkdirSync(uploadBase, { recursive: true });

    const base = process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;

    // YouTube tự stream từ Drive URL (server BE download, không qua server của platform)
    // → dùng direct URL để tiết kiệm disk + giữ nguyên chất lượng gốc.
    //
    // Facebook, Instagram, Threads: server của platform tải từ Drive URL
    // → Drive có thể chặn hoặc redirect IP lạ → download về /tmp/ trước.
    // Threads đặc biệt còn cần transcode (needsTranscode=true) — transcode chỉ hoạt động
    // khi URL là /api/social/media/ (local), nếu dùng Drive URL trực tiếp thì transcode bị bỏ qua.
    const useDirectDriveUrl = platform === SocialPlatform.YOUTUBE;

    this.logger.log(`[PrepareMedia] platform=${platform} useDirectDriveUrl=${useDirectDriveUrl} driveAvailable=${this.googleDrive.isAvailable()} urls=${JSON.stringify(mediaUrls)}`);

    const results = await Promise.all(mediaUrls.map(async (url): Promise<PreparedMedia> => {
      if (url.includes('drive.google.com') || url.includes('docs.google.com') || url.includes('googleusercontent')) {
        try {
          const fileId = extractDriveFileId(url);
          if (fileId) {
            const media = await (this.prisma as any).socialUploadedFile?.findFirst?.({
              where: { OR: [{ drive_file_id: fileId }, { url }] },
              select: { filename: true, originalname: true, mimetype: true },
            }).catch(() => null);
            const filename = ensureExt(
              media?.filename || media?.originalname || `media_${fileId}`,
              extensionForMime(media?.mimetype, '.mp4'),
            );

            if (useDirectDriveUrl) {
              const driveDirectUrl = this.googleDrive.buildDownloadUrl(fileId, filename);
              this.logger.log(`[PrepareMedia] Drive fileId=${fileId} -> direct URL cho ${platform} (${filename})`);
              return { url: driveDirectUrl, tempFile: null };
            }

            const cacheKey = `${fileId}:${extensionForMime(media?.mimetype, path.extname(filename) || '.mp4')}`;
            if (this.driveLocalCache.has(cacheKey)) {
              this.logger.log(`[PrepareMedia] Cache hit Drive fileId=${fileId}`);
              return this.driveLocalCache.get(cacheKey)!;
            }

            const ext = extensionForMime(media?.mimetype, path.extname(filename) || '.mp4');
            const localName = `gd_${Date.now()}_${Math.random().toString(36).slice(2)}_${fileId}${ext}`;
            const localPath = path.join(uploadBase, localName);
            this.logger.log(`[PrepareMedia] Download Drive fileId=${fileId} -> ${localName}`);
            const downloadPromise = this.googleDrive.downloadFileToLocal(fileId, localPath).then(() => {
              const localMediaUrl = `${base}/api/social/media/${localName}`;
              this.logger.log(`[PrepareMedia] OK ${localName}`);
              setTimeout(() => this.driveLocalCache.delete(cacheKey), 10 * 60 * 1000);
              return { url: localMediaUrl, tempFile: localPath };
            }).catch((err: any) => {
              this.driveLocalCache.delete(cacheKey); // xóa ngay để lần sau retry được
              throw err;
            });
            this.driveLocalCache.set(cacheKey, downloadPromise);
            return downloadPromise;
          }
        } catch (err: any) {
          this.logger.warn(`[PrepareMedia] Drive URL failed ${url}: ${err.message}`);
        }
      }
      return { url, tempFile: null };
    }));

    return {
      urls: results.map(r => r.url),
      tempFiles: results.map(r => r.tempFile).filter((f): f is string => f !== null),
    };
  }

  async publishNow(userId: string, dto: {
    accountId: string;
    message: string;
    mediaUrls?: string[];
    pageId?: string;
    privacy?: string;
  }) {
    const dedupKey = `${userId}:${dto.accountId}:${crypto
      .createHash('sha1')
      .update(`${dto.message}|${JSON.stringify(dto.mediaUrls || [])}|${dto.pageId || ''}`)
      .digest('hex')}`;

    const existing = this.inFlightPublishNow.get(dedupKey);
    if (existing) {
      this.logger.warn(`[PublishNow] Request trùng (double-click?) cho key=${dedupKey} — trả về kết quả của request đang xử lý`);
      return existing;
    }

    const task = this.publishNowInternal(userId, dto).finally(() => {
      // Giữ key thêm 3s sau khi xong để chặn click trùng đến muộn do network jitter
      setTimeout(() => this.inFlightPublishNow.delete(dedupKey), 3000);
    });
    this.inFlightPublishNow.set(dedupKey, task);
    return task;
  }

  private async publishNowInternal(userId: string, dto: {
    accountId: string;
    message: string;
    mediaUrls?: string[];
    pageId?: string;
    privacy?: string;
  }) {
    const release = await this.publishNowSemaphore.acquire();
    try {
      return await this.doPublishNow(userId, dto);
    } finally {
      release();
    }
  }

  private async doPublishNow(userId: string, dto: {
    accountId: string;
    message: string;
    mediaUrls?: string[];
    pageId?: string;
    privacy?: string;
  }) {
    const account = await this.accounts.findOne(dto.accountId, userId);
    const token = this.crypto.decrypt(account.access_token_enc);
    const extraData = account.extra_data as any;

    this.logger.log(`[PublishNow] ${account.platform} "${account.name}" | platformId=${account.platform_id} | igUserId=${extraData?.igUserId} | pageId=${extraData?.pageId} | mediaUrls=${JSON.stringify(dto.mediaUrls)}`);

    const needsTranscode = account.platform === SocialPlatform.INSTAGRAM ||
      account.platform === SocialPlatform.THREADS;
    const prep = await this.prepareMediaUrlsForPublishing(dto.mediaUrls || [], account.platform);
    let inputMediaUrls = prep.urls;
    const transcodedFiles: string[] = [...prep.tempFiles];
    // Giữ chỗ ngay sau khi nhận file (kể cả khi trúng cache Drive) — nếu không, bộ dọn
    // rác của một lượt đăng khác có thể xoá file ngay giữa lúc lượt này đang upload.
    this.acquireMedia(transcodedFiles);

    // try/finally BẮT BUỘC: giữa acquireMedia và lúc trả chỗ còn transcode và
    // makeUrlsPublic — cả hai đều await và đều có thể ném lỗi. Không bọc thì bộ đếm
    // rò vĩnh viễn, file bị giữ và mediaInUse phình dần. executeScheduled đã dùng
    // finally, đường này thì chưa — nay đồng bộ lại.
    try {
    if (needsTranscode) {
      const results = await Promise.all(inputMediaUrls.map(u => this.transcodeVideoForPlatform(u)));
      results.forEach((newUrl, i) => {
        if (newUrl !== inputMediaUrls[i]) {
          try {
            const fname = new URL(newUrl).pathname.split('/').pop()!;
            const base = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social');
            if (fname) transcodedFiles.push(path.join(base, fname));
          } catch (e: any) { this.logger.warn(`[Transcode] Không extract được tên file từ URL ${newUrl}: ${e.message}`); }
        }
      });
      inputMediaUrls = results;
    }

    const publicMediaUrls = await this.makeUrlsPublic(inputMediaUrls, account.platform);
    this.logger.log(`[PublishNow] ${account.platform} sẽ dùng URLs: ${JSON.stringify(publicMediaUrls)}`);

    let result: any;
    try {
      result = await this.dispatchPublish(account.platform, token, {
        message: dto.message,
        mediaUrls: publicMediaUrls,
        pageId: dto.pageId || extraData?.pageId,
        privacy: dto.privacy,
        extraData,
        accountId: dto.accountId,
        platformId: account.platform_id,
      });
    } catch (err: any) {
      const apiErr = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      this.logger.error(`[PublishNow] ❌ ${account.platform} "${account.name}": ${apiErr}`);
      await this.savePost(userId, dto.accountId, account.platform, dto, SocialPostStatus.FAILED, SocialPostSource.IMMEDIATE, undefined, apiErr);
      throw new Error(apiErr);
    }

    const saved = await this.savePost(userId, dto.accountId, account.platform, dto, SocialPostStatus.COMPLETED, SocialPostSource.IMMEDIATE, result);
    this.archiveMediaAsync(saved.id, dto.mediaUrls || []).catch((err: any) => this.logger.warn(`[Archive] archiveMediaAsync failed: ${err.message}`));
    return { success: true, platform: account.platform, result };
    } finally {
      this.releaseMedia(transcodedFiles);
      this.scheduleCleanupTranscoded(transcodedFiles);
    }
  }

  /** Gọi bởi ScheduleService */
  async executeScheduled(post: any) {
    this.logger.log(`[ExecuteScheduled] postId=${post.id} platform=${post.platform} accountId=${post.account_id} mediaUrls=${JSON.stringify(post.media_urls)}`);
    const account = await this.prisma.socialAccount.findUnique({ where: { id: post.account_id } });
    if (!account || !account.is_active) {
      this.logger.error(`[ExecuteScheduled] ❌ postId=${post.id} — account=${post.account_id} không tồn tại hoặc đã ngắt kết nối`);
      throw new Error('Account không tồn tại hoặc đã bị ngắt kết nối');
    }

    const token = this.crypto.decrypt(account.access_token_enc);
    const extraData = account.extra_data as any;

    const needsTranscode = account.platform === SocialPlatform.INSTAGRAM ||
      account.platform === SocialPlatform.THREADS;
    const prep = await this.prepareMediaUrlsForPublishing(post.media_urls || [], account.platform);
    let inputMediaUrls = prep.urls;
    const transcodedFiles: string[] = [...prep.tempFiles];
    // Giữ chỗ ngay sau khi nhận file (kể cả khi trúng cache Drive) — nếu không, bộ dọn
    // rác của một lượt đăng khác có thể xoá file ngay giữa lúc lượt này đang upload.
    this.acquireMedia(transcodedFiles);

    if (needsTranscode) {
      const results = await Promise.all(inputMediaUrls.map((u: string) => this.transcodeVideoForPlatform(u)));
      results.forEach((newUrl: string, i: number) => {
        if (newUrl !== inputMediaUrls[i]) {
          try {
            const fname = new URL(newUrl).pathname.split('/').pop()!;
            const base = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social');
            if (fname) transcodedFiles.push(path.join(base, fname));
          } catch (e: any) { this.logger.warn(`[Transcode] Không extract được tên file từ URL ${newUrl}: ${e.message}`); }
        }
      });
      inputMediaUrls = results;
    }

    const publicMediaUrls = await this.makeUrlsPublic(inputMediaUrls, account.platform);
    this.logger.log(`[ExecuteScheduled] postId=${post.id} ${account.platform} sẽ dùng URLs: ${JSON.stringify(publicMediaUrls)}`);

    try {
      const result = await this.dispatchPublish(account.platform, token, {
        message: post.message,
        mediaUrls: publicMediaUrls,
        pageId: post.page_id || extraData?.pageId,
        privacy: post.privacy,
        extraData,
        accountId: post.account_id,
        platformId: account.platform_id,
        thumbUrl: post.thumb_url || undefined,
      });
      this.logger.log(`[ExecuteScheduled] ✅ postId=${post.id} ${account.platform} "${account.name}" đăng thành công`);
      return result;
    } catch (err: any) {
      const apiErr = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      this.logger.error(`[ExecuteScheduled] ❌ postId=${post.id} ${account.platform} "${account.name}": ${apiErr}`, err.stack);
      const enrichedErr = new Error(apiErr);
      enrichedErr.stack = err.stack;
      throw enrichedErr;
    } finally {
      this.releaseMedia(transcodedFiles);
      this.scheduleCleanupTranscoded(transcodedFiles);
    }
  }

  // Cache: sourceUrl → Promise<transcodedUrl> — tránh transcode 2 lần khi IG + Threads cùng dùng 1 video
  private readonly transcodeCache = new Map<string, Promise<string>>();

  private transcodeVideoForPlatform(localUrl: string): Promise<string> {
    if (!localUrl.includes('/api/social/media/')) return Promise.resolve(localUrl);
    if (!/\.mp4(\?|$)/i.test(localUrl)) return Promise.resolve(localUrl);

    // Nếu đang transcode URL này rồi (do request khác), chờ kết quả đó luôn
    if (this.transcodeCache.has(localUrl)) {
      this.logger.log(`[Transcode] Cache hit cho: ${localUrl}`);
      return this.transcodeCache.get(localUrl)!;
    }

    const promise = this._doTranscode(localUrl).finally(() => {
      // Giữ cache 10 phút rồi xóa
      setTimeout(() => this.transcodeCache.delete(localUrl), 10 * 60 * 1000);
    });

    this.transcodeCache.set(localUrl, promise);
    return promise;
  }

  /** Tìm FFmpeg: ưu tiên env → /usr/bin/ffmpeg (Docker) → null */
  private resolveFFmpegPath(): string | null {
    const fromEnv = process.env.FFMPEG_PATH;
    if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
    // Fallback: ffmpeg đã cài qua apk/apt trong Docker
    if (fs.existsSync('/usr/bin/ffmpeg')) return '/usr/bin/ffmpeg';
    this.logger.warn('[FFmpeg] Không tìm thấy ffmpeg — bỏ qua transcode/nén');
    return null;
  }

  /** Tìm ffprobe: env → cạnh ffmpeg → /usr/bin/ffprobe → null */
  private resolveFFprobePath(): string | null {
    const fromEnv = process.env.FFPROBE_PATH;
    if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
    const ffmpeg = process.env.FFMPEG_PATH;
    if (ffmpeg && fs.existsSync(ffmpeg)) {
      const candidate = path.join(path.dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
      if (fs.existsSync(candidate)) return candidate;
    }
    if (fs.existsSync('/usr/bin/ffprobe')) return '/usr/bin/ffprobe';
    return null;
  }

  /**
   * Kiểm tra video đã đạt chuẩn IG/Threads chưa → nếu rồi thì bỏ qua transcode (tiết kiệm 10-40s).
   * Conservative: bất kỳ nghi ngờ nào (không probe được, đọc thiếu thông tin) → false (vẫn transcode).
   */
  private async isVideoCompliant(inputPath: string): Promise<boolean> {
    const ffprobePath = this.resolveFFprobePath();
    if (!ffprobePath) return false;
    try {
      const { stdout } = await execFileAsync(ffprobePath, [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=codec_name,pix_fmt,profile,avg_frame_rate,r_frame_rate,bit_rate',
        '-of', 'json',
        inputPath,
      ], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });

      const v = JSON.parse(stdout)?.streams?.[0];
      if (!v) return false;

      const codec = String(v.codec_name || '').toLowerCase();
      const pixFmt = String(v.pix_fmt || '').toLowerCase();
      const profile = String(v.profile || '').toLowerCase();
      if (codec !== 'h264') return false;
      if (pixFmt !== 'yuv420p') return false;
      if (!['constrained baseline', 'baseline', 'main', 'high'].includes(profile)) return false;

      // CFR: avg_frame_rate ≈ r_frame_rate (VFR sẽ bị IG/Threads từ chối → cần transcode)
      const parseFps = (s: any): number => {
        const [n, d] = String(s || '0/1').split('/').map(Number);
        return d ? n / d : 0;
      };
      const avg = parseFps(v.avg_frame_rate);
      const r = parseFps(v.r_frame_rate);
      if (avg <= 0 || avg > 60) return false;
      if (Math.abs(avg - r) > 0.5) return false;

      // Bitrate quá cao → nén lại cho nhẹ (nếu đọc được)
      const bitRate = Number(v.bit_rate || 0);
      if (bitRate > 12_000_000) return false;

      return true;
    } catch (e: any) {
      this.logger.warn(`[Transcode] ffprobe lỗi (${e.message}) → vẫn transcode cho chắc`);
      return false;
    }
  }

  private async _doTranscode(localUrl: string): Promise<string> {
    const ffmpegPath = this.resolveFFmpegPath();
    if (!ffmpegPath) return localUrl;

    try {
      const urlObj = new URL(localUrl);
      const filename = path.basename(urlObj.pathname.split('?')[0]);
      const uploadBase = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social');
      const inputPath = path.join(uploadBase, filename);
      if (!fs.existsSync(inputPath)) return localUrl;

      // Bỏ qua transcode nếu video đã đạt chuẩn IG/Threads (tiết kiệm 10-40s).
      // Tắt tối ưu này bằng env SOCIAL_TRANSCODE_SKIP=false nếu gặp video bị nền tảng từ chối.
      if (process.env.SOCIAL_TRANSCODE_SKIP !== 'false' && await this.isVideoCompliant(inputPath)) {
        this.logger.log(`[Transcode] ⏭️ Bỏ qua — ${filename} đã đạt chuẩn H.264/yuv420p/CFR`);
        return localUrl;
      }

      const transcodedName = `tc_${Date.now()}_${filename}`;
      const outputPath = path.join(uploadBase, transcodedName);

      // H.264 high, CRF 20, cap 8Mbps, CFR 30fps, yuv420p, faststart
      // -map_metadata -1: xóa metadata lạ (Hw, te_is_reencode, bitrate tag) khiến IG/Threads reject
      // -fps_mode cfr -r 30: constant frame rate bắt buộc cho Instagram/Threads
      // -pix_fmt yuv420p: pixel format chuẩn
      // '-map 0:a:0?' — dấu '?' làm audio map optional: không crash nếu video không có audio
      // threads=4: Railway có CPU limit thấp — threads=0 (auto=60) gây OOM/kill
      // Gate qua semaphore DÙNG CHUNG (worker + sync) — chờ slot nếu đang đầy.
      const releaseTranscode = await this.transcodeSemaphore.acquire();
      let start = Date.now();
      try {
        this.logger.log(`[Transcode] Bắt đầu transcode ${filename} → ${transcodedName}...`);
        start = Date.now(); // reset sau khi có slot → đo đúng thời gian encode, không tính thời gian chờ
        await execFileAsync(ffmpegPath, [
          '-y', '-i', inputPath,
          '-map', '0:v:0', '-map', '0:a:0?',
          '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '4',
          '-profile:v', 'baseline', '-level', '4.0',
          '-crf', '23', '-maxrate', '8M', '-bufsize', '16M',
          '-r', '30', '-fps_mode', 'cfr', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
          '-map_metadata', '-1', '-movflags', '+faststart',
          outputPath,
        ], { timeout: 300000, maxBuffer: 10 * 1024 * 1024 });
      } finally {
        releaseTranscode();
      }

      if (!fs.existsSync(outputPath)) {
        this.logger.warn(`[Transcode] File output không tồn tại sau transcode: ${outputPath}`);
        return localUrl;
      }
      const outputSize = fs.statSync(outputPath).size;
      this.logger.log(`[Transcode] Hoàn thành ${transcodedName} trong ${((Date.now() - start) / 1000).toFixed(1)}s | size: ${(outputSize / 1024 / 1024).toFixed(1)}MB`);

      // Cloud Run: dùng PUBLIC_BASE_URL thay vì 127.0.0.1 (sẽ được convert bởi makeUrlsPublic)
      const base = process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
      return `${base}/api/social/media/${transcodedName}`;
    } catch (err: any) {
      this.logger.warn(`[Transcode] Thất bại: ${err.message} — dùng file gốc`);
      return localUrl;
    }
  }

  /** Đánh dấu file tạm đang được một lượt đăng sử dụng */
  private acquireMedia(filePaths: string[]): void {
    for (const p of filePaths) this.mediaInUse.set(p, (this.mediaInUse.get(p) ?? 0) + 1);
  }

  /** Trả lại file tạm khi lượt đăng kết thúc */
  private releaseMedia(filePaths: string[]): void {
    for (const p of filePaths) {
      const remaining = (this.mediaInUse.get(p) ?? 1) - 1;
      if (remaining <= 0) this.mediaInUse.delete(p);
      else this.mediaInUse.set(p, remaining);
    }
  }

  /**
   * Xoá file tạm sau 10 phút, nhưng bỏ qua file đang có lượt đăng khác dùng.
   *
   * driveLocalCache giữ kết quả tải Drive trong 10 phút tính từ lúc tải xong, còn
   * bộ dọn này đếm 10 phút từ lúc bài đăng xong — hai mốc lệch nhau. Lượt đăng thứ
   * hai trúng cache ở phút thứ 9 sẽ nhận URL trỏ tới file bị xoá ngay sau đó.
   *
   * Hoãn tối đa 3 lần rồi xoá dù sao, để một bộ đếm rò rỉ không giữ file mãi mãi.
   */
  private scheduleCleanupTranscoded(filePaths: string[], attempt = 1, maxAttempts = 3) {
    if (!filePaths.length) return;
    setTimeout(() => {
      const stillInUse: string[] = [];
      for (const p of filePaths) {
        if (attempt < maxAttempts && (this.mediaInUse.get(p) ?? 0) > 0) {
          stillInUse.push(p);
          continue;
        }
        try {
          if (fs.existsSync(p)) { fs.unlinkSync(p); this.logger.log(`[Transcode] Đã xóa temp file: ${p}`); }
        } catch (e: any) {
          this.logger.warn(`[Transcode] Không xóa được temp file ${p}: ${e.message}`);
        }
      }
      if (stillInUse.length) {
        this.logger.log(`[Transcode] Hoãn xoá ${stillInUse.length} file đang được dùng (lần ${attempt}/${maxAttempts})`);
        this.scheduleCleanupTranscoded(stillInUse, attempt + 1, maxAttempts);
      }
    }, 10 * 60 * 1000); // Tăng lên 10 phút để cache còn hiệu lực
  }

  private async getDecryptedRefreshToken(accountId: string): Promise<string | undefined> {
    const account = await this.prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (!account?.refresh_token_enc) return undefined;
    try { return this.crypto.decrypt(account.refresh_token_enc); } catch { return undefined; }
  }

  private async dispatchPublish(platform: SocialPlatform, token: string, opts: {
    message: string;
    mediaUrls: string[];
    pageId?: string;
    privacy?: string;
    extraData?: any;
    accountId?: string;
    platformId?: string;
    thumbUrl?: string;
  }) {
    const extra = opts.extraData || {};

    switch (platform) {

      case SocialPlatform.FACEBOOK:
        return this.fb.publish(token, {
          message: opts.message,
          mediaUrls: opts.mediaUrls,
          // Ưu tiên: extraData.pageId > opts.pageId
          // Nếu account là type='page', platformId có dạng "page_xxxx" → lấy pageId từ extraData
          pageId: extra.pageId || opts.pageId,
          // Chỉ truyền privacy nếu KHÔNG phải page post (Page luôn public)
          privacy: extra.type === 'page' ? undefined : opts.privacy,
          extraData: extra,
        });

      case SocialPlatform.INSTAGRAM: {
        // Thứ tự ưu tiên: extraData.igUserId → platformId → throw
        const igUserId = extra.igUserId || opts.platformId;
        if (!igUserId) throw new BadRequestException('Thiếu Instagram User ID — hãy kết nối lại tài khoản');
        return this.ig.publish(token, {
          caption: opts.message,
          mediaUrls: opts.mediaUrls,
          igUserId,
          accountType: extra.type, // 'instagram_business' | 'instagram_direct'
        });
      }

      case SocialPlatform.THREADS: {
        // Thứ tự ưu tiên: extraData.platformId → account.platform_id → throw
        const userId = extra.platformId || extra.userId || opts.platformId;
        if (!userId) {
          throw new BadRequestException(
            `Thiếu Threads User ID. extraData=${JSON.stringify(extra)}, platformId=${opts.platformId}`
          );
        }
        return this.threads.publish(token, { text: opts.message, mediaUrls: opts.mediaUrls, userId });
      }

      case SocialPlatform.YOUTUBE: {
        const refreshToken = opts.accountId ? await this.getDecryptedRefreshToken(opts.accountId) : undefined;
        const ytAccount = opts.accountId ? await this.prisma.socialAccount.findUnique({ where: { id: opts.accountId }, select: { token_expires_at: true } }) : null;
        return this.yt.publish(token, {
          title: opts.message.substring(0, 100),
          description: opts.message,
          privacy: opts.privacy,
          mediaUrls: opts.mediaUrls,
          thumbUrl: opts.thumbUrl,
          refreshToken,
          tokenExpiresAt: ytAccount?.token_expires_at ?? undefined,
          onTokenRefreshed: opts.accountId ? async (newToken: string, expiresAt: Date) => {
            try {
              const encryptedToken = this.crypto.encrypt(newToken);
              await this.prisma.socialAccount.update({
                where: { id: opts.accountId },
                data: { access_token_enc: encryptedToken, token_expires_at: expiresAt, updated_at: new Date() },
              });
              this.logger.log(`[YouTube] Token mới đã được lưu cho account ${opts.accountId}`);
            } catch (e: any) {
              this.logger.warn(`[YouTube] Không thể lưu token mới: ${e.message}`);
            }
          } : undefined,
        });
      }

      default:
        throw new BadRequestException(`Platform chưa hỗ trợ: ${platform}`);
    }
  }

  private async savePost(
    userId: string, accountId: string, platform: SocialPlatform,
    dto: any, status: SocialPostStatus, source: SocialPostSource,
    result?: any, errorMsg?: string,
  ) {
    const post = await this.prisma.socialPost.create({
      data: {
        user_id: userId, account_id: accountId, platform, source, status,
        message: dto.message, media_urls: dto.mediaUrls || [],
        page_id: dto.pageId, privacy: dto.privacy,
        result, error_msg: errorMsg, executed_at: new Date(),
        updated_at: new Date(),
      },
    });

    if (status === SocialPostStatus.FAILED) {
      this.history.getFailedPostAudience(userId)
        .then((audience) => this.notifyStream.emitMany(audience))
        .catch(() => {});
    }

    return post;
  }

  /**
   * Đăng bài bất đồng bộ — trả về ngay postId, worker xử lý trong ≤10 giây.
   * Dùng khi FE muốn UX nhanh, sau đó poll GET /social/publish/:postId để lấy kết quả.
   */
  async publishAsync(userId: string, dto: {
    accountId: string; message: string; mediaUrls?: string[];
    pageId?: string; privacy?: string;
  }) {
    const account = await this.accounts.findOne(dto.accountId, userId);

    const post = await this.prisma.socialPost.create({
      data: {
        user_id: userId,
        account_id: dto.accountId,
        platform: account.platform,
        message: dto.message,
        media_urls: dto.mediaUrls ?? [],
        page_id: dto.pageId,
        privacy: dto.privacy,
        scheduled_at: new Date(), // đến hạn ngay lập tức
        source: SocialPostSource.IMMEDIATE,
        status: SocialPostStatus.PENDING,
        updated_at: new Date(),
      },
    });

    this.logger.log(`[PublishAsync] Queued post ${post.id} (${account.platform}) — worker sẽ xử lý ngay`);
    return { postId: post.id, status: 'PENDING', platform: account.platform };
  }

  /** Lấy trạng thái 1 post (dùng để poll sau publishAsync) */
  async getPostStatus(postId: string, userId: string) {
    const post = await this.prisma.socialPost.findFirst({
      where: { id: postId, user_id: userId },
      select: { id: true, status: true, platform: true, result: true, error_msg: true, executed_at: true },
    });
    if (!post) throw new BadRequestException('Post không tồn tại');
    return post;
  }

  public async archiveMediaAsync(postId: string, mediaUrls: string[]): Promise<void> {
    if (!mediaUrls?.length) return;

    const uploadBase = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social');

    for (const url of mediaUrls) {
      if (!url.includes('/api/social/media/')) continue;

      const rawName = url.split('/api/social/media/').pop()!.split('?')[0];
      const filename = path.basename(rawName); // chống path traversal: mediaUrls do user cung cấp
      const inputPath = path.join(uploadBase, filename);

      try {
        if (fs.existsSync(inputPath)) {
          fs.unlinkSync(inputPath);
          this.logger.log(`[Archive] Deleted local temp media for post ${postId}: ${filename}`);
        }
      } catch (err: any) {
        this.logger.warn(`[Archive] Could not delete local temp media ${filename}: ${err.message}`);
      }
    }
  }
}
