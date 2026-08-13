import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../task-auto/notifications/notifications.service';
import { DEFAULT_TARGET_COUNT } from '../../common/utils/target-count.util';
import { readAiServiceError } from '../../common/utils/ai-service-error.util';
import { YoutubeAiClientService, ParsedYoutubeChannel, ParsedYoutubeShort } from './youtube-ai-client.service';

const STALE_LOCK_MINUTES = 30;

// Lô đầu chạy đồng bộ để trả kết quả ngay cho user; phần còn lại chạy nền.
const FIRST_BATCH_SIZE = 20;

// Nền tảng mới — BE sở hữu DB hoàn toàn từ đầu (không có code AI cũ để migrate).
// AI chỉ fetch + parse (youtube_fetch_views.py), BE là nơi duy nhất ghi
// scraper_youtube_profiles / scraper_youtube_shorts. Mirror pattern TikTok/Douyin
// (sync 20 trả ngay + cào nền tới 300, is_tracked-based periodic, resetStaleLocks).
@Injectable()
export class YoutubeScraperService {
  private readonly logger = new Logger(YoutubeScraperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: YoutubeAiClientService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Growth Alert: snapshot subscriber + báo động nếu tăng đột biến ───────
  private static readonly GROWTH_ALERT_THRESHOLD_PCT = 0.2;

  private async recordMetricsAndMaybeAlert(profileId: bigint, profileName: string): Promise<void> {
    const fresh = await this.prisma.scraperYoutubeProfile.findUniqueOrThrow({ where: { id: profileId } });
    const previous = await this.prisma.scraperYoutubeProfileMetrics.findFirst({
      where: { profile_id: profileId },
      orderBy: { captured_at: 'desc' },
    });

    await this.prisma.scraperYoutubeProfileMetrics.create({
      data: {
        profile_id: profileId,
        subscriber_count: fresh.subscriber_count,
        video_count: fresh.video_count,
        view_count: fresh.view_count,
      },
    });

    if (!previous || previous.subscriber_count <= 0n) return;
    const growth = Number(fresh.subscriber_count - previous.subscriber_count) / Number(previous.subscriber_count);
    if (growth < YoutubeScraperService.GROWTH_ALERT_THRESHOLD_PCT) return;

    const pct = Math.round(growth * 100);
    await this.notifications.broadcastToActiveUsers(
      'GROWTH_ALERT',
      `Kênh YouTube ${profileName} tăng trưởng đột biến`,
      `Subscriber tăng ${pct}% (${previous.subscriber_count} → ${fresh.subscriber_count}) kể từ lần cào trước.`,
      { platform: 'youtube', profile_id: Number(profileId) },
    );
  }

  private async upsertShort(profileId: bigint, s: ParsedYoutubeShort): Promise<{ created: boolean }> {
    const existing = await this.prisma.scraperYoutubeShort.findUnique({ where: { video_id: s.video_id } });
    const data = {
      profile_id: profileId,
      title: s.title,
      hashtags: s.hashtags,
      url: s.url,
      thumbnail_url: s.thumbnail_url,
      view_count: BigInt(s.view_count || 0),
      view_count_text: s.view_count_text,
    };

    if (existing) {
      await this.prisma.scraperYoutubeShort.update({ where: { video_id: s.video_id }, data });
      return { created: false };
    }
    await this.prisma.scraperYoutubeShort.create({ data: { ...data, video_id: s.video_id } });
    return { created: true };
  }

  // Ghi đè toàn bộ field không điều kiện — get_channel_info luôn trả full info mới nhất.
  private async applyChannelUpdate(profileId: bigint, channel: ParsedYoutubeChannel): Promise<void> {
    await this.prisma.scraperYoutubeProfile.update({
      where: { id: profileId },
      data: {
        title: channel.title,
        description: channel.description,
        url: channel.url,
        avatar_url: channel.avatar_url,
        banner_url: channel.banner_url,
        is_verified: channel.is_verified,
        has_business_email: channel.has_business_email,
        subscriber_count: BigInt(channel.subscriber_count || 0),
        video_count: channel.video_count,
        view_count: BigInt(channel.view_count || 0),
        country: channel.country,
        channel_created_at: channel.channel_created_at ? new Date(channel.channel_created_at) : null,
      },
    });
  }

  // Batch đầu SYNCHRONOUS (~20 shorts) — chỉ fetch + upsert, KHÔNG đổi scraping_status
  // (giữ nguyên 'processing' để phần nền tiếp tục), khớp pattern TikTok/Douyin.
  private async ingestShortsSync(
    profile: { id: bigint; channel_id: string },
    count: number,
  ): Promise<{ created: number; updated: number; items_returned: number }> {
    const { channel_api_ok, profile: channel, shorts } = await this.aiClient.fetchChannel(profile.channel_id, count);

    if (!channel_api_ok) {
      throw new Error('Không lấy được thông tin channel từ API');
    }
    if (shorts.length === 0) return { created: 0, updated: 0, items_returned: 0 };

    if (channel) await this.applyChannelUpdate(profile.id, channel);

    let created = 0;
    let updated = 0;
    for (const s of shorts) {
      const r = await this.upsertShort(profile.id, s);
      if (r.created) created++;
      else updated++;
    }
    return { created, updated, items_returned: shorts.length };
  }

  // Task đầy đủ — quản lý scraping_status lifecycle (processing → completed/idle/failed).
  // Dùng cho: cào tiếp nền (count=300), delta scrape, cron định kỳ.
  async scrapeChannelShorts(
    profileId: bigint,
    numOfPosts: number,
  ): Promise<{ created: number; updated: number; items_returned: number }> {
    const profile = await this.prisma.scraperYoutubeProfile.findUnique({ where: { id: profileId } });
    if (!profile) throw new Error(`Profile ${profileId} không tồn tại`);

    if (profile.scraping_status !== 'processing') {
      await this.prisma.scraperYoutubeProfile.update({
        where: { id: profileId },
        data: { scraping_status: 'processing', scrape_error: null },
      });
    }

    try {
      const { channel_api_ok, profile: channel, shorts } = await this.aiClient.fetchChannel(profile.channel_id, numOfPosts);

      if (!channel_api_ok) {
        await this.prisma.scraperYoutubeProfile.update({
          where: { id: profileId },
          data: { scraping_status: 'failed', scrape_error: 'Không lấy được thông tin channel từ API' },
        });
        throw new Error('Không lấy được thông tin channel từ API');
      }

      if (shorts.length === 0) {
        await this.prisma.scraperYoutubeProfile.update({
          where: { id: profileId },
          data: { scraping_status: 'idle', scrape_error: 'Không có Shorts nào được trả về' },
        });
        return { created: 0, updated: 0, items_returned: 0 };
      }

      if (channel) await this.applyChannelUpdate(profileId, channel);

      if (!profile.is_initial_scraped) {
        await this.prisma.scraperYoutubeProfile.update({ where: { id: profileId }, data: { is_initial_scraped: true } });
      }

      let created = 0;
      let updated = 0;
      for (const s of shorts) {
        const r = await this.upsertShort(profileId, s);
        if (r.created) created++;
        else updated++;
      }

      await this.prisma.scraperYoutubeProfile.update({
        where: { id: profileId },
        data: { scraping_status: 'completed', scrape_error: null, last_scraped_at: new Date() },
      });

      const profileLabel = profile.title || profile.channel_id;
      this.recordMetricsAndMaybeAlert(profileId, profileLabel).catch((err) => {
        this.logger.error(`[YT-GROWTH-ALERT] ${profileLabel}: ${err.message}`);
      });

      this.logger.log(`[YT-CHANNEL] ${profile.title || profile.channel_id}: +${created} mới, ~${updated} cập nhật`);
      return { created, updated, items_returned: shorts.length };
    } catch (err: any) {
      await this.prisma.scraperYoutubeProfile.update({
        where: { id: profileId },
        data: { scraping_status: 'failed', scrape_error: (err.message || '').slice(0, 500) },
      });
      throw err;
    }
  }

  // TikHub get_channel_info chấp nhận @handle/username trần làm channel_id (chỉ để
  // hiển thị info), nhưng get_channel_shorts (endpoint cào Shorts thật) BẮT BUỘC
  // id chuẩn dạng UC... — nếu không sẽ luôn trả 0 kết quả. Vì vậy mọi input không
  // phải UC... phải resolve ra UC... thật bằng cách đọc thẳng HTML trang kênh công khai
  // (YouTube luôn nhúng "channelId":"UC..." trong initial data, không cần API key).
  private async resolveToChannelId(candidate: string): Promise<string> {
    if (/^UC[\w-]{20,}$/i.test(candidate)) return candidate;

    const tryFetch = async (url: string): Promise<string | null> => {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        if (!res.ok) return null;
        const html = await res.text();
        // Ưu tiên canonical link (duy nhất, chắc chắn là kênh đang xem) hơn regex
        // "channelId" thô (xuất hiện lặp lại nhiều lần trong trang cho các kênh khác
        // được nhắc tới — dễ bắt nhầm). Với trang video (watch?v=) thì canonical trỏ
        // tới chính video nên không khớp, fallback "channelId" sẽ bắt được chủ video.
        const canonicalMatch = html.match(/rel="canonical"\s+href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{10,})"/);
        if (canonicalMatch) return canonicalMatch[1];
        const fallbackMatch = html.match(/"channelId":"(UC[\w-]{10,})"/);
        return fallbackMatch ? fallbackMatch[1] : null;
      } catch {
        return null;
      }
    };

    // Nếu candidate đã là URL đầy đủ (vd trang video watch?v=...) thì fetch thẳng;
    // ngược lại thử theo thứ tự /@handle rồi /username (dạng kênh cũ).
    const isFullUrl = /^https?:\/\//i.test(candidate);
    const resolved = isFullUrl
      ? await tryFetch(candidate)
      : (await tryFetch(`https://www.youtube.com/@${candidate}`)) ||
        (await tryFetch(`https://www.youtube.com/${candidate}`));
    if (!resolved) {
      throw new HttpException(
        { error: `Không tìm thấy kênh YouTube với "${candidate}". Kiểm tra lại URL/handle.` },
        HttpStatus.BAD_REQUEST,
      );
    }
    return resolved;
  }

  async scrapeChannel(candidate: string, isOwned?: boolean, targetCount = DEFAULT_TARGET_COUNT): Promise<any> {
    const channelId = await this.resolveToChannelId(candidate);
    const channelUrl = `https://www.youtube.com/channel/${channelId}`;
    let profile = await this.prisma.scraperYoutubeProfile.findUnique({ where: { channel_id: channelId } });
    const wasCreated = !profile;
    if (!profile) {
      profile = await this.prisma.scraperYoutubeProfile.create({
        data: { channel_id: channelId, url: channelUrl, is_owned: !!isOwned },
      });
    }

    if (profile.scraping_status === 'processing') {
      return {
        status: 'ok',
        message: `${profile.title || channelId} đang được cào.`,
        is_scraping: true,
        profile_id: Number(profile.id),
      };
    }

    const needsDeltaScrape = !wasCreated && profile.is_initial_scraped;
    const updateData: any = { scraping_status: 'processing', scrape_error: null };
    if (isOwned && !profile.is_owned) updateData.is_owned = true;
    await this.prisma.scraperYoutubeProfile.update({ where: { id: profile.id }, data: updateData });

    if (needsDeltaScrape) {
      // Delta: kênh đã cào rồi, lấy thêm tới targetCount shorts mới nhất, fully async
      this.scrapeChannelShorts(profile.id, targetCount).catch((err) => {
        this.logger.error(`[YT-CHANNEL] ${channelId} thất bại: ${err.message}`);
      });
      return {
        status: 'ok',
        message: `Đang cập nhật tới ${targetCount} Shorts mới nhất cho kênh ${profile.title || channelId}...`,
        already_exists: true,
        profile_id: Number(profile.id),
      };
    }

    // Batch đầu SYNCHRONOUS (nhỏ, rất nhanh) — trả data ngay cho user, phần còn lại chạy nền
    const firstBatch = Math.min(FIRST_BATCH_SIZE, targetCount);
    const freshProfile = await this.prisma.scraperYoutubeProfile.findUniqueOrThrow({ where: { id: profile.id } });
    let result: { created: number; updated: number; items_returned: number };
    try {
      result = await this.ingestShortsSync(freshProfile, firstBatch);
    } catch (err: any) {
      await this.prisma.scraperYoutubeProfile.update({
        where: { id: profile.id },
        data: { scraping_status: 'failed', scrape_error: (err.message || '').slice(0, 500) },
      });
      // Channel vừa tạo mà lỗi ngay từ đầu → xóa placeholder, tránh rác DB.
      if (wasCreated) {
        await this.prisma.scraperYoutubeProfile.delete({ where: { id: profile.id } }).catch(() => {});
      }
      // AI service đã nói rõ nguyên nhân (vd token TikHub hết hạn) → ném NGUYÊN VĂN cho
      // AllExceptionsFilter dịch lại. Bọc thành 400 ở đây vừa nuốt mất lý do thật, vừa
      // đổi "hỏng ở nhà cung cấp" thành "người dùng nhập sai".
      if (readAiServiceError(err)) throw err;
      throw new HttpException({ error: err.message || 'Không cào được channel này' }, HttpStatus.BAD_REQUEST);
    }

    if (result.items_returned === 0) {
      await this.prisma.scraperYoutubeProfile.update({
        where: { id: profile.id },
        data: {
          scraping_status: 'idle',
          scrape_error: 'Không có Shorts nào được trả về (channel không tồn tại hoặc không có Shorts)',
        },
      });
      if (wasCreated) {
        await this.prisma.scraperYoutubeProfile.delete({ where: { id: profile.id } }).catch(() => {});
      }
      throw new HttpException({ error: 'Không tìm thấy Shorts cho channel_id này' }, HttpStatus.NOT_FOUND);
    }

    // Dispatch cào tiếp tới tổng targetCount Shorts (fire-and-forget) — tự set scraping_status='completed'
    const continuationNeeded = targetCount > firstBatch;
    if (continuationNeeded) {
      this.scrapeChannelShorts(profile.id, targetCount).catch((err) => {
        this.logger.error(`[YT-CHANNEL] ${channelId} continuation thất bại: ${err.message}`);
      });
    } else {
      // ingestShortsSync cố ý KHÔNG đụng scraping_status (để phần nền tự chốt).
      // Khi user đặt số nhỏ ≤ lô đầu thì không có phần nền → phải tự chốt ở đây,
      // nếu không profile kẹt 'processing' cho tới khi resetStaleLocks dọn (30 phút).
      await this.prisma.scraperYoutubeProfile.update({
        where: { id: profile.id },
        data: {
          scraping_status: 'completed',
          scrape_error: null,
          is_initial_scraped: true,
          last_scraped_at: new Date(),
        },
      });
    }

    const updated = await this.prisma.scraperYoutubeProfile.findUniqueOrThrow({ where: { id: profile.id } });

    // Hiển thị cả số tải về lẫn số mới: trước đây chỉ hiện `created` nên user tưởng
    // bị cào thiếu khi phần lớn video đã có sẵn trong kho.
    const batchInfo = `${result.items_returned} Shorts (${result.created} mới)`;
    return {
      status: 'ok',
      message: continuationNeeded
        ? `Đã cào ${batchInfo} cho kênh ${updated.title || channelId}. Đang cào tiếp tới ${targetCount}...`
        : `Đã cào ${batchInfo} cho kênh ${updated.title || channelId}.`,
      profile_id: Number(updated.id),
      newly_scraped: true,
      profile: {
        id: Number(updated.id),
        channel_id: updated.channel_id,
        title: updated.title,
        avatar_url: updated.avatar_url || '',
        is_verified: updated.is_verified,
        subscriber_count: Number(updated.subscriber_count),
        video_count: updated.video_count,
        scraping_status: updated.scraping_status,
      },
      initial_shorts_count: result.created,
    };
  }

  // ─── Toggle bookmark/tracked ─────────────────────────────────────────────

  async toggleProfile(id: bigint, field: 'is_bookmarked' | 'is_tracked'): Promise<boolean> {
    const profile = await this.prisma.scraperYoutubeProfile.findUnique({ where: { id } });
    if (!profile) throw new HttpException({ error: 'Profile not found' }, HttpStatus.NOT_FOUND);
    const newValue = !profile[field];
    await this.prisma.scraperYoutubeProfile.update({ where: { id }, data: { [field]: newValue } });
    return newValue;
  }

  // Tự mở khóa channel bị kẹt ở 'processing' quá lâu (worker crash giữa chừng).
  private async resetStaleLocks(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60_000);
    const result = await this.prisma.scraperYoutubeProfile.updateMany({
      where: { scraping_status: 'processing', updated_at: { lt: cutoff } },
      data: { scraping_status: 'idle' },
    });
    if (result.count > 0) {
      this.logger.warn(`⚠️ Reset ${result.count} channel YouTube bị stuck lock`);
    }
  }

  // ─── Periodic: cào Shorts mới cho channel is_tracked=true (cron) ─────────
  // is_tracked là tiêu chí chọn lọc duy nhất; scraping_status chỉ dùng để loại trừ
  // channel đang cào dở (!= 'processing'), không so khớp cứng 1 giá trị cụ thể.

  async periodicRefresh(): Promise<{ total: number; done: number; failed: number }> {
    await this.resetStaleLocks();

    const profiles = await this.prisma.scraperYoutubeProfile.findMany({
      where: { is_tracked: true, is_initial_scraped: true, scraping_status: { not: 'processing' } },
      orderBy: { last_scraped_at: 'asc' },
    });

    if (profiles.length === 0) {
      this.logger.log('[YT-PERIODIC] Không có channel nào cần cào định kỳ.');
      return { total: 0, done: 0, failed: 0 };
    }

    this.logger.log(`═══ [YT-PERIODIC] Cào Shorts mới cho ${profiles.length} channel(s) ═══`);
    let done = 0;
    let failed = 0;

    for (const profile of profiles) {
      try {
        await this.scrapeChannelShorts(profile.id, 10);
        done++;
      } catch (err: any) {
        failed++;
        this.logger.error(`❌ ${profile.title || profile.channel_id}: ${err.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    this.logger.log(`═══ [YT-PERIODIC] Xong: ${done}/${profiles.length} OK, ${failed} lỗi ═══`);
    return { total: profiles.length, done, failed };
  }
}
