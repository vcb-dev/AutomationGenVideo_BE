import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { unaccentMatch, unaccentIncludesHashtag } from '../../common/utils/unaccent.util';

function parseIntOrDefault(val: any, def?: number): number | undefined {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
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

    const all = await this.prisma.scraperInstagramProfile.findMany({ where });

    const filtered = search ? all.filter((p) => unaccentMatch(p.username, search)) : all;

    const total = filtered.length;
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
    const start = (pageNum - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);

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
        avatar_url: p.avatar_url || '',
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
      avatar_url: p.avatar_url || '',
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

    const where: any = { profile_id: profileId };
    if (minPlays !== undefined) where.play_count = { gte: BigInt(minPlays) };

    let orderBy: any = { date_posted: 'desc' };
    if (sort === 'plays') orderBy = { play_count: 'desc' };
    else if (sort === 'likes') orderBy = { likes_count: 'desc' };

    const all = await this.prisma.scraperInstagramReel.findMany({ where, orderBy });

    const filtered = q
      ? all.filter((r) => unaccentMatch(r.description, q) || unaccentIncludesHashtag(r.hashtags, q))
      : all;

    const total = filtered.length;
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
    const start = (pageNum - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);

    return {
      status: 'ok',
      count: total,
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
          avatar_url: profile.avatar_url || '',
        },
      })),
    };
  }
}
