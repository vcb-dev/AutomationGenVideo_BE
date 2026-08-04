import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

function parseIntOrDefault(val: any, def?: number): number | undefined {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
}

// search dùng immutable_unaccent() qua GIN trigram index (Phase 1+2)
function unaccentLike(col: Prisma.Sql, q: string): Prisma.Sql {
  return Prisma.sql`lower(immutable_unaccent(${col})) LIKE '%' || lower(immutable_unaccent(${q})) || '%'`;
}

// Khớp unaccentIncludesHashtag() cũ — hashtags KHÔNG unaccent, chỉ lowercase.
function hashtagLike(hashtagsCol: Prisma.Sql, q: string): Prisma.Sql {
  const hq = q.replace(/^#/, '');
  return Prisma.sql`EXISTS (SELECT 1 FROM unnest(${hashtagsCol}) h WHERE lower(h) LIKE '%' || lower(${hq}) || '%')`;
}

interface YoutubeShortRow {
  video_id: string; title: string; hashtags: string[]; url: string; thumbnail_url: string | null;
  thumbnail_drive_url: string | null; view_count: bigint; view_count_text: string; created_at: Date;
  profile_id: bigint;
}

interface YoutubeProfileRow {
  id: bigint; channel_id: string; title: string; description: string | null; url: string;
  avatar_url: string | null; banner_url: string | null; is_verified: boolean; has_business_email: boolean;
  subscriber_count: bigint; video_count: number; view_count: bigint; country: string | null;
  channel_created_at: Date | null; is_tracked: boolean; is_bookmarked: boolean; is_owned: boolean;
  is_initial_scraped: boolean; scraping_status: string; scrape_error: string | null;
  last_scraped_at: Date | null; created_at: Date; shorts_count: bigint;
}

// Nền tảng mới — BE sở hữu đọc từ đầu, không có view AI cũ để migrate.
// Mirror pattern đọc của TikTok/Douyin (list/detail/videos + unaccent search).
@Injectable()
export class YoutubeScraperReadService {
  private serializeProfile(p: any, shortsInDb: number) {
    return {
      id: Number(p.id),
      channel_id: p.channel_id,
      title: p.title,
      description: p.description || '',
      url: p.url,
      avatar_url: p.avatar_url || '',
      banner_url: p.banner_url || '',
      is_verified: p.is_verified,
      has_business_email: p.has_business_email,
      subscriber_count: Number(p.subscriber_count),
      video_count: p.video_count,
      view_count: Number(p.view_count),
      country: p.country,
      channel_created_at: p.channel_created_at,
      is_tracked: p.is_tracked,
      is_bookmarked: p.is_bookmarked,
      is_owned: p.is_owned,
      is_initial_scraped: p.is_initial_scraped,
      scraping_status: p.scraping_status,
      scrape_error: p.scrape_error,
      last_scraped_at: p.last_scraped_at,
      created_at: p.created_at,
      shorts_in_db: shortsInDb,
    };
  }

  constructor(private readonly prisma: PrismaService) {}

  // ─── Lookalike Creator: kênh khác trùng hashtag ────────────────────────────
  private static readonly TOP_HASHTAGS_PER_PROFILE = 15;
  private static readonly MIN_HASHTAG_OVERLAP = 2;
  private static readonly MAX_LOOKALIKE_RESULTS = 10;

  async lookalikes(profileId: bigint) {
    const topTags = await this.prisma.$queryRaw<{ hashtag: string; cnt: bigint }[]>`
      SELECT h AS hashtag, COUNT(*) AS cnt
      FROM scraper_youtube_shorts, unnest(hashtags) AS h
      WHERE profile_id = ${profileId}
      GROUP BY h ORDER BY cnt DESC LIMIT ${YoutubeScraperReadService.TOP_HASHTAGS_PER_PROFILE}
    `;
    if (topTags.length === 0) return { lookalikes: [] };
    const tagList = topTags.map((t) => t.hashtag);

    const overlaps = await this.prisma.$queryRaw<{ profile_id: bigint; overlap_count: bigint }[]>`
      SELECT s.profile_id AS profile_id, COUNT(DISTINCT h) AS overlap_count
      FROM scraper_youtube_shorts s, unnest(s.hashtags) AS h
      WHERE h IN (${Prisma.join(tagList)}) AND s.profile_id <> ${profileId}
      GROUP BY s.profile_id
      HAVING COUNT(DISTINCT h) >= ${YoutubeScraperReadService.MIN_HASHTAG_OVERLAP}
      ORDER BY overlap_count DESC
      LIMIT ${YoutubeScraperReadService.MAX_LOOKALIKE_RESULTS}
    `;
    if (overlaps.length === 0) return { lookalikes: [] };

    const profiles = await this.prisma.scraperYoutubeProfile.findMany({
      where: { id: { in: overlaps.map((o) => o.profile_id) } },
    });
    const profileMap = new Map(profiles.map((p) => [p.id.toString(), p]));

    return {
      lookalikes: overlaps
        .map((o) => {
          const p = profileMap.get(o.profile_id.toString());
          if (!p) return null;
          return {
            id: Number(p.id),
            channel_id: p.channel_id,
            title: p.title,
            avatar_url: p.avatar_url || '',
            subscriber_count: Number(p.subscriber_count),
            overlap_count: Number(o.overlap_count),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    };
  }

  async listProfiles(params: {
    page?: string; page_size?: string; search?: string; sort_by?: string; is_owned?: string;
  }) {
    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 12)!));
    const search = (params.search || '').trim();
    const sortBy = params.sort_by || 'subscribers';
    const isOwnedParam = (params.is_owned || '').trim();

    const conditions: Prisma.Sql[] = [];
    if (isOwnedParam === 'true') conditions.push(Prisma.sql`is_owned = true`);
    else if (isOwnedParam === 'false') conditions.push(Prisma.sql`is_owned = false`);
    if (search) conditions.push(unaccentLike(Prisma.sql`title`, search));
    const whereClause = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    const secondaryOrderCol = sortBy === 'recent' ? Prisma.sql`created_at` : Prisma.sql`subscriber_count`;

    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM scraper_youtube_profiles ${whereClause}
    `;
    const totalNum = Number(total);
    const totalPages = totalNum > 0 ? Math.ceil(totalNum / pageSize) : 1;
    const offset = (pageNum - 1) * pageSize;

    const profiles = await this.prisma.$queryRaw<YoutubeProfileRow[]>`
      SELECT p.id, p.channel_id, p.title, p.description, p.url, p.avatar_url, p.banner_url, p.is_verified,
             p.has_business_email, p.subscriber_count, p.video_count, p.view_count, p.country,
             p.channel_created_at, p.is_tracked, p.is_bookmarked, p.is_owned, p.is_initial_scraped,
             p.scraping_status, p.scrape_error, p.last_scraped_at, p.created_at,
             (SELECT COUNT(*) FROM scraper_youtube_shorts s WHERE s.profile_id = p.id) AS shorts_count
      FROM scraper_youtube_profiles p
      ${whereClause}
      ORDER BY p.is_bookmarked DESC, ${secondaryOrderCol} DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    return {
      status: 'ok',
      count: totalNum,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      profiles: profiles.map((p) => this.serializeProfile(p, Number(p.shorts_count))),
    };
  }

  async listShorts(params: {
    page?: string; page_size?: string; q?: string;
    profile_id?: string; min_views?: string; sort?: string;
  }) {
    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 24)!));
    const q = (params.q || '').trim();
    const minViews = parseIntOrDefault(params.min_views);
    const sort = params.sort || 'views';
    const profileId = parseIntOrDefault(params.profile_id);

    const conditions: Prisma.Sql[] = [];
    if (profileId !== undefined) conditions.push(Prisma.sql`s.profile_id = ${BigInt(profileId)}`);
    if (minViews !== undefined) conditions.push(Prisma.sql`s.view_count >= ${BigInt(minViews)}`);
    if (q) conditions.push(unaccentLike(Prisma.sql`s.title`, q));
    const whereClause = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    const orderCol = sort === 'recent' ? Prisma.sql`s.created_at` : Prisma.sql`s.view_count`;

    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM scraper_youtube_shorts s ${whereClause}
    `;
    const totalNum = Number(total);
    const totalPages = totalNum > 0 ? Math.ceil(totalNum / pageSize) : 1;
    const offset = (pageNum - 1) * pageSize;

    const shorts = await this.prisma.$queryRaw<(YoutubeShortRow & { profile_channel_id: string; profile_title: string; profile_avatar_url: string | null })[]>`
      SELECT s.video_id, s.title, s.hashtags, s.url, s.thumbnail_url, s.thumbnail_drive_url,
             s.view_count, s.view_count_text, s.created_at, s.profile_id,
             p.channel_id AS profile_channel_id, p.title AS profile_title, p.avatar_url AS profile_avatar_url
      FROM scraper_youtube_shorts s
      JOIN scraper_youtube_profiles p ON p.id = s.profile_id
      ${whereClause}
      ORDER BY ${orderCol} DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    return {
      status: 'ok',
      count: totalNum,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      shorts: shorts.map((s) => ({
        video_id: s.video_id,
        title: s.title,
        hashtags: s.hashtags,
        url: s.url,
        thumbnail_url: s.thumbnail_drive_url || s.thumbnail_url || '',
        view_count: Number(s.view_count),
        view_count_text: s.view_count_text,
        created_at: s.created_at,
        profile: {
          id: Number(s.profile_id),
          channel_id: s.profile_channel_id,
          title: s.profile_title,
          avatar_url: s.profile_avatar_url || '',
        },
      })),
    };
  }

  async profileDetail(profileId: bigint): Promise<any | null> {
    const p = await this.prisma.scraperYoutubeProfile.findUnique({ where: { id: profileId } });
    if (!p) return null;

    const agg = await this.prisma.scraperYoutubeShort.aggregate({
      where: { profile_id: profileId },
      _sum: { view_count: true },
      _count: { id: true },
    });

    return {
      ...this.serializeProfile(p, agg._count.id),
      total_views: Number(agg._sum.view_count || 0),
    };
  }

  async profileShorts(
    profileId: bigint,
    params: { page?: string; page_size?: string; sort?: string; q?: string; min_views?: string },
  ): Promise<any | null> {
    const profile = await this.prisma.scraperYoutubeProfile.findUnique({ where: { id: profileId } });
    if (!profile) return null;

    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 24)!));
    const sort = params.sort || 'scraped';
    const q = (params.q || '').trim();
    const minViews = parseIntOrDefault(params.min_views);

    // baseConditions (profile_id + minViews) dùng cho shorts_in_db của profile —
    // KHÔNG áp dụng q, khớp đúng hành vi cũ (all.length trước khi filter theo q).
    const baseConditions: Prisma.Sql[] = [Prisma.sql`profile_id = ${profileId}`];
    if (minViews !== undefined) baseConditions.push(Prisma.sql`view_count >= ${BigInt(minViews)}`);
    const fullConditions = [...baseConditions];
    if (q) fullConditions.push(Prisma.sql`(${unaccentLike(Prisma.sql`title`, q)} OR ${hashtagLike(Prisma.sql`hashtags`, q)})`);

    const orderCol = sort === 'views' ? Prisma.sql`view_count` : Prisma.sql`created_at`;

    const [[{ total: baseTotal }], [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*) AS total FROM scraper_youtube_shorts WHERE ${Prisma.join(baseConditions, ' AND ')}
      `,
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*) AS total FROM scraper_youtube_shorts WHERE ${Prisma.join(fullConditions, ' AND ')}
      `,
    ]);
    const totalNum = Number(total);
    const totalPages = totalNum > 0 ? Math.ceil(totalNum / pageSize) : 1;
    const offset = (pageNum - 1) * pageSize;

    const paginated = await this.prisma.$queryRaw<YoutubeShortRow[]>`
      SELECT video_id, title, hashtags, url, thumbnail_url, thumbnail_drive_url, view_count,
             view_count_text, created_at, profile_id
      FROM scraper_youtube_shorts
      WHERE ${Prisma.join(fullConditions, ' AND ')}
      ORDER BY ${orderCol} DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    return {
      status: 'ok',
      count: totalNum,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      profile: this.serializeProfile(profile, Number(baseTotal)),
      shorts: paginated.map((s) => ({
        video_id: s.video_id,
        title: s.title,
        hashtags: s.hashtags,
        url: s.url,
        thumbnail_url: s.thumbnail_drive_url || s.thumbnail_url || '',
        view_count: Number(s.view_count),
        view_count_text: s.view_count_text,
        created_at: s.created_at,
      })),
    };
  }
}
