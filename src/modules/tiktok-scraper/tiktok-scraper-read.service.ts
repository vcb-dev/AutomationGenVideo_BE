import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

function parseIntOrDefault(val: any, def?: number): number | undefined {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
}

// search dùng immutable_unaccent() qua GIN trigram index (Phase 1+2) — không
// dấu + không phân biệt hoa/thường, khớp hành vi unaccentMatch() cũ nhưng chạy
// được ở DB thay vì kéo hết về JS.
function unaccentLike(col: Prisma.Sql, q: string): Prisma.Sql {
  return Prisma.sql`lower(immutable_unaccent(${col})) LIKE '%' || lower(immutable_unaccent(${q})) || '%'`;
}

// Khớp unaccentIncludesHashtag() cũ — hashtags KHÔNG unaccent, chỉ lowercase.
function hashtagLike(hashtagsCol: Prisma.Sql, q: string): Prisma.Sql {
  const hq = q.replace(/^#/, '');
  return Prisma.sql`EXISTS (SELECT 1 FROM unnest(${hashtagsCol}) h WHERE lower(h) LIKE '%' || lower(${hq}) || '%')`;
}

interface TiktokVideoRow {
  post_id: string; shortcode: string; url: string; description: string; hashtags: string[];
  video_url: string | null; cdn_url: string | null; preview_image: string | null;
  video_duration: number; region: string;
  author_id: string; author_username: string; author_display_name: string; author_avatar: string | null;
  author_url: string; author_followers: bigint; author_is_verified: boolean;
  play_count: bigint; digg_count: bigint; comment_count: bigint; share_count: bigint; collect_count: bigint;
  music_title: string; search_keyword: string; date_posted: Date;
}

interface TiktokProfileVideoRow {
  video_id: string; shortcode: string; url: string; description: string; hashtags: string[];
  cover_image: string | null; video_duration: number; region: string; post_type: string;
  play_count: bigint; digg_count: bigint; comment_count: bigint; share_count: bigint; favorites_count: bigint;
  music_title: string; music_author: string; date_posted: Date;
}

// Port từ scraper_views.py::tiktok_videos/tiktok_keyword_suggest/tiktok_profiles_list/
// tiktok_profile_detail/tiktok_profile_videos (AI đã xóa) — chỉ đọc, không ghi.
@Injectable()
export class TiktokScraperReadService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Lookalike Creator: kênh khác trùng hashtag ────────────────────────────
  private static readonly TOP_HASHTAGS_PER_PROFILE = 15;
  private static readonly MIN_HASHTAG_OVERLAP = 2;
  private static readonly MAX_LOOKALIKE_RESULTS = 10;

  async lookalikes(profileId: bigint) {
    const topTags = await this.prisma.$queryRaw<{ hashtag: string; cnt: bigint }[]>`
      SELECT h AS hashtag, COUNT(*) AS cnt
      FROM scraper_tiktok_profile_videos, unnest(hashtags) AS h
      WHERE profile_id = ${profileId}
      GROUP BY h ORDER BY cnt DESC LIMIT ${TiktokScraperReadService.TOP_HASHTAGS_PER_PROFILE}
    `;
    if (topTags.length === 0) return { lookalikes: [] };
    const tagList = topTags.map((t) => t.hashtag);

    const overlaps = await this.prisma.$queryRaw<{ profile_id: bigint; overlap_count: bigint }[]>`
      SELECT v.profile_id AS profile_id, COUNT(DISTINCT h) AS overlap_count
      FROM scraper_tiktok_profile_videos v, unnest(v.hashtags) AS h
      WHERE h IN (${Prisma.join(tagList)}) AND v.profile_id <> ${profileId}
      GROUP BY v.profile_id
      HAVING COUNT(DISTINCT h) >= ${TiktokScraperReadService.MIN_HASHTAG_OVERLAP}
      ORDER BY overlap_count DESC
      LIMIT ${TiktokScraperReadService.MAX_LOOKALIKE_RESULTS}
    `;
    if (overlaps.length === 0) return { lookalikes: [] };

    const profiles = await this.prisma.scraperTikTokProfile.findMany({
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

  async listVideos(params: {
    page?: string; page_size?: string; q?: string; min_plays?: string;
    date_from?: string; date_to?: string; sort?: string; search_keyword?: string;
  }) {
    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 24)!));
    const q = (params.q || '').trim();
    const minPlays = parseIntOrDefault(params.min_plays);
    const dateFrom = (params.date_from || '').trim();
    const dateTo = (params.date_to || '').trim();
    const sort = params.sort || 'scraped';
    const kwFilter = (params.search_keyword || '').trim();

    const conditions: Prisma.Sql[] = [];
    if (minPlays !== undefined) conditions.push(Prisma.sql`play_count >= ${BigInt(minPlays)}`);
    if (dateFrom) conditions.push(Prisma.sql`date_posted >= ${new Date(`${dateFrom}T00:00:00.000Z`)}`);
    if (dateTo) conditions.push(Prisma.sql`date_posted <= ${new Date(`${dateTo}T23:59:59.999Z`)}`);
    if (kwFilter) conditions.push(unaccentLike(Prisma.sql`search_keyword`, kwFilter));
    if (q) {
      conditions.push(Prisma.sql`(${unaccentLike(Prisma.sql`description`, q)} OR ${unaccentLike(Prisma.sql`search_keyword`, q)})`);
    }
    const whereClause = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    let orderCol: Prisma.Sql = Prisma.sql`created_at`;
    if (sort === 'plays') orderCol = Prisma.sql`play_count`;
    else if (sort === 'likes') orderCol = Prisma.sql`digg_count`;
    else if (sort === 'date') orderCol = Prisma.sql`date_posted`;

    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM scraper_tiktok_videos ${whereClause}
    `;
    const totalNum = Number(total);
    const totalPages = totalNum > 0 ? Math.ceil(totalNum / pageSize) : 1;
    const offset = (pageNum - 1) * pageSize;

    const videos = await this.prisma.$queryRaw<TiktokVideoRow[]>`
      SELECT post_id, shortcode, url, description, hashtags, video_url, cdn_url, preview_image,
             video_duration, region, author_id, author_username, author_display_name, author_avatar,
             author_url, author_followers, author_is_verified, play_count, digg_count, comment_count,
             share_count, collect_count, music_title, search_keyword, date_posted
      FROM scraper_tiktok_videos
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
        shortcode: v.shortcode,
        url: v.url,
        description: v.description,
        hashtags: v.hashtags,
        video_url: v.video_url,
        cdn_url: v.cdn_url,
        preview_image: v.preview_image,
        video_duration: v.video_duration,
        region: v.region,
        play_count: Number(v.play_count),
        digg_count: Number(v.digg_count),
        comment_count: Number(v.comment_count),
        share_count: Number(v.share_count),
        collect_count: Number(v.collect_count),
        music_title: v.music_title,
        search_keyword: v.search_keyword,
        date_posted: v.date_posted,
        author: {
          id: v.author_id,
          username: v.author_username,
          display_name: v.author_display_name,
          avatar_url: v.author_avatar,
          url: v.author_url,
          followers: Number(v.author_followers),
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
      FROM scraper_tiktok_videos
      ${whereClause}
      GROUP BY search_keyword
      ORDER BY count DESC
      LIMIT 10
    `;
    const results = rows.map((r) => ({ keyword: r.keyword, count: Number(r.count) }));

    return { suggestions: results };
  }

  async listProfiles(params: {
    page?: string; page_size?: string; search?: string; sort_by?: string; is_owned?: string;
  }) {
    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 12)!));
    const search = (params.search || '').trim();
    const sortBy = params.sort_by || 'followers';
    const isOwnedParam = (params.is_owned || '').trim();

    const where: any = {};
    if (isOwnedParam === 'true') where.is_owned = true;
    else if (isOwnedParam === 'false') where.is_owned = false;
    if (search) where.OR = [
      { username: { contains: search, mode: 'insensitive' } },
      { nickname: { contains: search, mode: 'insensitive' } },
    ];

    const secondaryOrderBy = sortBy === 'recent' ? { created_at: 'desc' as const } : { followers_count: 'desc' as const };
    const orderBy = [{ is_bookmarked: 'desc' as const }, secondaryOrderBy, { id: 'desc' as const }];

    const [total, paginated] = await Promise.all([
      this.prisma.scraperTikTokProfile.count({ where }),
      this.prisma.scraperTikTokProfile.findMany({ where, orderBy, skip: (pageNum - 1) * pageSize, take: pageSize }),
    ]);
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;

    const videoCounts = paginated.length
      ? await this.prisma.scraperTikTokProfileVideo.groupBy({
          by: ['profile_id'],
          where: { profile_id: { in: paginated.map((p) => p.id) } },
          _count: { id: true },
        })
      : [];
    const countMap = new Map(videoCounts.map((v) => [v.profile_id.toString(), v._count.id]));

    return {
      status: 'ok',
      count: total,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      profiles: paginated.map((p) => ({
        id: Number(p.id),
        profile_id: p.profile_id,
        username: p.username,
        nickname: p.nickname,
        url: p.url,
        avatar_url: p.avatar_drive_url || p.avatar_url || '',
        biography: p.biography || '',
        is_verified: p.is_verified,
        followers_count: Number(p.followers_count),
        following_count: Number(p.following_count),
        likes_count: Number(p.likes_count),
        videos_count: p.videos_count,
        is_tracked: p.is_tracked,
        is_bookmarked: p.is_bookmarked,
        is_owned: p.is_owned,
        is_initial_scraped: p.is_initial_scraped,
        scraping_status: p.scraping_status,
        scrape_error: p.scrape_error,
        last_scraped_at: p.last_scraped_at,
        created_at: p.created_at,
        videos_in_db: countMap.get(p.id.toString()) || 0,
      })),
    };
  }

  async profileDetail(profileId: bigint): Promise<any | null> {
    const p = await this.prisma.scraperTikTokProfile.findUnique({ where: { id: profileId } });
    if (!p) return null;

    const agg = await this.prisma.scraperTikTokProfileVideo.aggregate({
      where: { profile_id: profileId },
      _sum: { play_count: true, digg_count: true, comment_count: true, share_count: true },
      _count: { id: true },
    });

    return {
      id: Number(p.id),
      profile_id: p.profile_id,
      username: p.username,
      nickname: p.nickname,
      url: p.url,
      avatar_url: p.avatar_drive_url || p.avatar_url || '',
      biography: p.biography || '',
      is_verified: p.is_verified,
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
      videos_in_db: agg._count.id,
      total_plays: Number(agg._sum.play_count || 0),
      total_diggs: Number(agg._sum.digg_count || 0),
      total_comments: Number(agg._sum.comment_count || 0),
      total_shares: Number(agg._sum.share_count || 0),
    };
  }

  async profileVideos(
    profileId: bigint,
    params: { page?: string; page_size?: string; sort?: string; q?: string; min_plays?: string },
  ): Promise<any | null> {
    const profile = await this.prisma.scraperTikTokProfile.findUnique({ where: { id: profileId } });
    if (!profile) return null;

    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 24)!));
    const sort = params.sort || 'date';
    const q = (params.q || '').trim();
    const minPlays = parseIntOrDefault(params.min_plays);

    const conditions: Prisma.Sql[] = [Prisma.sql`profile_id = ${profileId}`];
    if (minPlays !== undefined) conditions.push(Prisma.sql`play_count >= ${BigInt(minPlays)}`);
    if (q) conditions.push(Prisma.sql`(${unaccentLike(Prisma.sql`description`, q)} OR ${hashtagLike(Prisma.sql`hashtags`, q)})`);
    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    let orderCol: Prisma.Sql = Prisma.sql`date_posted`;
    if (sort === 'plays') orderCol = Prisma.sql`play_count`;
    else if (sort === 'likes') orderCol = Prisma.sql`digg_count`;

    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM scraper_tiktok_profile_videos ${whereClause}
    `;
    const totalNum = Number(total);
    const totalPages = totalNum > 0 ? Math.ceil(totalNum / pageSize) : 1;
    const offset = (pageNum - 1) * pageSize;

    const videos = await this.prisma.$queryRaw<TiktokProfileVideoRow[]>`
      SELECT video_id, shortcode, url, description, hashtags, cover_image, video_duration, region,
             post_type, play_count, digg_count, comment_count, share_count, favorites_count,
             music_title, music_author, date_posted
      FROM scraper_tiktok_profile_videos
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
        video_id: v.video_id,
        shortcode: v.shortcode,
        url: v.url,
        description: v.description,
        hashtags: v.hashtags,
        cover_image: v.cover_image || '',
        video_duration: v.video_duration,
        region: v.region,
        post_type: v.post_type,
        play_count: Number(v.play_count),
        digg_count: Number(v.digg_count),
        comment_count: Number(v.comment_count),
        share_count: Number(v.share_count),
        favorites_count: Number(v.favorites_count),
        music_title: v.music_title,
        music_author: v.music_author,
        date_posted: v.date_posted,
        profile: {
          id: Number(profile.id),
          username: profile.username,
          nickname: profile.nickname,
          avatar_url: profile.avatar_drive_url || profile.avatar_url || '',
        },
      })),
    };
  }
}
