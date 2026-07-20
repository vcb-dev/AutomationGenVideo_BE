import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import axios from 'axios';
import { UploadService } from '../upload/upload.service';
import { QueueService } from '../queue/queue.service';
import { SocialPlatform } from '@prisma/client';
import { CloneTiktokDto } from './dto/clone-tiktok.dto';

interface TiktokVideoInfo {
  videoId: string;
  downloadUrl: string;
  thumbnailUrl: string;
  title: string;
  author: string;
  duration: number;
}

/** Headers giả lập browser để TikTok trả về video */
const TIKTOK_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://www.tiktok.com/',
  'Accept': '*/*',
  'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
};

@Injectable()
export class TiktokCloneService {
  private readonly logger = new Logger(TiktokCloneService.name);

  constructor(
    private readonly uploadService: UploadService,
    private readonly queueService: QueueService,
  ) {}

  async cloneAndPublish(userId: string, dto: CloneTiktokDto) {
    this.logger.log(`[Clone] Bắt đầu clone TikTok: ${dto.tiktokUrl} → ${dto.accountIds.length} pages`);

    // Bước 1: Lấy thông tin video
    let videoInfo: TiktokVideoInfo;
    if (dto.videoUrl) {
      // Extension đã cung cấp video URL trực tiếp → dùng luôn
      this.assertPublicHttpUrl(dto.videoUrl, 'videoUrl');
      videoInfo = {
        videoId: this.extractVideoId(dto.tiktokUrl) || `tiktok_${Date.now()}`,
        downloadUrl: dto.videoUrl,
        thumbnailUrl: dto.thumbnailUrl || '',
        title: dto.originalTitle || dto.caption || 'TikTok Video',
        author: '',
        duration: 0,
      };
    } else {
      videoInfo = await this.fetchTiktokVideoInfo(dto.tiktokUrl);
    }

    this.logger.log(`[Clone] Video: ${videoInfo.title} | URL: ${videoInfo.downloadUrl.slice(0, 80)}...`);

    // Bước 2: Download video
    const buffer = await this.downloadVideo(videoInfo.downloadUrl);
    this.logger.log(`[Clone] Downloaded ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);

    // Bước 3: Upload lên Google Drive
    const filename = `tiktok_${videoInfo.videoId}_${Date.now()}.mp4`;
    const driveUrl = await this.uploadService.saveBuffer(buffer, filename, 'video/mp4');
    this.logger.log(`[Clone] Drive URL: ${driveUrl}`);

    // Bước 4: Enqueue đăng lên từng Facebook account/page
    const jobs = dto.accountIds.map(accountId => ({
      accountId,
      platform: SocialPlatform.FACEBOOK,
      message: dto.caption || videoInfo.title,
      mediaUrls: [driveUrl],
      thumbUrl: videoInfo.thumbnailUrl || undefined,
    }));

    const jobIds = await this.queueService.enqueue(userId, jobs);
    this.logger.log(`[Clone] ✅ Đã queue ${jobIds.length} job(s): ${jobIds.join(', ')}`);

    return {
      success: true,
      jobIds,
      driveUrl,
      videoInfo: {
        title: videoInfo.title,
        author: videoInfo.author,
        thumbnailUrl: videoInfo.thumbnailUrl,
        duration: videoInfo.duration,
      },
    };
  }

  /** Lấy metadata video từ trang TikTok (parse __NEXT_DATA__) */
  private async fetchTiktokVideoInfo(tiktokUrl: string): Promise<TiktokVideoInfo> {
    const videoId = this.extractVideoId(tiktokUrl);
    if (!videoId) throw new BadRequestException('URL TikTok không hợp lệ');

    // Thử oembed API trước để lấy metadata
    let title = 'TikTok Video';
    let author = '';
    let thumbnailUrl = '';
    try {
      const oembed = await axios.get('https://www.tiktok.com/oembed', {
        params: { url: tiktokUrl },
        timeout: 10000,
      });
      title = oembed.data.title || title;
      author = oembed.data.author_name || '';
      thumbnailUrl = oembed.data.thumbnail_url || '';
    } catch (e: any) {
      this.logger.warn(`[Clone] oembed failed: ${e.message}`);
    }

    // Fetch trang TikTok để lấy download URL từ __NEXT_DATA__
    const downloadUrl = await this.extractDownloadUrl(tiktokUrl, videoId);

    return { videoId, downloadUrl, thumbnailUrl, title, author, duration: 0 };
  }

  /** Trích xuất URL download từ __NEXT_DATA__ trong trang TikTok */
  private async extractDownloadUrl(tiktokUrl: string, videoId: string): Promise<string> {
    try {
      const res = await axios.get(tiktokUrl, {
        headers: {
          ...TIKTOK_HEADERS,
          'Cookie': 'tt_webid_v2=1; ttwid=1',
        },
        timeout: 20000,
        maxRedirects: 5,
      });

      const html: string = res.data;

      // Tìm JSON nhúng trong trang: TikTok mới dùng __UNIVERSAL_DATA_FOR_REHYDRATION__,
      // các trang cũ dùng __NEXT_DATA__ — thử cả hai.
      const embeddedJsonMatch =
        html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.+?)<\/script>/s) ||
        html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s);
      if (embeddedJsonMatch) {
        const embeddedData = JSON.parse(embeddedJsonMatch[1]);
        const videoData = this.deepFind(embeddedData, 'downloadAddr') || this.deepFind(embeddedData, 'playAddr');
        if (videoData) {
          return this.unescapeJsonUrl(videoData);
        }
      }

      // Fallback: tìm pattern video URL trong HTML
      const playUrlMatch = html.match(/"playAddr":"([^"]+)"/);
      if (playUrlMatch) return this.unescapeJsonUrl(playUrlMatch[1]);

      const downloadMatch = html.match(/"downloadAddr":"([^"]+)"/);
      if (downloadMatch) return this.unescapeJsonUrl(downloadMatch[1]);

      throw new Error('Không tìm được URL video từ trang TikTok');
    } catch (err: any) {
      this.logger.error(`[Clone] extractDownloadUrl failed: ${err.message}`);
      throw new BadRequestException(`Không thể tải thông tin video TikTok: ${err.message}`);
    }
  }

  /**
   * URL trích từ HTML/JSON của TikTok còn nguyên escape kiểu JSON (/ = "/",
   * & = "&", \\/ = "/"...). Query string của CDN TikTok luôn chứa "&" nên nếu
   * chỉ replace / như trước thì URL bị hỏng → download 403. Giải mã đầy đủ ở đây.
   */
  private unescapeJsonUrl(raw: string): string {
    return raw
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\\//g, '/');
  }

  /**
   * Chặn SSRF: videoUrl do client (extension) gửi lên sẽ được server fetch trực tiếp,
   * nên phải là http(s) và không được trỏ vào localhost / dải IP nội bộ.
   */
  private assertPublicHttpUrl(rawUrl: string, fieldName: string): void {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new BadRequestException(`${fieldName} không phải URL hợp lệ`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException(`${fieldName} phải là URL http/https`);
    }
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const isPrivate =
      host === 'localhost' ||
      host === '::1' ||
      host.endsWith('.local') ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^0\./.test(host) ||
      /^f[cd][0-9a-f]{2}:/.test(host) ||
      /^fe80:/.test(host);
    if (isPrivate) {
      throw new BadRequestException(`${fieldName} không được trỏ tới địa chỉ nội bộ`);
    }
  }

  /** Tìm đệ quy một key trong object JSON (giới hạn depth 10 tránh chậm với JSON lớn) */
  private deepFind(obj: any, key: string, depth = 0): string | null {
    if (depth > 10 || !obj || typeof obj !== 'object') return null;
    if (key in obj && typeof obj[key] === 'string' && obj[key].includes('http')) return obj[key];
    for (const v of Object.values(obj)) {
      const found = this.deepFind(v, key, depth + 1);
      if (found) return found;
    }
    return null;
  }

  /** Download video từ URL về Buffer */
  private async downloadVideo(url: string): Promise<Buffer> {
    let res;
    try {
      res = await axios.get(url, {
        headers: TIKTOK_HEADERS,
        responseType: 'arraybuffer',
        timeout: 120000, // 2 phút cho video lớn
        maxContentLength: 500 * 1024 * 1024, // 500MB max
      });
    } catch (err: any) {
      this.logger.error(`[Clone] downloadVideo failed: ${err.message}`);
      throw new BadRequestException('Không thể tải video từ TikTok');
    }

    // TikTok trả 200 kèm trang HTML (captcha/block) thay vì video khá thường xuyên —
    // nếu không chặn ở đây thì file rác sẽ được upload Drive rồi đăng lên Facebook.
    const contentType = String(res.headers?.['content-type'] || '');
    const buffer = Buffer.from(res.data);
    if (contentType.includes('text/html') || buffer.length < 10 * 1024) {
      this.logger.error(
        `[Clone] downloadVideo nhận về dữ liệu không phải video (content-type=${contentType}, size=${buffer.length}B)`,
      );
      throw new BadRequestException('TikTok không trả về file video (có thể bị chặn/captcha), thử lại sau');
    }
    return buffer;
  }

  /** Trích xuất video ID từ URL TikTok */
  private extractVideoId(url: string): string | null {
    if (!url || typeof url !== 'string') return null;
    const patterns = [
      /\/video\/(\d+)/,
      /\/v\/(\d+)/,
      /vm\.tiktok\.com\/(\w+)/,
      /vt\.tiktok\.com\/(\w+)/,
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  }

  /** Lấy thông tin video TikTok để hiển thị preview trong extension (không download) */
  async getVideoPreview(tiktokUrl: string): Promise<{
    videoId: string | null;
    title: string;
    author: string;
    thumbnailUrl: string;
    isValid: boolean;
  }> {
    const videoId = this.extractVideoId(tiktokUrl);
    if (!videoId) {
      return { videoId: null, title: '', author: '', thumbnailUrl: '', isValid: false };
    }

    try {
      const res = await axios.get('https://www.tiktok.com/oembed', {
        params: { url: tiktokUrl },
        timeout: 8000,
      });
      return {
        videoId,
        title: res.data.title || '',
        author: res.data.author_name || '',
        thumbnailUrl: res.data.thumbnail_url || '',
        isValid: true,
      };
    } catch {
      return { videoId, title: '', author: '', thumbnailUrl: '', isValid: true };
    }
  }
}
