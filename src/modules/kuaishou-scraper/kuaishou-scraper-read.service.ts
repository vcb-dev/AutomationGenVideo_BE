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

interface KuaishouSearchVideoRow {
  post_id: string; url: string; description: string; hashtags: string[]; thumbnail_url: string | null;
  video_duration: number; view_count: bigint; like_count: bigint; comment_count: bigint; share_count: bigint;
  collect_count: bigint; search_keyword: string; date_posted: Date;
  author_id: string; author_eid: string; author_username: string; author_avatar: string | null; author_avatar_drive_url?: string | null; author_is_verified: boolean;
}

interface KuaishouVideoRow {
  post_id: string; url: string; description: string; hashtags: string[]; thumbnail_url: string | null;
  thumbnail_drive_url: string | null; video_duration: number; view_count: bigint; like_count: bigint;
  comment_count: bigint; share_count: bigint; collect_count: bigint; date_posted: Date; created_at: Date;
}

// Nền tảng mới — BE sở hữu đọc từ đầu, không có view AI cũ để migrate.
// Mirror pattern đọc của YouTube/TikTok (list/detail/videos + unaccent search).
// Không có is_owned — Kuaishou chỉ có kênh ngoài.
@Injectable()
export class KuaishouScraperReadService {
  private serializeProfile(p: any, videosInDb: number) {
    return {
      id: Number(p.id),
      eid: p.eid,
      user_id: p.user_id,
      username: p.username,
      nickname: p.nickname,
      url: p.url,
      avatar_url: p.avatar_drive_url || p.avatar_url || '',
      biography: p.biography || '',
      gender: p.gender,
      followers_count: Number(p.followers_count),
      following_count: Number(p.following_count),
      likes_count: Number(p.likes_count),
      videos_count: p.videos_count,
      is_tracked: p.is_tracked,
      is_bookmarked: p.is_bookmarked,
      is_initial_scraped: p.is_initial_scraped,
      scraping_status: p.scraping_status,
      scrape_error: p.scrape_error,
      last_scraped_at: p.last_scraped_at,
      created_at: p.created_at,
      videos_in_db: videosInDb,
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
      FROM scraper_kuaishou_videos, unnest(hashtags) AS h
      WHERE profile_id = ${profileId}
      GROUP BY h ORDER BY cnt DESC LIMIT ${KuaishouScraperReadService.TOP_HASHTAGS_PER_PROFILE}
    `;
    if (topTags.length === 0) return { lookalikes: [] };
    const tagList = topTags.map((t) => t.hashtag);

    const overlaps = await this.prisma.$queryRaw<{ profile_id: bigint; overlap_count: bigint }[]>`
      SELECT v.profile_id AS profile_id, COUNT(DISTINCT h) AS overlap_count
      FROM scraper_kuaishou_videos v, unnest(v.hashtags) AS h
      WHERE h IN (${Prisma.join(tagList)}) AND v.profile_id <> ${profileId}
      GROUP BY v.profile_id
      HAVING COUNT(DISTINCT h) >= ${KuaishouScraperReadService.MIN_HASHTAG_OVERLAP}
      ORDER BY overlap_count DESC
      LIMIT ${KuaishouScraperReadService.MAX_LOOKALIKE_RESULTS}
    `;
    if (overlaps.length === 0) return { lookalikes: [] };

    const profiles = await this.prisma.scraperKuaishouProfile.findMany({
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
            eid: p.eid,
            username: p.username,
            nickname: p.nickname,
            avatar_url: p.avatar_drive_url || p.avatar_url || '',
            followers_count: Number(p.followers_count),
            overlap_count: Number(o.overlap_count),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    };
  }

  // ─── Keyword search ────────────────────────────────────────────────────────

  async listVideos(params: {
    page?: string; page_size?: string; q?: string; min_views?: string;
    date_from?: string; date_to?: string; sort?: string; search_keyword?: string;
  }) {
    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 24)!));
    const q = (params.q || '').trim();
    const minViews = parseIntOrDefault(params.min_views);
    const dateFrom = (params.date_from || '').trim();
    const dateTo = (params.date_to || '').trim();
    const sort = params.sort || 'scraped';
    const kwFilter = (params.search_keyword || '').trim();

    const conditions: Prisma.Sql[] = [];
    if (minViews !== undefined) conditions.push(Prisma.sql`view_count >= ${BigInt(minViews)}`);
    if (dateFrom) conditions.push(Prisma.sql`date_posted >= ${new Date(`${dateFrom}T00:00:00.000Z`)}`);
    if (dateTo) conditions.push(Prisma.sql`date_posted <= ${new Date(`${dateTo}T23:59:59.999Z`)}`);
    if (kwFilter) conditions.push(unaccentLike(Prisma.sql`search_keyword`, kwFilter));
    if (q) conditions.push(Prisma.sql`(${unaccentLike(Prisma.sql`description`, q)} OR ${unaccentLike(Prisma.sql`search_keyword`, q)})`);
    const whereClause = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    let orderCol: Prisma.Sql = Prisma.sql`created_at`;
    if (sort === 'views') orderCol = Prisma.sql`view_count`;
    else if (sort === 'likes') orderCol = Prisma.sql`like_count`;
    else if (sort === 'comments') orderCol = Prisma.sql`comment_count`;
    else if (sort === 'date') orderCol = Prisma.sql`date_posted`;

    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM scraper_kuaishou_search_videos ${whereClause}
    `;
    const totalNum = Number(total);
    const totalPages = totalNum > 0 ? Math.ceil(totalNum / pageSize) : 1;
    const offset = (pageNum - 1) * pageSize;

    const videos = await this.prisma.$queryRaw<KuaishouSearchVideoRow[]>`
      SELECT post_id, url, description, hashtags, thumbnail_url, video_duration, view_count, like_count,
             comment_count, share_count, collect_count, search_keyword, date_posted,
             author_id, author_eid, author_username, author_avatar, author_avatar_drive_url, author_is_verified
      FROM scraper_kuaishou_search_videos
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
      videos: videos.map((v) => ({
        post_id: v.post_id,
        url: v.url,
        description: v.description,
        hashtags: v.hashtags,
        thumbnail_url: v.thumbnail_url,
        video_duration: v.video_duration,
        view_count: Number(v.view_count),
        like_count: Number(v.like_count),
        comment_count: Number(v.comment_count),
        share_count: Number(v.share_count),
        collect_count: Number(v.collect_count),
        search_keyword: v.search_keyword,
        date_posted: v.date_posted,
        author: {
          id: v.author_id,
          eid: v.author_eid,
          username: v.author_username,
          avatar_url: v.author_avatar_drive_url || v.author_avatar,
          is_verified: v.author_is_verified,
        },
      })),
    };
  }

  async keywordSuggest(q: string) {
    const whereClause = q
      ? Prisma.sql`WHERE search_keyword <> '' AND ${unaccentLike(Prisma.sql`search_keyword`, q)}`
      : Prisma.sql`WHERE search_keyword <> ''`;

    const rows = await this.prisma.$queryRaw<{ keyword: string; count: bigint }[]>`
      SELECT search_keyword AS keyword, COUNT(*) AS count
      FROM scraper_kuaishou_search_videos
      ${whereClause}
      GROUP BY search_keyword
      ORDER BY count DESC
      LIMIT 10
    `;
    const results = rows.map((r) => ({ keyword: r.keyword, count: Number(r.count) }));

    return { suggestions: results };
  }

  async listProfiles(params: {
    page?: string; page_size?: string; search?: string; sort_by?: string;
  }) {
    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 12)!));
    const search = (params.search || '').trim();
    const sortBy = params.sort_by || 'followers';

    const where: any = {};
    if (search) where.OR = [
      { nickname: { contains: search, mode: 'insensitive' } },
      { username: { contains: search, mode: 'insensitive' } },
    ];

    const secondaryOrderBy = sortBy === 'recent' ? { created_at: 'desc' as const } : { followers_count: 'desc' as const };
    const orderBy = [{ is_bookmarked: 'desc' as const }, secondaryOrderBy, { id: 'desc' as const }];

    const [total, paginated] = await Promise.all([
      this.prisma.scraperKuaishouProfile.count({ where }),
      this.prisma.scraperKuaishouProfile.findMany({ where, orderBy, skip: (pageNum - 1) * pageSize, take: pageSize }),
    ]);
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;

    const videosCounts = paginated.length
      ? await this.prisma.scraperKuaishouVideo.groupBy({
          by: ['profile_id'],
          where: { profile_id: { in: paginated.map((p) => p.id) } },
          _count: { id: true },
        })
      : [];
    const countMap = new Map(videosCounts.map((c) => [c.profile_id.toString(), c._count.id]));

    return {
      status: 'ok',
      count: total,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      profiles: paginated.map((p) => this.serializeProfile(p, countMap.get(p.id.toString()) || 0)),
    };
  }

  async profileDetail(profileId: bigint): Promise<any | null> {
    const p = await this.prisma.scraperKuaishouProfile.findUnique({ where: { id: profileId } });
    if (!p) return null;

    const agg = await this.prisma.scraperKuaishouVideo.aggregate({
      where: { profile_id: profileId },
      _sum: { view_count: true },
      _count: { id: true },
    });

    return {
      ...this.serializeProfile(p, agg._count.id),
      total_views: Number(agg._sum.view_count || 0),
    };
  }

  async profileVideos(
    profileId: bigint,
    params: { page?: string; page_size?: string; sort?: string; q?: string; min_views?: string },
  ): Promise<any | null> {
    const profile = await this.prisma.scraperKuaishouProfile.findUnique({ where: { id: profileId } });
    if (!profile) return null;

    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 24)!));
    const sort = params.sort || 'scraped';
    const q = (params.q || '').trim();
    const minViews = parseIntOrDefault(params.min_views);

    // baseConditions (profile_id + minViews) dùng cho videos_in_db của profile —
    // KHÔNG áp dụng q, khớp đúng hành vi cũ (all.length trước khi filter theo q).
    const baseConditions: Prisma.Sql[] = [Prisma.sql`profile_id = ${profileId}`];
    if (minViews !== undefined) baseConditions.push(Prisma.sql`view_count >= ${BigInt(minViews)}`);
    const fullConditions = [...baseConditions];
    if (q) fullConditions.push(Prisma.sql`(${unaccentLike(Prisma.sql`description`, q)} OR ${hashtagLike(Prisma.sql`hashtags`, q)})`);

    let orderCol: Prisma.Sql = Prisma.sql`created_at`;
    if (sort === 'views') orderCol = Prisma.sql`view_count`;
    else if (sort === 'likes') orderCol = Prisma.sql`like_count`;
    else if (sort === 'comments') orderCol = Prisma.sql`comment_count`;
    else if (sort === 'date') orderCol = Prisma.sql`date_posted`;

    const [[{ total: baseTotal }], [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*) AS total FROM scraper_kuaishou_videos WHERE ${Prisma.join(baseConditions, ' AND ')}
      `,
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*) AS total FROM scraper_kuaishou_videos WHERE ${Prisma.join(fullConditions, ' AND ')}
      `,
    ]);
    const totalNum = Number(total);
    const totalPages = totalNum > 0 ? Math.ceil(totalNum / pageSize) : 1;
    const offset = (pageNum - 1) * pageSize;

    const paginated = await this.prisma.$queryRaw<KuaishouVideoRow[]>`
      SELECT post_id, url, description, hashtags, thumbnail_url, thumbnail_drive_url, video_duration,
             view_count, like_count, comment_count, share_count, collect_count, date_posted, created_at
      FROM scraper_kuaishou_videos
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
      videos: paginated.map((v) => ({
        post_id: v.post_id,
        url: v.url,
        description: v.description,
        hashtags: v.hashtags,
        thumbnail_url: v.thumbnail_drive_url || v.thumbnail_url || '',
        video_duration: v.video_duration,
        view_count: Number(v.view_count),
        like_count: Number(v.like_count),
        comment_count: Number(v.comment_count),
        share_count: Number(v.share_count),
        collect_count: Number(v.collect_count),
        date_posted: v.date_posted,
        created_at: v.created_at,
      })),
    };
  }
}
