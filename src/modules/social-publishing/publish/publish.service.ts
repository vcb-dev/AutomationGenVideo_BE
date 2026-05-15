import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AccountsService } from '../accounts/accounts.service';
import { CryptoService } from '../crypto/crypto.service';
import { FacebookPublisher } from './platforms/facebook.platform';
import { InstagramPublisher } from './platforms/instagram.platform';
import { TiktokPublisher } from './platforms/tiktok.platform';
import { ThreadsPublisher } from './platforms/threads.platform';
import { YoutubePublisher } from './platforms/youtube.platform';
import { ZaloPublisher } from './platforms/zalo.platform';
import { SocialPlatform, SocialPostSource, SocialPostStatus } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

@Injectable()
export class PublishService {
  private readonly logger = new Logger(PublishService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly crypto: CryptoService,
    private readonly fb: FacebookPublisher,
    private readonly ig: InstagramPublisher,
    private readonly tt: TiktokPublisher,
    private readonly threads: ThreadsPublisher,
    private readonly yt: YoutubePublisher,
    private readonly zalo: ZaloPublisher,
  ) {}

  private async makeUrlsPublic(mediaUrls: string[], platform?: SocialPlatform): Promise<string[]> {
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

  async publishNow(userId: string, dto: {
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
                           account.platform === SocialPlatform.THREADS || 
                           account.platform === SocialPlatform.FACEBOOK;
    let inputMediaUrls = dto.mediaUrls || [];
    const transcodedFiles: string[] = [];

    if (needsTranscode) {
      const results = await Promise.all(inputMediaUrls.map(u => this.transcodeVideoForPlatform(u)));
      results.forEach((newUrl, i) => {
        if (newUrl !== inputMediaUrls[i]) {
          try {
            const fname = new URL(newUrl).pathname.split('/').pop()!;
            const base = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social');
            transcodedFiles.push(path.join(base, fname));
          } catch {}
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
      this.scheduleCleanupTranscoded(transcodedFiles);
      throw new Error(apiErr);
    }

    const saved = await this.savePost(userId, dto.accountId, account.platform, dto, SocialPostStatus.COMPLETED, SocialPostSource.IMMEDIATE, result);
    this.archiveMediaAsync(saved.id, dto.mediaUrls || []);
    this.scheduleCleanupTranscoded(transcodedFiles);
    return { success: true, platform: account.platform, result };
  }

  /** Gọi bởi ScheduleService */
  async executeScheduled(post: any) {
    const account = await this.prisma.socialAccount.findUnique({ where: { id: post.account_id } });
    if (!account || !account.is_active) throw new Error('Account không tồn tại hoặc đã bị ngắt kết nối');

    const token = this.crypto.decrypt(account.access_token_enc);
    const extraData = account.extra_data as any;

    const needsTranscode = account.platform === SocialPlatform.INSTAGRAM || 
                           account.platform === SocialPlatform.THREADS || 
                           account.platform === SocialPlatform.FACEBOOK;
    let inputMediaUrls = post.media_urls || [];
    const transcodedFiles: string[] = [];

    if (needsTranscode) {
      const results = await Promise.all(inputMediaUrls.map((u: string) => this.transcodeVideoForPlatform(u)));
      results.forEach((newUrl: string, i: number) => {
        if (newUrl !== inputMediaUrls[i]) {
          try {
            const fname = new URL(newUrl).pathname.split('/').pop()!;
            const base = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social');
            transcodedFiles.push(path.join(base, fname));
          } catch {}
        }
      });
      inputMediaUrls = results;
    }

    const publicMediaUrls = await this.makeUrlsPublic(inputMediaUrls, account.platform);

    const result = await this.dispatchPublish(account.platform, token, {
      message: post.message,
      mediaUrls: publicMediaUrls,
      pageId: post.page_id || extraData?.pageId,
      privacy: post.privacy,
      extraData,
      accountId: post.account_id,
      platformId: account.platform_id,
    });
    this.scheduleCleanupTranscoded(transcodedFiles);
    return result;
  }

  // Cache: sourceUrl → Promise<transcodedUrl> — tránh transcode 2 lần khi IG + Threads cùng dùng 1 video
  private readonly transcodeCache = new Map<string, Promise<string>>();

  private transcodeVideoForPlatform(localUrl: string): Promise<string> {
    if (!localUrl.includes('localhost') && !localUrl.includes('127.0.0.1')) return Promise.resolve(localUrl);
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

  private async _doTranscode(localUrl: string): Promise<string> {
    const ffmpegPath = this.resolveFFmpegPath();
    if (!ffmpegPath) return localUrl;

    try {
      const urlObj = new URL(localUrl);
      const filename = path.basename(urlObj.pathname.split('?')[0]);
      const uploadBase = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social');
      const inputPath = path.join(uploadBase, filename);
      if (!fs.existsSync(inputPath)) return localUrl;

      const transcodedName = `tc_${Date.now()}_${filename}`;
      const outputPath = path.join(uploadBase, transcodedName);

      this.logger.log(`[Transcode] Bắt đầu transcode ${filename} → ${transcodedName}...`);
      const start = Date.now();
      // H.264 high, CRF 20, cap 8Mbps, CFR 30fps, yuv420p, faststart
      // -map_metadata -1: xóa metadata lạ (Hw, te_is_reencode, bitrate tag) khiến IG/Threads reject
      // -fps_mode cfr -r 30: constant frame rate bắt buộc cho Instagram/Threads
      // -pix_fmt yuv420p: pixel format chuẩn
      const cmd = `"${ffmpegPath}" -y -i "${inputPath}" -map 0:v:0 -map 0:a:0 -c:v libx264 -profile:v high -crf 20 -maxrate 8M -bufsize 16M -r 30 -fps_mode cfr -pix_fmt yuv420p -c:a aac -b:a 128k -ar 44100 -ac 2 -map_metadata -1 -movflags +faststart "${outputPath}"`;
      await execAsync(cmd, { timeout: 300000, maxBuffer: 10 * 1024 * 1024 });

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

  private scheduleCleanupTranscoded(filePaths: string[]) {
    if (!filePaths.length) return;
    setTimeout(() => {
      for (const p of filePaths) {
        try { if (fs.existsSync(p)) { fs.unlinkSync(p); this.logger.log(`[Transcode] Đã xóa temp file: ${p}`); } } catch {}
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
    platformId?: string;   // account.platform_id — luôn chính xác
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
          caption:     opts.message,
          mediaUrls:   opts.mediaUrls,
          igUserId,
          accountType: extra.type, // 'instagram_business' | 'instagram_direct'
        });
      }

      case SocialPlatform.TIKTOK:
        return this.tt.publish(token, { caption: opts.message, mediaUrls: opts.mediaUrls });

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
        return this.yt.publish(token, {
          title: opts.message.substring(0, 100),
          description: opts.message,
          privacy: opts.privacy,
          mediaUrls: opts.mediaUrls,
          refreshToken,
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

      case SocialPlatform.ZALO:
        return this.zalo.publish(token, {
          title: opts.message.substring(0, 100),
          description: opts.message,
          mediaUrls: opts.mediaUrls,
        });

      default:
        throw new BadRequestException(`Platform chưa hỗ trợ: ${platform}`);
    }
  }

  private async savePost(
    userId: string, accountId: string, platform: SocialPlatform,
    dto: any, status: SocialPostStatus, source: SocialPostSource,
    result?: any, errorMsg?: string,
  ) {
    return this.prisma.socialPost.create({
      data: {
        user_id: userId, account_id: accountId, platform, source, status,
        message: dto.message, media_urls: dto.mediaUrls || [],
        page_id: dto.pageId, privacy: dto.privacy,
        result, error_msg: errorMsg, executed_at: new Date(),
        updated_at: new Date(),
      },
    });
  }

  public async archiveMediaAsync(postId: string, mediaUrls: string[]): Promise<void> {
    if (!mediaUrls?.length) return;

    const uploadBase = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social');

    for (const url of mediaUrls) {
      if (!url.includes('/api/social/media/')) continue;

      const filename = url.split('/api/social/media/').pop()!.split('?')[0];
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
