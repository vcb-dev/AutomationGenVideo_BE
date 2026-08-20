import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { normalizeDateRange, normalizePlatform, daysBetween } from './owned-stats.service';

/**
 * Detects identical videos posted across multiple owned internal channels.
 *
 * ── Deduplication Key Strategy ──────────────────────────────────────────────
 * Key = (platform, normalized_caption, duration_seconds).
 * Tested on production data (20,515 videos / 94 fanpages):
 *   - Matches normalized caption + duration.
 *   - Ignores captions shorter than 20 characters to prevent false positives.
 */

/** Minimum caption length required for duplicate detection. */
const MIN_CAPTION_LENGTH = 20;

/** Maximum number of duplicate groups returned for the dashboard block. */
const MAX_RETURNED_GROUPS = 20;

/** Channel minimum video volume floor for duplicate ratio relevance. */
const WARNING_VIDEO_FLOOR = 20;

/** Threshold ratio (>=90%) for warning that a channel has nearly no original content. */
const WARNING_RATIO_THRESHOLD = 90;

/** Cache TTL in milliseconds (5 minutes). */
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface RawDuplicateGroupRow {
  platform: string;
  cap: string;
  giay: number | null;
  so_kenh: bigint;
  so_video: bigint;
  views: bigint;
  kenh_id: string[];
  kenh_ten: string[];
  kenh_url?: string[];
  kenh_views?: bigint[];
  ngay_dau: Date;
  ngay_cuoi: Date;
  url_mau: string;
}

export interface RawChannelVideoRow {
  platform: string;
  kenh_id: string;
  kenh_ten: string;
  video_trung: bigint;
  tong_video: bigint;
}

interface RawDuplicateSummaryRow {
  so_nhom: bigint;
  so_nhom_tu_3_kenh: bigint;
  so_video_trung: bigint;
  tong_video: bigint;
  so_kenh_dinh: bigint;
}

export interface ChannelAlert {
  platform: string;
  channel: string;
  content: string;
  level: 'w' | 'b';
  label: string;
  // Backward compatibility:
  kenh?: string;
  noi_dung?: string;
  muc?: 'w' | 'b';
  nhan?: string;
}

export interface DuplicateGroupChannel {
  id: string;
  name: string;
  url: string;
  views: number;
  // Backward compatibility:
  ten?: string;
}

export interface DuplicateGroup {
  content: string;
  platform: string;
  durationSeconds: number | null;
  channelCount: number;
  videoCount: number;
  views: number;
  channels: DuplicateGroupChannel[];
  startDate: string;
  endDate: string;
  sampleUrl: string;

  // Backward compatibility aliases:
  noi_dung?: string;
  giay?: number | null;
  so_kenh?: number;
  so_video?: number;
  kenh?: DuplicateGroupChannel[];
  ngay_dau?: string;
  ngay_cuoi?: string;
  url_mau?: string;
}

export interface DuplicateByChannel {
  platform: string;
  id: string;
  name: string;
  duplicateVideos: number;
  totalVideos: number;
  duplicateRatio: number;

  // Backward compatibility aliases:
  ten?: string;
  video_trung?: number;
  tong_video?: number;
  ty_le?: number;
}

const toNum = (v: bigint | number | null | undefined): number => Number(v ?? 0);

/** Rounds to 1 decimal place (e.g. 98.6). */
const roundToOneDecimal = (v: number): number => Math.round(v * 10) / 10;

/**
 * Truncates caption string properly respecting unicode graphemes (NFC).
 */
export function truncateContent(caption: string, maxLength: number): string {
  if (!caption) return '';
  const normalized = caption.normalize('NFC');
  const chars = [...normalized];
  return chars.length <= maxLength ? normalized : chars.slice(0, maxLength).join('') + '…';
}

/**
 * Merges raw group rows into structured DuplicateGroup array sorted by channel count then views.
 */
export function mergeGroups(rows: RawDuplicateGroupRow[]): DuplicateGroup[] {
  return rows
    .map((r) => {
      const channelCount = toNum(r.so_kenh);
      const videoCount = toNum(r.so_video);
      const views = toNum(r.views);
      const startDate = r.ngay_dau.toISOString();
      const endDate = r.ngay_cuoi.toISOString();
      const sampleUrl = r.url_mau ?? '';
      const channels: DuplicateGroupChannel[] = r.kenh_id.map((id, i) => {
        const name = r.kenh_ten[i] ?? id;
        const url = r.kenh_url?.[i] ?? '';
        const vCount = toNum(r.kenh_views?.[i]);
        return {
          id,
          name,
          url,
          views: vCount,
          ten: name,
        };
      });

      return {
        content: r.cap,
        platform: r.platform,
        durationSeconds: r.giay,
        channelCount,
        videoCount,
        views,
        channels,
        startDate,
        endDate,
        sampleUrl,

        // Backward compatibility
        noi_dung: r.cap,
        giay: r.giay,
        so_kenh: channelCount,
        so_video: videoCount,
        kenh: channels,
        ngay_dau: startDate,
        ngay_cuoi: endDate,
        url_mau: sampleUrl,
      };
    })
    .sort((a, b) => b.channelCount - a.channelCount || b.views - a.views);
}

/**
 * Computes duplicate statistics by channel.
 */
export function computeByChannel(rows: RawChannelVideoRow[]): DuplicateByChannel[] {
  return rows
    .map((r) => {
      const total = toNum(r.tong_video);
      const duplicates = toNum(r.video_trung);
      const name = r.kenh_ten || r.kenh_id;
      const ratio = total > 0 ? roundToOneDecimal((duplicates / total) * 100) : 0;
      return {
        platform: r.platform,
        id: r.kenh_id,
        name,
        duplicateVideos: duplicates,
        totalVideos: total,
        duplicateRatio: ratio,

        // Backward compatibility
        ten: name,
        video_trung: duplicates,
        tong_video: total,
        ty_le: ratio,
      };
    })
    .sort((a, b) => b.duplicateRatio - a.duplicateRatio || b.duplicateVideos - a.duplicateVideos);
}

/**
 * Builds duplicate warning alerts for channels exceeding the warning threshold.
 */
export function buildDuplicateAlerts(byChannel: DuplicateByChannel[]): ChannelAlert[] {
  return byChannel
    .filter((k) => k.totalVideos >= WARNING_VIDEO_FLOOR && k.duplicateRatio >= WARNING_RATIO_THRESHOLD)
    .map((k) => {
      const message = `${k.duplicateVideos}/${k.totalVideos} videos duplicated with other channels (${k.duplicateRatio}%) — minimal unique content`;
      return {
        platform: k.platform,
        channel: k.name,
        content: message,
        level: 'b' as const,
        label: 'Duplicate',

        // Backward compatibility
        kenh: k.name,
        noi_dung: `${k.duplicateVideos}/${k.totalVideos} video trong kỳ trùng với kênh khác (${String(k.duplicateRatio).replace('.', ',')}%) — gần như không có nội dung riêng`,
        muc: 'b' as const,
        nhan: 'Trùng',
      };
    });
}

@Injectable()
export class OwnedDuplicateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async getDuplicateStats(params: { platform?: string; days?: string; tu?: string; den?: string }) {
    const platform = normalizePlatform(params.platform);
    const { startDate, endDate } = normalizeDateRange(params.tu, params.den, params.days);

    return this.cache.get(`owned-dup:${platform || 'all'}:${startDate}:${endDate}`, CACHE_TTL_MS, () =>
      this.calculateDuplicates(platform, startDate, endDate),
    );
  }

  // Alias for backward compatibility
  async thongKe(params: { platform?: string; days?: string; tu?: string; den?: string }) {
    return this.getDuplicateStats(params);
  }

  private async calculateDuplicates(platform: string, startDate: string, endDate: string) {
    const fromDate = new Date(`${startDate}T00:00:00.000+07:00`);
    const toDate = new Date(`${endDate}T23:59:59.999+07:00`);
    const source = this.sourceDuplicateVideos(platform, fromDate, toDate);

    const duplicateGroups = Prisma.sql`
      SELECT v.platform, v.cap, v.giay
      FROM (${source}) AS v
      GROUP BY 1, 2, 3
      HAVING COUNT(DISTINCT v.kenh_id) > 1
    `;

    const joinGroups = Prisma.sql`
      LEFT JOIN (${duplicateGroups}) AS g
        ON g.platform = v.platform AND g.cap = v.cap AND g.giay IS NOT DISTINCT FROM v.giay
    `;

    const [groupsRaw, byChannelRaw, [summaryRaw]] = await Promise.all([
      this.prisma.$queryRaw<RawDuplicateGroupRow[]>`
        WITH v AS (${source}),
        k AS (
          SELECT v.platform, v.cap, v.giay, v.kenh_id,
                 MIN(v.kenh_ten) AS kenh_ten,
                 COUNT(*)::bigint AS so_video,
                 COALESCE(SUM(v.views), 0)::bigint AS views,
                 MIN(v.ngay) AS ngay_dau, MAX(v.ngay) AS ngay_cuoi,
                 (array_agg(v.url ORDER BY v.views DESC))[1] AS url_mau
          FROM v GROUP BY 1, 2, 3, 4
        )
        SELECT k.platform, k.cap, k.giay,
               COUNT(*)::bigint AS so_kenh,
               SUM(k.so_video)::bigint AS so_video,
               SUM(k.views)::bigint AS views,
               array_agg(k.kenh_id ORDER BY k.views DESC) AS kenh_id,
               array_agg(k.kenh_ten ORDER BY k.views DESC) AS kenh_ten,
               array_agg(k.url_mau ORDER BY k.views DESC) AS kenh_url,
               array_agg(k.views ORDER BY k.views DESC) AS kenh_views,
               MIN(k.ngay_dau) AS ngay_dau, MAX(k.ngay_cuoi) AS ngay_cuoi,
               (array_agg(k.url_mau ORDER BY k.views DESC))[1] AS url_mau
        FROM k GROUP BY 1, 2, 3
        HAVING COUNT(*) > 1
        ORDER BY so_kenh DESC, views DESC
        LIMIT ${MAX_RETURNED_GROUPS}
      `,
      this.prisma.$queryRaw<RawChannelVideoRow[]>`
        SELECT v.platform, v.kenh_id, MIN(v.kenh_ten) AS kenh_ten,
               COUNT(*) FILTER (WHERE g.cap IS NOT NULL)::bigint AS video_trung,
               COUNT(*)::bigint AS tong_video
        FROM (${source}) AS v
        ${joinGroups}
        GROUP BY 1, 2
      `,
      this.prisma.$queryRaw<RawDuplicateSummaryRow[]>`
        SELECT (SELECT COUNT(*) FROM (${duplicateGroups}) AS a)::bigint AS so_nhom,
               (SELECT COUNT(*) FROM (
                  SELECT 1 FROM (${source}) AS b
                  GROUP BY b.platform, b.cap, b.giay
                  HAVING COUNT(DISTINCT b.kenh_id) >= 3
                ) AS c)::bigint AS so_nhom_tu_3_kenh,
               COUNT(*) FILTER (WHERE g.cap IS NOT NULL)::bigint AS so_video_trung,
               COUNT(*)::bigint AS tong_video,
               COUNT(DISTINCT v.kenh_id) FILTER (WHERE g.cap IS NOT NULL)::bigint AS so_kenh_dinh
        FROM (${source}) AS v
        ${joinGroups}
      `,
    ]);

    const byChannel = computeByChannel(byChannelRaw);
    const totalVideos = toNum(summaryRaw?.tong_video);
    const duplicateVideos = toNum(summaryRaw?.so_video_trung);
    const duplicateRatio = totalVideos > 0 ? roundToOneDecimal((duplicateVideos / totalVideos) * 100) : 0;
    const groupCount = toNum(summaryRaw?.so_nhom);
    const groupsWithAtLeast3 = toNum(summaryRaw?.so_nhom_tu_3_kenh);
    const affectedChannels = toNum(summaryRaw?.so_kenh_dinh);

    const groups = mergeGroups(groupsRaw);
    const filteredByChannel = byChannel.filter((k) => k.duplicateVideos > 0);
    const alerts = buildDuplicateAlerts(byChannel);
    const dayCount = daysBetween(startDate, endDate);

    const summary = {
      groupCount,
      groupsWithAtLeast3Channels: groupsWithAtLeast3,
      duplicateVideoCount: duplicateVideos,
      totalVideos,
      duplicateRatio,
      affectedChannelCount: affectedChannels,

      // Backward compatibility
      so_nhom: groupCount,
      so_nhom_tu_3_kenh: groupsWithAtLeast3,
      so_video_trung: duplicateVideos,
      tong_video: totalVideos,
      ty_le: duplicateRatio,
      so_kenh_dinh: affectedChannels,
    };

    const period = {
      startDate,
      endDate,
      dayCount,
      // Backward compatibility
      tu: startDate,
      den: endDate,
      so_ngay: dayCount,
    };

    return {
      status: 'ok',
      period,
      summary,
      groups,
      byChannel: filteredByChannel,
      alerts,

      // Backward compatibility
      ky: period,
      tom_tat: summary,
      nhom: groups,
      theo_kenh: filteredByChannel,
      canh_bao: alerts,
    };
  }

  private sourceDuplicateVideos(platform: string, startDate: Date, endDate: Date): Prisma.Sql {
    const branches: Prisma.Sql[] = [];

    if (!platform || platform === 'facebook') {
      branches.push(Prisma.sql`
        SELECT 'facebook'::text AS platform,
               COALESCE(mp.page_id, '')::text AS kenh_id,
               COALESCE(mp.name, '')::text AS kenh_ten,
               COALESCE(v.permalink_url, '')::text AS url,
               ${this.normalizeCaptionSql(Prisma.sql`v.caption`)} AS cap,
               ${DURATION_FACEBOOK} AS giay,
               v.view_count::bigint AS views,
               v.published_at AS ngay
        FROM video_management_ownedvideocontent v
        LEFT JOIN video_management_managedfacebookpage mp ON mp.id = v.managed_page_id
        ${EFG_FACEBOOK}
        WHERE v.published_at >= ${startDate} AND v.published_at <= ${endDate}
          AND length(btrim(v.caption)) >= ${MIN_CAPTION_LENGTH}
      `);
    }

    if (!platform || platform === 'tiktok') {
      branches.push(Prisma.sql`
        SELECT 'tiktok'::text AS platform,
               p.username::text AS kenh_id,
               COALESCE(NULLIF(p.nickname, ''), p.username)::text AS kenh_ten,
               v.url::text AS url,
               ${this.normalizeCaptionSql(Prisma.sql`v.description`)} AS cap,
               NULLIF(v.video_duration, 0)::int AS giay,
               v.play_count::bigint AS views,
               v.date_posted AS ngay
        FROM scraper_tiktok_profile_videos v
        JOIN scraper_tiktok_profiles p ON p.id = v.profile_id
        WHERE p.is_owned = true AND v.date_posted >= ${startDate} AND v.date_posted <= ${endDate}
          AND length(btrim(v.description)) >= ${MIN_CAPTION_LENGTH}
      `);
    }

    if (!platform || platform === 'instagram') {
      branches.push(Prisma.sql`
        SELECT 'instagram'::text AS platform,
               p.username::text AS kenh_id,
               p.username::text AS kenh_ten,
               r.url::text AS url,
               ${this.normalizeCaptionSql(Prisma.sql`r.description`)} AS cap,
               NULLIF(round(r.duration_seconds)::int, 0) AS giay,
               r.play_count::bigint AS views,
               r.date_posted AS ngay
        FROM scraper_instagram_reels r
        JOIN scraper_instagram_profiles p ON p.id = r.profile_id
        WHERE p.is_owned = true AND r.date_posted >= ${startDate} AND r.date_posted <= ${endDate}
          AND length(btrim(r.description)) >= ${MIN_CAPTION_LENGTH}
      `);
    }

    if (!platform || platform === 'youtube') {
      branches.push(Prisma.sql`
        SELECT 'youtube'::text AS platform,
               p.channel_id::text AS kenh_id,
               COALESCE(NULLIF(p.title, ''), p.channel_id)::text AS kenh_ten,
               s.url::text AS url,
               ${this.normalizeCaptionSql(Prisma.sql`s.title`)} AS cap,
               NULL::int AS giay,
               s.view_count::bigint AS views,
               s.created_at AS ngay
        FROM scraper_youtube_shorts s
        JOIN scraper_youtube_profiles p ON p.id = s.profile_id
        WHERE p.is_owned = true AND s.created_at >= ${startDate} AND s.created_at <= ${endDate}
          AND length(btrim(s.title)) >= ${MIN_CAPTION_LENGTH}
      `);
    }

    if (!platform || platform === 'threads') {
      branches.push(Prisma.sql`
        SELECT 'threads'::text AS platform,
               p.username::text AS kenh_id,
               COALESCE(NULLIF(p.nickname, ''), p.username)::text AS kenh_ten,
               tp.url::text AS url,
               ${this.normalizeCaptionSql(Prisma.sql`tp.text`)} AS cap,
               NULL::int AS giay,
               tp.views_count::bigint AS views,
               tp.date_posted AS ngay
        FROM scraper_threads_posts tp
        JOIN scraper_threads_profiles p ON p.id = tp.profile_id
        WHERE p.is_owned = true AND tp.date_posted >= ${startDate} AND tp.date_posted <= ${endDate}
          AND length(btrim(tp.text)) >= ${MIN_CAPTION_LENGTH}
      `);
    }

    return Prisma.join(branches, ' UNION ALL ');
  }

  private normalizeCaptionSql(col: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`lower(regexp_replace(btrim(${col}), '\\s+', ' ', 'g'))::text`;
  }
}

const EFG_FACEBOOK = Prisma.sql`
  CROSS JOIN LATERAL (
    SELECT replace(substring(v.video_url from '[?&]efg=([^&]+)'), '%3D', '=') AS chuoi
  ) AS e
`;

const DURATION_FACEBOOK = Prisma.sql`
  CASE WHEN e.chuoi ~ '^[A-Za-z0-9+/]+={0,2}$' AND length(e.chuoi) % 4 = 0
       THEN NULLIF(substring(
              convert_from(decode(e.chuoi, 'base64'), 'LATIN1')
              from '"duration_s"[[:space:]]*:[[:space:]]*([0-9]+)'), '')::int
  END
`;
