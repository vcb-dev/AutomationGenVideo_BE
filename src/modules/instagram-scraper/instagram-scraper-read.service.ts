import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

function parseIntOrDefault(val: any, def?: number): number | undefined {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
}

// search dùng immutable_unaccent() qua GIN trigram index (scraper_instagram_reels_description_trgm)
function unaccentLike(col: Prisma.Sql, q: string): Prisma.Sql {
  return Prisma.sql`lower(immutable_unaccent(${col})) LIKE '%' || lower(immutable_unaccent(${q})) || '%'`;
}

// Khớp unaccentIncludesHashtag() cũ — hashtags KHÔNG unaccent, chỉ lowercase.
function hashtagLike(hashtagsCol: Prisma.Sql, q: string): Prisma.Sql {
  const hq = q.replace(/^#/, '');
  return Prisma.sql`EXISTS (SELECT 1 FROM unnest(${hashtagsCol}) h WHERE lower(h) LIKE '%' || lower(${hq}) || '%')`;
}

interface InstagramReelRow {
  post_id: string; shortcode: string; url: string; description: string; hashtags: string[];
  thumbnail_url: string | null; thumbnail_drive_url: string | null; duration_seconds: number | null;
  is_paid_partnership: boolean; play_count: bigint; likes_count: bigint; comments_count: bigint;
  date_posted: Date; profile_id: bigint;
}

// Port từ scraper_views.py::instagram_profiles_list/instagram_profile_detail/
// instagram_profile_reels (AI đã xóa) — chỉ đọc, không ghi.
@Injectable()
export class InstagramScraperReadService {
  constructor(private readonly prisma: PrismaService) {}

  async listProfiles(params: { page?: string; page_size?: string; search?: string; is_owned?: string }) {
    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 12)!));
    const search = (params.search || '').trim();
    const isOwnedParam = (params.is_owned || '').trim();

    const where: any = {};
    if (isOwnedParam === 'true') where.is_owned = true;
    else if (isOwnedParam === 'false') where.is_owned = false;
    if (search) where.OR = [
      { username: { contains: search, mode: 'insensitive' } },
      { full_name: { contains: search, mode: 'insensitive' } },
    ];

    const [total, paginated] = await Promise.all([
      this.prisma.scraperInstagramProfile.count({ where }),
      this.prisma.scraperInstagramProfile.findMany({
        where,
        orderBy: [{ is_bookmarked: 'desc' }, { followers_count: 'desc' }],
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;

    const reelCounts = paginated.length
      ? await this.prisma.scraperInstagramReel.groupBy({
          by: ['profile_id'],
          where: { profile_id: { in: paginated.map((p) => p.id) } },
          _count: { id: true },
        })
      : [];
    const countMap = new Map(reelCounts.map((r) => [r.profile_id.toString(), r._count.id]));

    return {
      status: 'ok',
      count: total,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      profiles: paginated.map((p) => ({
        id: Number(p.id),
        username: p.username,
        url: p.url,
        avatar_url: p.avatar_drive_url || p.avatar_url || '',
        is_verified: p.is_verified,
        followers_count: Number(p.followers_count),
        following_count: Number(p.following_count),
        posts_count: p.posts_count,
        is_tracked: p.is_tracked,
        is_bookmarked: p.is_bookmarked,
        is_owned: p.is_owned,
        is_initial_scraped: p.is_initial_scraped,
        scraping_status: p.scraping_status,
        scrape_error: p.scrape_error,
        last_scraped_at: p.last_scraped_at,
        created_at: p.created_at,
        reels_in_db: countMap.get(p.id.toString()) || 0,
      })),
    };
  }

  async listReels(params: {
    page?: string; page_size?: string; q?: string;
    profile_id?: string; min_plays?: string;
    date_from?: string; date_to?: string; sort?: string;
  }) {
    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 24)!));
    const q = (params.q || '').trim();
    const minPlays = parseIntOrDefault(params.min_plays);
    const dateFrom = (params.date_from || '').trim();
    const dateTo = (params.date_to || '').trim();
    const sort = params.sort || 'date';
    const profileId = parseIntOrDefault(params.profile_id);

    const conditions: Prisma.Sql[] = [];
    if (profileId !== undefined) conditions.push(Prisma.sql`r.profile_id = ${BigInt(profileId)}`);
    if (minPlays !== undefined) conditions.push(Prisma.sql`r.play_count >= ${BigInt(minPlays)}`);
    if (dateFrom) conditions.push(Prisma.sql`r.date_posted >= ${new Date(`${dateFrom}T00:00:00.000Z`)}`);
    if (dateTo) conditions.push(Prisma.sql`r.date_posted <= ${new Date(`${dateTo}T23:59:59.999Z`)}`);
    if (q) conditions.push(unaccentLike(Prisma.sql`r.description`, q));
    const whereClause = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    let orderCol: Prisma.Sql = Prisma.sql`r.date_posted`;
    if (sort === 'plays') orderCol = Prisma.sql`r.play_count`;
    else if (sort === 'likes') orderCol = Prisma.sql`r.likes_count`;

    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM scraper_instagram_reels r ${whereClause}
    `;
    const totalNum = Number(total);
    const totalPages = totalNum > 0 ? Math.ceil(totalNum / pageSize) : 1;
    const offset = (pageNum - 1) * pageSize;

    const reels = await this.prisma.$queryRaw<(InstagramReelRow & { profile_username: string; profile_avatar_url: string | null; profile_avatar_drive_url: string | null })[]>`
      SELECT r.post_id, r.shortcode, r.url, r.description, r.hashtags, r.thumbnail_url, r.thumbnail_drive_url,
             r.duration_seconds, r.is_paid_partnership, r.play_count, r.likes_count, r.comments_count,
             r.date_posted, r.profile_id, p.username AS profile_username, p.avatar_url AS profile_avatar_url,
             p.avatar_drive_url AS profile_avatar_drive_url
      FROM scraper_instagram_reels r
      JOIN scraper_instagram_profiles p ON p.id = r.profile_id
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
      reels: reels.map((r) => ({
        post_id: r.post_id,
        shortcode: r.shortcode,
        url: r.url,
        description: r.description,
        hashtags: r.hashtags,
        thumbnail_url: r.thumbnail_drive_url || r.thumbnail_url || '',
        duration_seconds: r.duration_seconds,
        is_paid_partnership: r.is_paid_partnership,
        play_count: Number(r.play_count),
        likes_count: Number(r.likes_count),
        comments_count: Number(r.comments_count),
        date_posted: r.date_posted,
        profile: {
          id: Number(r.profile_id),
          username: r.profile_username,
          avatar_url: r.profile_avatar_drive_url || r.profile_avatar_url || '',
        },
      })),
    };
  }

  async profileDetail(profileId: bigint): Promise<any | null> {
    const p = await this.prisma.scraperInstagramProfile.findUnique({ where: { id: profileId } });
    if (!p) return null;

    const agg = await this.prisma.scraperInstagramReel.aggregate({
      where: { profile_id: profileId },
      _sum: { play_count: true, likes_count: true, comments_count: true },
      _count: { id: true },
    });

    return {
      id: Number(p.id),
      username: p.username,
      url: p.url,
      avatar_url: p.avatar_drive_url || p.avatar_url || '',
      is_verified: p.is_verified,
      followers_count: Number(p.followers_count),
      following_count: Number(p.following_count),
      posts_count: p.posts_count,
      is_tracked: p.is_tracked,
      is_bookmarked: p.is_bookmarked,
      is_initial_scraped: p.is_initial_scraped,
      scraping_status: p.scraping_status,
      scrape_error: p.scrape_error,
      last_scraped_at: p.last_scraped_at,
      created_at: p.created_at,
      reels_in_db: agg._count.id,
      total_plays: Number(agg._sum.play_count || 0),
      total_likes: Number(agg._sum.likes_count || 0),
      total_comments: Number(agg._sum.comments_count || 0),
    };
  }

  async profileReels(
    profileId: bigint,
    params: { page?: string; page_size?: string; sort?: string; q?: string; min_plays?: string },
  ): Promise<any | null> {
    const profile = await this.prisma.scraperInstagramProfile.findUnique({ where: { id: profileId } });
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
    else if (sort === 'likes') orderCol = Prisma.sql`likes_count`;

    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM scraper_instagram_reels ${whereClause}
    `;
    const totalNum = Number(total);
    const totalPages = totalNum > 0 ? Math.ceil(totalNum / pageSize) : 1;
    const offset = (pageNum - 1) * pageSize;

    const paginated = await this.prisma.$queryRaw<InstagramReelRow[]>`
      SELECT post_id, shortcode, url, description, hashtags, thumbnail_url, thumbnail_drive_url,
             duration_seconds, is_paid_partnership, play_count, likes_count, comments_count, date_posted, profile_id
      FROM scraper_instagram_reels
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
      reels: paginated.map((r) => ({
        post_id: r.post_id,
        shortcode: r.shortcode,
        url: r.url,
        description: r.description,
        hashtags: r.hashtags,
        thumbnail_url: r.thumbnail_drive_url || r.thumbnail_url || '',
        duration_seconds: r.duration_seconds,
        is_paid_partnership: r.is_paid_partnership,
        play_count: Number(r.play_count),
        likes_count: Number(r.likes_count),
        comments_count: Number(r.comments_count),
        date_posted: r.date_posted,
        profile: {
          id: Number(profile.id),
          username: profile.username,
          avatar_url: profile.avatar_drive_url || profile.avatar_url || '',
        },
      })),
    };
  }
}
