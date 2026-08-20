import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';

/**
 * Summary metrics for the "Internal Channel Overview" dashboard.
 * Aggregates all owned videos across 4 primary platforms (Facebook, TikTok, Instagram, YouTube)
 * using direct SQL aggregations.
 */

const VN_TZ = 'Asia/Ho_Chi_Minh';
const VN_OFFSET = '+07:00';

export const OWNED_PLATFORMS = ['facebook', 'tiktok', 'instagram', 'youtube', 'threads'] as const;
export type OwnedPlatform = (typeof OWNED_PLATFORMS)[number];

// Backward compatibility alias
export const NEN_TANG_NOI_BO = OWNED_PLATFORMS;
export type NenTangNoiBo = OwnedPlatform;

/** Valid date range presets matching FE button options. */
const VALID_DAYS_PRESET = [7, 28, 90];
const DEFAULT_DAYS = 28;

/** Maximum range span to prevent heavy unbounded regex scans (366 days). */
const MAX_DAYS_SPAN = 366;

/** Silence threshold in days without new posts before warning. */
const SILENCE_THRESHOLD_DAYS = 7;

/** View drop threshold percentage compared to previous period before warning. */
const DROP_THRESHOLD_PERCENT = -30;

/** Cache TTL in milliseconds (5 minutes). */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Recognizes Vietnamese characters in caption for market classification (VN vs Global).
 */
const VIETNAMESE_ACCENTS = Prisma.sql`(COALESCE(v.mo_ta, '') ~* '[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]')`;

export interface RawAggregateMetricsRow {
  platform: string;
  ky: string;
  posts: bigint;
  views: bigint;
  likes: bigint;
  comments: bigint;
  shares: bigint;
  so_kenh: bigint;
}

export interface RawDailyRow {
  platform: string;
  ngay: string;
  posts: bigint;
  views: bigint;
  likes: bigint;
  comments: bigint;
  shares: bigint;
}

export interface ChannelRow {
  platform: string;
  kenh_id: string;
  ky: string;
  posts: bigint;
  views: bigint;
  likes: bigint;
  comments: bigint;
  shares: bigint;
}

export interface ChannelListRow {
  platform: string;
  kenh_id: string;
  ten: string;
  avatar: string;
  followers: bigint;
  dong_bo: Date | null;
  loi: string | null;
  hoat_dong: boolean;
  ngay_cuoi: Date | null;
}

interface RawVideoRow {
  platform: string;
  post_id: string;
  url: string;
  mo_ta: string;
  thumbnail: string;
  views: bigint;
  likes: bigint;
  comments: bigint;
  ngay: Date;
  kenh_ten: string;
}

interface RawMarketRow {
  platform: string;
  vn: boolean;
  posts: bigint;
  views: bigint;
}

interface RawContentLineRow {
  ma: string;
  vn: boolean;
  posts: bigint;
  views: bigint;
}

interface RawHashtagRow {
  the: string;
  posts: bigint;
  views: bigint;
}

export interface ChannelAlert {
  platform: string;
  channel: string;
  content: string;
  level: 'w' | 'b';
  label: string;
  // Backward compatibility
  kenh?: string;
  noi_dung?: string;
  muc?: 'w' | 'b';
  nhan?: string;
}

// Backward compatibility alias
export type CanhBaoKenh = ChannelAlert;

const toNum = (v: bigint | number | null | undefined): number => Number(v ?? 0);

function formatVietnamDate(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: VN_TZ });
}

function startOfDay(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000${VN_OFFSET}`);
}

function endOfDay(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999${VN_OFFSET}`);
}

export function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Backward compatibility alias
export const congNgay = addDays;

@Injectable()
export class OwnedStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async getOwnedStats(params: { platform?: string; days?: string; tu?: string; den?: string }) {
    const platform = normalizePlatform(params.platform);
    const { startDate, endDate } = normalizeDateRange(params.tu, params.den, params.days);

    return this.cache.get(`owned-stats:${platform || 'all'}:${startDate}:${endDate}`, CACHE_TTL_MS, () =>
      this.calculateStats(platform, startDate, endDate),
    );
  }

  // Backward compatibility alias
  async thongKe(params: { platform?: string; days?: string; tu?: string; den?: string }) {
    return this.getOwnedStats(params);
  }

  private async calculateStats(platform: string, startDate: string, endDate: string) {
    const dayCount = daysBetween(startDate, endDate);
    const prevStartDate = addDays(startDate, -dayCount);
    const fromDate = startOfDay(startDate);
    const toDate = endOfDay(endDate);
    const prevFromDate = startOfDay(prevStartDate);

    const source = this.sourceVideos(platform, prevFromDate, toDate);
    const currentPeriod = Prisma.sql`SELECT * FROM ${source} AS v WHERE v.ngay >= ${fromDate}`;
    const periodLabel = Prisma.sql`CASE WHEN v.ngay >= ${fromDate} THEN 'nay' ELSE 'truoc' END`;

    const [aggregateRaw, byDateRaw, byChannelRaw, channelList, topVideoRaw, marketRaw, contentLineRaw, hashtagRaw] =
      await Promise.all([
        this.prisma.$queryRaw<RawAggregateMetricsRow[]>`
          SELECT v.platform, ${periodLabel} AS ky,
                 COUNT(*)::bigint AS posts,
                 COALESCE(SUM(v.views), 0)::bigint AS views,
                 COALESCE(SUM(v.likes), 0)::bigint AS likes,
                 COALESCE(SUM(v.comments), 0)::bigint AS comments,
                 COALESCE(SUM(v.shares), 0)::bigint AS shares,
                 COUNT(DISTINCT v.kenh_id)::bigint AS so_kenh
          FROM ${source} AS v
          GROUP BY 1, 2
        `,
        this.prisma.$queryRaw<RawDailyRow[]>`
          SELECT v.platform,
                 to_char((v.ngay AT TIME ZONE ${VN_TZ})::date, 'YYYY-MM-DD') AS ngay,
                 COUNT(*)::bigint AS posts,
                 COALESCE(SUM(v.views), 0)::bigint AS views,
                 COALESCE(SUM(v.likes), 0)::bigint AS likes,
                 COALESCE(SUM(v.comments), 0)::bigint AS comments,
                 COALESCE(SUM(v.shares), 0)::bigint AS shares
          FROM (${currentPeriod}) AS v
          GROUP BY 1, 2
        `,
        this.prisma.$queryRaw<ChannelRow[]>`
          SELECT v.platform, v.kenh_id, ${periodLabel} AS ky,
                 COUNT(*)::bigint AS posts,
                 COALESCE(SUM(v.views), 0)::bigint AS views,
                 COALESCE(SUM(v.likes), 0)::bigint AS likes,
                 COALESCE(SUM(v.comments), 0)::bigint AS comments,
                 COALESCE(SUM(v.shares), 0)::bigint AS shares
          FROM ${source} AS v
          GROUP BY 1, 2, 3
        `,
        this.prisma.$queryRaw<ChannelListRow[]>(this.sourceChannels(platform)),
        this.prisma.$queryRaw<RawVideoRow[]>`
          SELECT v.platform, v.post_id, v.url, v.mo_ta, v.thumbnail,
                 v.views, v.likes, v.comments, v.ngay, v.kenh_ten
          FROM (${currentPeriod}) AS v
          ORDER BY v.views DESC, v.post_id DESC
          LIMIT 12
        `,
        this.prisma.$queryRaw<RawMarketRow[]>`
          SELECT v.platform, ${VIETNAMESE_ACCENTS} AS vn,
                 COUNT(*)::bigint AS posts,
                 COALESCE(SUM(v.views), 0)::bigint AS views
          FROM (${currentPeriod}) AS v
          GROUP BY 1, 2
        `,
        this.prisma.$queryRaw<RawContentLineRow[]>`
          SELECT t.ma, t.vn, COUNT(*)::bigint AS posts, COALESCE(SUM(t.views), 0)::bigint AS views
          FROM (
            SELECT DISTINCT v.platform, v.post_id, v.views, ${VIETNAMESE_ACCENTS} AS vn,
                   upper(m[1]) AS ma
            FROM (${currentPeriod}) AS v,
                 regexp_matches(v.mo_ta, '#(A[1-5])([^[:alnum:]]|$)', 'gi') AS m
          ) AS t
          GROUP BY 1, 2
        `,
        this.prisma.$queryRaw<RawHashtagRow[]>`
          SELECT t.the, COUNT(*)::bigint AS posts, COALESCE(SUM(t.views), 0)::bigint AS views
          FROM (
            SELECT DISTINCT v.platform, v.post_id, v.views, lower(m[1]) AS the
            FROM (${currentPeriod}) AS v,
                 regexp_matches(v.mo_ta, '#([[:alnum:]_]{2,64})', 'g') AS m
          ) AS t
          WHERE t.the !~ '^a[1-5]$'
          GROUP BY 1
          ORDER BY views DESC, posts DESC
          LIMIT 10
        `,
      ]);

    const dates = buildDateList(startDate, endDate);
    const channelMap = new Map(channelList.map((k) => [`${k.platform}|${k.kenh_id}`, k]));

    const platforms = this.mergePlatforms(aggregateRaw, byDateRaw, channelList, dates, platform);
    const channels = this.mergeChannels(byChannelRaw, channelMap);
    const topVideos = topVideoRaw.map((v) => ({
      platform: v.platform,
      postId: v.post_id,
      post_id: v.post_id,
      url: v.url,
      description: v.mo_ta,
      mo_ta: v.mo_ta,
      thumbnail: v.thumbnail,
      channelName: v.kenh_ten,
      kenh_ten: v.kenh_ten,
      views: toNum(v.views),
      likes: toNum(v.likes),
      comments: toNum(v.comments),
      date: v.ngay.toISOString(),
      ngay: v.ngay.toISOString(),
    }));
    const markets = this.mergeMarkets(marketRaw);
    const contentLines = this.mergeContentLines(contentLineRaw);
    const hashtags = hashtagRaw.map((h) => ({
      tag: h.the,
      the: h.the,
      posts: toNum(h.posts),
      views: toNum(h.views),
    }));
    const alerts = this.buildAlerts(channelList, byChannelRaw, dayCount);
    const totalChannels = channelList.length;

    const period = {
      startDate,
      endDate,
      dayCount,
      tu: startDate,
      den: endDate,
      so_ngay: dayCount,
    };

    return {
      status: 'ok',
      period,
      platforms,
      channels,
      topVideos,
      markets,
      contentLines,
      hashtags,
      alerts,
      totalChannels,

      // Backward compatibility
      ky: period,
      nen_tang: platforms,
      kenh: channels,
      top_video: topVideos,
      thi_truong: markets,
      tuyen_noi_dung: contentLines,
      hashtag: hashtags,
      canh_bao: alerts,
      tong_kenh: totalChannels,
    };
  }

  private sourceVideos(platform: string, startDate: Date, endDate: Date): Prisma.Sql {
    const branches: Prisma.Sql[] = [];

    if (!platform || platform === 'facebook') {
      branches.push(Prisma.sql`
        SELECT 'facebook'::text AS platform,
               COALESCE(mp.page_id, '')::text AS kenh_id,
               COALESCE(mp.name, '')::text AS kenh_ten,
               v.post_id::text AS post_id,
               COALESCE(v.permalink_url, '')::text AS url,
               COALESCE(v.caption, '')::text AS mo_ta,
               COALESCE(NULLIF(v.thumbnail_drive_url, ''), v.thumbnail_url, '')::text AS thumbnail,
               v.view_count::bigint AS views,
               v.like_count::bigint AS likes,
               v.comment_count::bigint AS comments,
               v.share_count::bigint AS shares,
               v.published_at AS ngay
        FROM video_management_ownedvideocontent v
        LEFT JOIN video_management_managedfacebookpage mp ON mp.id = v.managed_page_id
        WHERE v.published_at >= ${startDate} AND v.published_at <= ${endDate}
      `);
    }

    if (!platform || platform === 'tiktok') {
      branches.push(Prisma.sql`
        SELECT 'tiktok'::text AS platform,
               p.username::text AS kenh_id,
               COALESCE(NULLIF(p.nickname, ''), p.username)::text AS kenh_ten,
               v.video_id::text AS post_id,
               v.url::text AS url,
               v.description::text AS mo_ta,
               COALESCE(v.cover_image, '')::text AS thumbnail,
               v.play_count::bigint AS views,
               v.digg_count::bigint AS likes,
               v.comment_count::bigint AS comments,
               v.share_count::bigint AS shares,
               v.date_posted AS ngay
        FROM scraper_tiktok_profile_videos v
        JOIN scraper_tiktok_profiles p ON p.id = v.profile_id
        WHERE p.is_owned = true AND v.date_posted >= ${startDate} AND v.date_posted <= ${endDate}
      `);
    }

    if (!platform || platform === 'instagram') {
      branches.push(Prisma.sql`
        SELECT 'instagram'::text AS platform,
               p.username::text AS kenh_id,
               p.username::text AS kenh_ten,
               r.post_id::text AS post_id,
               r.url::text AS url,
               r.description::text AS mo_ta,
               COALESCE(NULLIF(r.thumbnail_drive_url, ''), r.thumbnail_url, '')::text AS thumbnail,
               r.play_count::bigint AS views,
               r.likes_count::bigint AS likes,
               r.comments_count::bigint AS comments,
               0::bigint AS shares,
               r.date_posted AS ngay
        FROM scraper_instagram_reels r
        JOIN scraper_instagram_profiles p ON p.id = r.profile_id
        WHERE p.is_owned = true AND r.date_posted >= ${startDate} AND r.date_posted <= ${endDate}
      `);
    }

    if (!platform || platform === 'youtube') {
      branches.push(Prisma.sql`
        SELECT 'youtube'::text AS platform,
               p.channel_id::text AS kenh_id,
               COALESCE(NULLIF(p.title, ''), p.channel_id)::text AS kenh_ten,
               s.video_id::text AS post_id,
               s.url::text AS url,
               s.title::text AS mo_ta,
               COALESCE(NULLIF(s.thumbnail_drive_url, ''), s.thumbnail_url, '')::text AS thumbnail,
               s.view_count::bigint AS views,
               0::bigint AS likes,
               0::bigint AS comments,
               0::bigint AS shares,
               s.created_at AS ngay
        FROM scraper_youtube_shorts s
        JOIN scraper_youtube_profiles p ON p.id = s.profile_id
        WHERE p.is_owned = true AND s.created_at >= ${startDate} AND s.created_at <= ${endDate}
      `);
    }

    if (!platform || platform === 'threads') {
      branches.push(Prisma.sql`
        SELECT 'threads'::text AS platform,
               p.username::text AS kenh_id,
               COALESCE(NULLIF(p.nickname, ''), p.username)::text AS kenh_ten,
               tp.post_id::text AS post_id,
               tp.url::text AS url,
               tp.text::text AS mo_ta,
               COALESCE(NULLIF(tp.thumbnail_drive_url, ''), tp.thumbnail_url, '')::text AS thumbnail,
               tp.views_count::bigint AS views,
               tp.likes_count::bigint AS likes,
               tp.replies_count::bigint AS comments,
               tp.reposts_count::bigint AS shares,
               tp.date_posted AS ngay
        FROM scraper_threads_posts tp
        JOIN scraper_threads_profiles p ON p.id = tp.profile_id
        WHERE p.is_owned = true AND tp.date_posted >= ${startDate} AND tp.date_posted <= ${endDate}
      `);
    }

    return Prisma.sql`(${Prisma.join(branches, ' UNION ALL ')})`;
  }

  private sourceChannels(platform: string): Prisma.Sql {
    const branches: Prisma.Sql[] = [];

    if (!platform || platform === 'facebook') {
      branches.push(Prisma.sql`
        SELECT 'facebook'::text AS platform, mp.page_id::text AS kenh_id, mp.name::text AS ten,
               COALESCE(NULLIF(mp.avatar_drive_url, ''), mp.avatar_url, '')::text AS avatar,
               mp.followers_count::bigint AS followers,
               mp.last_synced_at AS dong_bo,
               NULLIF(mp.scrape_error, '')::text AS loi,
               mp.is_active AS hoat_dong,
               (SELECT MAX(v.published_at) FROM video_management_ownedvideocontent v
                 WHERE v.managed_page_id = mp.id) AS ngay_cuoi
        FROM video_management_managedfacebookpage mp
      `);
    }

    if (!platform || platform === 'tiktok') {
      branches.push(Prisma.sql`
        SELECT 'tiktok'::text AS platform, p.username::text AS kenh_id,
               COALESCE(NULLIF(p.nickname, ''), p.username)::text AS ten,
               COALESCE(p.avatar_url, '')::text AS avatar, p.followers_count::bigint AS followers,
               p.last_scraped_at AS dong_bo, NULLIF(p.scrape_error, '')::text AS loi,
               true AS hoat_dong,
               (SELECT MAX(v.date_posted) FROM scraper_tiktok_profile_videos v WHERE v.profile_id = p.id) AS ngay_cuoi
        FROM scraper_tiktok_profiles p WHERE p.is_owned = true
      `);
    }

    if (!platform || platform === 'instagram') {
      branches.push(Prisma.sql`
        SELECT 'instagram'::text AS platform, p.username::text AS kenh_id, p.username::text AS ten,
               COALESCE(p.avatar_url, '')::text AS avatar, p.followers_count::bigint AS followers,
               p.last_scraped_at AS dong_bo, NULLIF(p.scrape_error, '')::text AS loi,
               true AS hoat_dong,
               (SELECT MAX(r.date_posted) FROM scraper_instagram_reels r WHERE r.profile_id = p.id) AS ngay_cuoi
        FROM scraper_instagram_profiles p WHERE p.is_owned = true
      `);
    }

    if (!platform || platform === 'youtube') {
      branches.push(Prisma.sql`
        SELECT 'youtube'::text AS platform, p.channel_id::text AS kenh_id,
               COALESCE(NULLIF(p.title, ''), p.channel_id)::text AS ten,
               COALESCE(p.avatar_url, '')::text AS avatar, p.subscriber_count::bigint AS followers,
               p.last_scraped_at AS dong_bo, NULLIF(p.scrape_error, '')::text AS loi,
               true AS hoat_dong,
               (SELECT MAX(s.created_at) FROM scraper_youtube_shorts s WHERE s.profile_id = p.id) AS ngay_cuoi
        FROM scraper_youtube_profiles p WHERE p.is_owned = true
      `);
    }

    if (!platform || platform === 'threads') {
      branches.push(Prisma.sql`
        SELECT 'threads'::text AS platform, p.username::text AS kenh_id,
               COALESCE(NULLIF(p.nickname, ''), p.username)::text AS ten,
               COALESCE(NULLIF(p.avatar_drive_url, ''), p.avatar_url, '')::text AS avatar,
               p.followers_count::bigint AS followers,
               p.last_scraped_at AS dong_bo, NULLIF(p.scrape_error, '')::text AS loi,
               true AS hoat_dong,
               (SELECT MAX(tp.date_posted) FROM scraper_threads_posts tp WHERE tp.profile_id = p.id) AS ngay_cuoi
        FROM scraper_threads_profiles p WHERE p.is_owned = true
      `);
    }

    return Prisma.sql`${Prisma.join(branches, ' UNION ALL ')}`;
  }

  private mergePlatforms(
    aggregateRows: RawAggregateMetricsRow[],
    byDateRows: RawDailyRow[],
    channelList: ChannelListRow[],
    dates: string[],
    platform: string,
  ) {
    const platformList = platform ? [platform] : [...OWNED_PLATFORMS];

    return platformList
      .map((p) => {
        const current = aggregateRows.find((t) => t.platform === p && t.ky === 'nay');
        const previous = aggregateRows.find((t) => t.platform === p && t.ky === 'truoc');
        const dateMap = new Map(byDateRows.filter((d) => d.platform === p).map((d) => [d.ngay, d]));

        const prevMetrics = {
          views: toNum(previous?.views),
          likes: toNum(previous?.likes),
          comments: toNum(previous?.comments),
          shares: toNum(previous?.shares),
          posts: toNum(previous?.posts),
        };

        const dailySeries = dates.map((dateStr) => {
          const d = dateMap.get(dateStr);
          return {
            date: dateStr,
            ngay: dateStr,
            views: toNum(d?.views),
            likes: toNum(d?.likes),
            comments: toNum(d?.comments),
            shares: toNum(d?.shares),
            posts: toNum(d?.posts),
          };
        });

        const followers = channelList
          .filter((k) => k.platform === p)
          .reduce((s, k) => s + toNum(k.followers), 0);
        const channelCount = toNum(current?.so_kenh);
        const totalChannels = channelList.filter((k) => k.platform === p).length;

        return {
          platform: p,
          views: toNum(current?.views),
          likes: toNum(current?.likes),
          comments: toNum(current?.comments),
          shares: toNum(current?.shares),
          posts: toNum(current?.posts),
          previous: prevMetrics,
          truoc: prevMetrics,
          followers,
          channelCount,
          so_kenh: channelCount,
          totalChannels,
          tong_kenh: totalChannels,
          dailySeries,
          theo_ngay: dailySeries,
        };
      })
      .filter((x) => x.totalChannels > 0);
  }

  private mergeChannels(byChannel: ChannelRow[], channelMap: Map<string, ChannelListRow>) {
    const current = byChannel.filter((k) => k.ky === 'nay');
    return current
      .map((k) => {
        const key = `${k.platform}|${k.kenh_id}`;
        const meta = channelMap.get(key);
        const prev = byChannel.find(
          (x) => x.ky === 'truoc' && x.platform === k.platform && x.kenh_id === k.kenh_id,
        );
        const name = meta?.ten || k.kenh_id;
        const syncTime = meta?.dong_bo?.toISOString() ?? null;
        const prevViews = toNum(prev?.views);

        return {
          platform: k.platform,
          id: k.kenh_id,
          name,
          ten: name,
          avatar: meta?.avatar || '',
          followers: toNum(meta?.followers),
          lastSyncedAt: syncTime,
          dong_bo: syncTime,
          posts: toNum(k.posts),
          views: toNum(k.views),
          likes: toNum(k.likes),
          comments: toNum(k.comments),
          shares: toNum(k.shares),
          previousViews: prevViews,
          views_truoc: prevViews,
        };
      })
      .sort((a, b) => b.views - a.views);
  }

  private mergeMarkets(rows: RawMarketRow[]) {
    const byPlatform = new Map<string, { platform: string; vn: number; global: number; posts_vn: number; posts_global: number }>();
    for (const r of rows) {
      const cur =
        byPlatform.get(r.platform) ??
        { platform: r.platform, vn: 0, global: 0, posts_vn: 0, posts_global: 0 };
      if (r.vn) {
        cur.vn += toNum(r.views);
        cur.posts_vn += toNum(r.posts);
      } else {
        cur.global += toNum(r.views);
        cur.posts_global += toNum(r.posts);
      }
      byPlatform.set(r.platform, cur);
    }
    return [...byPlatform.values()].sort((a, b) => b.vn + b.global - (a.vn + a.global));
  }

  private mergeContentLines(rows: RawContentLineRow[]) {
    const byCode = new Map<string, { code: string; ma: string; posts: number; views: number; viewsVn: number; views_vn: number; viewsGlobal: number; views_global: number }>();
    for (const r of rows) {
      const cur = byCode.get(r.ma) ?? {
        code: r.ma,
        ma: r.ma,
        posts: 0,
        views: 0,
        viewsVn: 0,
        views_vn: 0,
        viewsGlobal: 0,
        views_global: 0,
      };
      cur.posts += toNum(r.posts);
      cur.views += toNum(r.views);
      if (r.vn) {
        cur.viewsVn += toNum(r.views);
        cur.views_vn += toNum(r.views);
      } else {
        cur.viewsGlobal += toNum(r.views);
        cur.views_global += toNum(r.views);
      }
      byCode.set(r.ma, cur);
    }
    return [...byCode.values()].sort((a, b) => b.views - a.views);
  }

  private buildAlerts(channelList: ChannelListRow[], byChannel: ChannelRow[], dayCount: number) {
    return buildAlerts(channelList, byChannel, dayCount);
  }
}

/** Maximum alerts returned for display. */
const MAX_ALERTS_DISPLAY = 12;

/** Threshold for grouping identical error alerts. */
const ERROR_GROUPING_THRESHOLD = 3;

export function buildAlerts(
  channelList: ChannelListRow[],
  byChannel: ChannelRow[],
  dayCount: number,
): ChannelAlert[] {
  const alerts: ChannelAlert[] = [];
  const now = Date.now();
  const activeChannels = channelList.filter((k) => k.hoat_dong);

  const errorMap = new Map<string, ChannelListRow[]>();
  for (const k of activeChannels) {
    if (!k.loi) continue;
    const key = `${k.platform}|${k.loi.slice(0, 120)}`;
    const group = errorMap.get(key);
    if (group) group.push(k);
    else errorMap.set(key, [k]);
  }

  for (const [key, group] of errorMap) {
    const errorMsg = key.slice(key.indexOf('|') + 1);
    if (group.length < ERROR_GROUPING_THRESHOLD) {
      for (const k of group) {
        alerts.push({
          platform: k.platform,
          channel: k.ten,
          content: `Sync error: ${errorMsg}`,
          level: 'b',
          label: 'Error',
          kenh: k.ten,
          noi_dung: `Đồng bộ lỗi: ${errorMsg}`,
          muc: 'b',
          nhan: 'Lỗi',
        });
      }
      continue;
    }

    const platformTotal = activeChannels.filter((k) => k.platform === group[0].platform).length;
    alerts.push({
      platform: group[0].platform,
      channel: `${group.length} channels`,
      content: `Sync errors in ${group.length}/${platformTotal} channels: ${errorMsg}`,
      level: 'b',
      label: 'Error',
      kenh: `${group.length} kênh`,
      noi_dung: `Đồng bộ lỗi ở ${group.length}/${platformTotal} kênh: ${errorMsg}`,
      muc: 'b',
      nhan: 'Lỗi',
    });
  }

  for (const k of byChannel.filter((x) => x.ky === 'nay')) {
    const prev = byChannel.find(
      (x) => x.ky === 'truoc' && x.platform === k.platform && x.kenh_id === k.kenh_id,
    );
    const prevViews = toNum(prev?.views);
    if (prevViews < 10_000) continue;
    const delta = Math.round(((toNum(k.views) - prevViews) / prevViews) * 100);
    if (delta > DROP_THRESHOLD_PERCENT) continue;
    const meta = channelList.find((x) => x.platform === k.platform && x.kenh_id === k.kenh_id);
    if (meta && !meta.hoat_dong) continue;
    const name = meta?.ten || k.kenh_id;
    alerts.push({
      platform: k.platform,
      channel: name,
      content: `Views dropped by ${Math.abs(delta)}% compared to the prior ${dayCount} days`,
      level: 'b',
      label: 'Drop',
      kenh: name,
      noi_dung: `Lượt xem giảm ${Math.abs(delta)}% so với ${dayCount} ngày trước đó`,
      muc: 'b',
      nhan: 'Tụt',
    });
  }

  for (const k of activeChannels) {
    if (!k.ngay_cuoi) {
      alerts.push({
        platform: k.platform,
        channel: k.ten,
        content: 'No videos scraped yet',
        level: 'w',
        label: 'Empty',
        kenh: k.ten,
        noi_dung: 'Chưa cào được video nào',
        muc: 'w',
        nhan: 'Trống',
      });
      continue;
    }
    const silentDays = Math.floor((now - k.ngay_cuoi.getTime()) / 86_400_000);
    if (silentDays < SILENCE_THRESHOLD_DAYS) continue;
    alerts.push({
      platform: k.platform,
      channel: k.ten,
      content: `No new posts in ${silentDays} days`,
      level: 'w',
      label: 'Silent',
      kenh: k.ten,
      noi_dung: `Chưa đăng bài trong ${silentDays} ngày`,
      muc: 'w',
      nhan: 'Im lặng',
    });
  }

  return alerts.slice(0, MAX_ALERTS_DISPLAY);
}

export function normalizePlatform(raw?: string): string {
  const v = (raw || '').trim().toLowerCase();
  if (!v || v === 'all') return '';
  return (OWNED_PLATFORMS as readonly string[]).includes(v) ? v : '';
}

// Backward compatibility alias
export const chuanHoaNenTang = normalizePlatform;

function isValidDateFormat(s?: string): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function daysBetween(startDate: string, endDate: string): number {
  const a = Date.parse(`${startDate}T00:00:00.000Z`);
  const b = Date.parse(`${endDate}T00:00:00.000Z`);
  return Math.floor((b - a) / 86_400_000) + 1;
}

export function normalizeDateRange(rawStartDate?: string, rawEndDate?: string, rawDays?: string): { startDate: string; endDate: string; tu: string; den: string } {
  const today = formatVietnamDate(new Date());

  let endDate = isValidDateFormat(rawEndDate) ? rawEndDate : today;
  let startDate: string;

  if (isValidDateFormat(rawStartDate)) {
    startDate = rawStartDate;
  } else {
    const dayCount = VALID_DAYS_PRESET.includes(parseInt(rawDays || '', 10))
      ? parseInt(rawDays!, 10)
      : DEFAULT_DAYS;
    startDate = addDays(endDate, -(dayCount - 1));
  }

  if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
  if (endDate > today) endDate = today;
  if (startDate > endDate) startDate = endDate;
  if (daysBetween(startDate, endDate) > MAX_DAYS_SPAN) startDate = addDays(endDate, -(MAX_DAYS_SPAN - 1));

  return {
    startDate,
    endDate,
    tu: startDate,
    den: endDate,
  };
}

// Backward compatibility alias
export const chuanHoaKhoang = normalizeDateRange;

function buildDateList(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let cur = startDate;
  while (cur <= endDate) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}
