import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InstagramOwnedAiClientService, FetchedInstagramAccount } from './instagram-owned-ai-client.service';
import { resolveViewCount } from '../facebook-owned-pages/resolve-view-count';

/** Số bài lấy mỗi lượt đồng bộ. Xem ghi chú giới hạn tần suất ở dưới. */
export const MEDIA_PER_SYNC = 25;

/**
 * Instagram NỘI BỘ — đọc qua Graph API bằng page token của Facebook, miễn phí.
 *
 * ── Khác gì instagram-scraper ───────────────────────────────────────────────────
 * Module `instagram-scraper` cào Instagram BÊN NGOÀI theo username qua TikHub, tính tiền mỗi
 * lượt gọi. Module này đọc tài khoản Instagram Business của chính công ty — nối sẵn với Facebook
 * Page nên dùng shared page token, không tốn đồng nào.
 *
 * ── Vì sao ghi vào bảng Scraper* thay vì bảng mới ───────────────────────────────
 * ScraperInstagramProfile/ScraperInstagramReel vừa khít dữ liệu Graph API, và là hai bảng mà
 * trang "Kênh nội bộ" lẫn trang Tổng quan đang đọc. Ghi vào đó thì không cần migration, FE
 * không phải sửa một dòng — chỉ đổi nguồn dữ liệu từ TikHub (mất phí) sang Graph API (miễn phí).
 *
 * ── Giới hạn tần suất ───────────────────────────────────────────────────────────
 * Instagram Graph API chặn ~200 lượt gọi/giờ mỗi tài khoản, mà mỗi video tốn thêm 1 lượt cho
 * insight (Meta không cho gộp insight nhiều media như Facebook). 25 bài ≈ 26 lượt, thừa cho
 * kênh nội bộ (nhiều nhất ~5 bài/ngày) mà vẫn xa trần.
 */
@Injectable()
export class InstagramOwnedAccountsService {
  private readonly logger = new Logger(InstagramOwnedAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: InstagramOwnedAiClientService,
  ) {}

  /**
   * Duyệt mọi Facebook Page đang quản lý, tìm tài khoản Instagram Business gắn kèm.
   *
   * Không lưu quan hệ page ↔ instagram vào DB: quan hệ đó Graph API trả về tức thì và có thể
   * đổi bất cứ lúc nào (người quản trị gỡ liên kết). Hỏi lại mỗi lượt import — 106 lượt gọi,
   * đo được khoảng một phút — rẻ hơn nhiều so với việc giữ một bản sao có thể sai.
   */
  async importOwnedAccounts(): Promise<{ created: number; updated: number; skipped: number; failed: number }> {
    const pages = await this.prisma.video_management_managedfacebookpage.findMany({
      where: { is_active: true, page_access_token: { not: '' } },
      select: { page_id: true, name: true, page_access_token: true },
      orderBy: { id: 'asc' },
    });

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const page of pages) {
      // Bọc từng page: một page hỏng (token chết, AI service 502) không được làm đứt vòng lặp
      // và bỏ rơi các page phía sau — cùng lý do với backfillAllPages bên Facebook.
      try {
        const account = await this.aiClient.fetchOwnedAccount(page.page_id, page.page_access_token);
        if (!account) {
          // Page không nối Instagram — 11/25 page rơi vào đây, KHÔNG phải lỗi.
          skipped++;
          continue;
        }
        const existing = await this.upsertProfile(account);
        existing ? updated++ : created++;
      } catch (err: any) {
        failed++;
        this.logger.error(`❌ [IG-IMPORT] ${page.name}: ${err.message}`);
      }
    }

    this.logger.log(
      `✅ [IG-IMPORT] +${created} tài khoản mới, ~${updated} cập nhật, ` +
        `${skipped} page không nối Instagram${failed ? `, ${failed} lỗi` : ''}`,
    );
    return { created, updated, skipped, failed };
  }

  /** Trả về true nếu hồ sơ đã tồn tại (cập nhật), false nếu vừa tạo mới. */
  private async upsertProfile(acc: FetchedInstagramAccount): Promise<boolean> {
    const shared = {
      instagram_id: acc.instagram_id,
      full_name: acc.full_name,
      url: acc.url,
      avatar_url: acc.avatar_url,
      biography: acc.biography,
      external_url: acc.external_url,
      is_business: true,
      followers_count: BigInt(acc.followers_count || 0),
      posts_count: acc.posts_count || 0,
    };

    const existing = await this.prisma.scraperInstagramProfile.findUnique({
      where: { username: acc.username },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.scraperInstagramProfile.update({ where: { id: existing.id }, data: shared });
      return true;
    }

    await this.prisma.scraperInstagramProfile.create({ data: { username: acc.username, ...shared } });
    return false;
  }

  /** Kéo bài mới nhất của một tài khoản về bảng reel. */
  async syncAccountMedia(
    profile: { id: bigint; instagram_id: string },
    tokenEncrypted: string,
    limit = MEDIA_PER_SYNC,
  ): Promise<{ created: number; updated: number }> {
    const media = await this.aiClient.fetchMedia(profile.instagram_id, tokenEncrypted, limit);

    let created = 0;
    let updated = 0;

    for (const m of media) {
      // shortcode là cột UNIQUE và NOT NULL. Graph API không trả thẳng trường này (phải bóc từ
      // permalink), nên permalink lạ là bóc ra rỗng — ghi vào thì bài thứ hai đụng UNIQUE ''
      // và cả lượt đồng bộ vỡ. Bỏ qua bài đó, đừng kéo sập những bài còn lại.
      if (!m.post_id || !m.shortcode) {
        this.logger.warn(`⚠️ [IG-SYNC] Bỏ qua bài thiếu shortcode: ${m.url || m.post_id}`);
        continue;
      }

      const existing = await this.prisma.scraperInstagramReel.findUnique({
        where: { post_id: m.post_id },
        select: { id: true, play_count: true },
      });

      const data = {
        profile_id: profile.id,
        shortcode: m.shortcode,
        url: m.url,
        description: m.description || '',
        hashtags: m.hashtags || [],
        thumbnail_url: m.thumbnail_url || null,
        // null từ AI = KHÔNG lấy được lượt xem (thiếu quyền instagram_manage_insights), khác
        // hẳn 0 = thật sự không ai xem. Giữ số cũ thay vì ghi 0 đè — xem resolve-view-count.ts,
        // đây đúng là chỗ gây sự cố 27/07–09/08/2026 bên Facebook.
        play_count: resolveViewCount(m.view_count, existing?.play_count),
        likes_count: BigInt(m.likes_count || 0),
        comments_count: BigInt(m.comments_count || 0),
        date_posted: new Date(m.date_posted),
      };

      if (existing) {
        await this.prisma.scraperInstagramReel.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await this.prisma.scraperInstagramReel.create({ data: { post_id: m.post_id, ...data } });
        created++;
      }
    }

    return { created, updated };
  }

  /** Import tài khoản rồi đồng bộ bài cho tất cả — hàm mà cron gọi. */
  async syncAllOwnedAccounts(): Promise<{ accounts: number; created: number; updated: number; failed: number }> {
    await this.importOwnedAccounts();

    const pages = await this.prisma.video_management_managedfacebookpage.findMany({
      where: { is_active: true, page_access_token: { not: '' } },
      select: { page_id: true, name: true, page_access_token: true },
      orderBy: { id: 'asc' },
    });

    let accounts = 0;
    let created = 0;
    let updated = 0;
    let failed = 0;

    for (const page of pages) {
      try {
        const acc = await this.aiClient.fetchOwnedAccount(page.page_id, page.page_access_token);
        if (!acc) continue;

        const profile = await this.prisma.scraperInstagramProfile.findUnique({
          where: { username: acc.username },
          select: { id: true, instagram_id: true },
        });
        if (!profile?.instagram_id) continue;

        accounts++;
        const kq = await this.syncAccountMedia(
          { id: profile.id, instagram_id: profile.instagram_id },
          page.page_access_token,
        );
        created += kq.created;
        updated += kq.updated;
      } catch (err: any) {
        failed++;
        this.logger.error(`❌ [IG-SYNC] ${page.name}: ${err.message}`);
      }
    }

    this.logger.log(
      `✅ [IG-SYNC] ${accounts} tài khoản: +${created} bài mới, ~${updated} cập nhật` +
        `${failed ? `, ${failed} lỗi` : ''}`,
    );
    return { accounts, created, updated, failed };
  }
}
