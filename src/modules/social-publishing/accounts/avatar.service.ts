import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { SocialPlatform } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';

// PR "bỏ cắm cứng phiên bản API" gom các hằng số này vào platform-api.const.ts.
// Ở đây khai báo tại chỗ để nhánh này độc lập, merge xong thì gộp lại.
const FACEBOOK_GRAPH_ROOT = 'https://graph.facebook.com';
const FACEBOOK_GRAPH_BASE = `${FACEBOOK_GRAPH_ROOT}/v21.0`;
const THREADS_GRAPH_BASE = 'https://graph.threads.net/v1.0';

/**
 * Phục vụ ảnh đại diện kênh từ backend thay vì để trình duyệt gọi thẳng CDN của Meta.
 *
 * Lý do: URL ảnh của Instagram và Threads là URL CÓ CHỮ KÝ, kèm tham số `oe` hạn
 * khoảng vài ngày. Chúng được lưu vào cột avatar_url lúc đồng bộ tài khoản, rồi
 * vài tuần sau trình duyệt tải lại và nhận 403 — giao diện đầy ô trống.
 *
 * Facebook có đường lui vĩnh viễn (graph.facebook.com/{id}/picture, mỗi lần gọi
 * Meta ký một URL mới), nhưng Instagram và Threads KHÔNG có endpoint tương đương.
 * Cách duy nhất là backend tự lấy ảnh về và phục vụ lại.
 */
@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  /** Ảnh đại diện đổi rất hiếm — giữ một tuần là đủ tươi mà gần như không gọi lại Meta */
  private readonly CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  private get cacheDir(): string {
    const base = process.env.SOCIAL_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'social');
    return path.join(base, 'avatars');
  }

  /** Đường dẫn file cache. accountId là UUID nên an toàn để ghép vào tên file. */
  private cachePath(accountId: string): string {
    return path.join(this.cacheDir, `${path.basename(accountId)}.img`);
  }

  private isFresh(filePath: string): boolean {
    try {
      const stat = fs.statSync(filePath);
      return Date.now() - stat.mtimeMs < this.CACHE_TTL_MS;
    } catch {
      return false;
    }
  }

  /**
   * Trả về đường dẫn file ảnh đã sẵn sàng phục vụ, hoặc null nếu không lấy được.
   *
   * Không ném lỗi: ảnh đại diện hỏng không đáng làm gãy trang. Giao diện đã có
   * sẵn phần hiển thị chữ cái đầu khi thiếu ảnh.
   */
  async resolveAvatarFile(accountId: string): Promise<string | null> {
    const cached = this.cachePath(accountId);
    if (this.isFresh(cached)) return cached;

    const account = await this.prisma.socialAccount.findUnique({
      where: { id: accountId },
      select: {
        id: true, platform: true, platform_id: true,
        avatar_url: true, access_token_enc: true, extra_data: true,
      },
    });
    if (!account) return null;

    for (const url of await this.candidateUrls(account)) {
      const buffer = await this.download(url);
      if (buffer) {
        this.writeCache(cached, buffer);
        return cached;
      }
    }

    // Hết cách lấy ảnh mới — dùng bản cache cũ nếu còn, thà ảnh cũ còn hơn ô trống.
    return fs.existsSync(cached) ? cached : null;
  }

  /**
   * Các URL sẽ thử, theo thứ tự ưu tiên.
   *
   * Tách riêng để test được mà không cần chạm mạng.
   */
  async candidateUrls(account: {
    platform: SocialPlatform;
    platform_id: string | null;
    avatar_url: string | null;
    access_token_enc?: string | null;
    extra_data?: any;
  }): Promise<string[]> {
    const urls: string[] = [];

    // Facebook: dạng vĩnh viễn đứng TRƯỚC, vì nó không bao giờ hết hạn.
    if (account.platform === SocialPlatform.FACEBOOK && account.platform_id) {
      const pageId = String(account.platform_id).replace(/^page_/, '');
      urls.push(`${FACEBOOK_GRAPH_ROOT}/${pageId}/picture?type=large`);
    }

    if (account.avatar_url) urls.push(account.avatar_url);

    // Instagram và Threads không có dạng vĩnh viễn — phải hỏi lại API để lấy URL ký mới.
    if (account.platform === SocialPlatform.INSTAGRAM) {
      const fresh = await this.refreshInstagramUrl(account).catch(() => null);
      if (fresh) urls.push(fresh);
    }

    if (account.platform === SocialPlatform.THREADS) {
      const fresh = await this.refreshThreadsUrl(account).catch(() => null);
      if (fresh) urls.push(fresh);
    }

    return urls;
  }

  /** Hỏi Threads API lấy ảnh đại diện mới. Threads dùng host và tên trường riêng. */
  private async refreshThreadsUrl(account: {
    platform_id: string | null;
    access_token_enc?: string | null;
    extra_data?: any;
  }): Promise<string | null> {
    const userId = account.extra_data?.platformId || account.extra_data?.userId || account.platform_id;
    if (!userId || !account.access_token_enc) return null;

    const token = this.crypto.decrypt(account.access_token_enc);
    const res = await axios.get(`${THREADS_GRAPH_BASE}/${userId}`, {
      params: { fields: 'threads_profile_picture_url', access_token: token },
      timeout: 15000,
    });
    return res.data?.threads_profile_picture_url ?? null;
  }

  /** Hỏi Graph API lấy profile_picture_url mới cho tài khoản Instagram */
  private async refreshInstagramUrl(account: {
    platform_id: string | null;
    access_token_enc?: string | null;
    extra_data?: any;
  }): Promise<string | null> {
    const igUserId = account.extra_data?.igUserId || account.platform_id;
    if (!igUserId || !account.access_token_enc) return null;

    const token = this.crypto.decrypt(account.access_token_enc);
    const res = await axios.get(`${FACEBOOK_GRAPH_BASE}/${igUserId}`, {
      params: { fields: 'profile_picture_url', access_token: token },
      timeout: 15000,
    });
    return res.data?.profile_picture_url ?? null;
  }

  private async download(url: string): Promise<Buffer | null> {
    try {
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 15000,
        maxRedirects: 5, // graph.facebook.com/.../picture trả 302 sang CDN
      });
      const buf = Buffer.from(res.data);
      return buf.length > 0 ? buf : null;
    } catch (e: any) {
      this.logger.warn(`[Avatar] Tải thất bại ${url.slice(0, 80)}: ${e.message}`);
      return null;
    }
  }

  private writeCache(filePath: string, buffer: Buffer): void {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, buffer);
    } catch (e: any) {
      this.logger.warn(`[Avatar] Không ghi được cache ${filePath}: ${e.message}`);
    }
  }
}
