import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { unaccentMatch, unaccentIncludesHashtag } from '../../common/utils/unaccent.util';

function parseIntOrDefault(val: any, def?: number): number | undefined {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
}

// Port từ scraper_views.py::tiktok_videos/tiktok_keyword_suggest/tiktok_profiles_list/
// tiktok_profile_detail/tiktok_profile_videos (AI đã xóa) — chỉ đọc, không ghi.
@Injectable()
export class TiktokScraperReadService {
  constructor(private readonly prisma: PrismaService) {}

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

    const where: any = {};
    if (minPlays !== undefined) where.play_count = { gte: BigInt(minPlays) };
    if (dateFrom || dateTo) {
      where.date_posted = {};
      if (dateFrom) where.date_posted.gte = new Date(`${dateFrom}T00:00:00.000Z`);
      if (dateTo) where.date_posted.lte = new Date(`${dateTo}T23:59:59.999Z`);
    }
    if (kwFilter) where.search_keyword = { contains: kwFilter, mode: 'insensitive' };
    if (q) where.OR = [
      { description: { contains: q, mode: 'insensitive' } },
      { search_keyword: { contains: q, mode: 'insensitive' } },
    ];

    let orderBy: any = { created_at: 'desc' };
    if (sort === 'plays') orderBy = { play_count: 'desc' };
    else if (sort === 'likes') orderBy = { digg_count: 'desc' };
    else if (sort === 'date') orderBy = { date_posted: 'desc' };

    const [total, paginated] = await Promise.all([
      this.prisma.scraperTikTokVideo.count({ where }),
      this.prisma.scraperTikTokVideo.findMany({ where, orderBy, skip: (pageNum - 1) * pageSize, take: pageSize }),
    ]);
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;

    return {
      status: 'ok',
      count: total,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      videos: paginated.map((v) => ({
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
    const groups = await this.prisma.scraperTikTokVideo.groupBy({
      by: ['search_keyword'],
      where: { NOT: { search_keyword: '' } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    const rows = groups.map((g) => ({ keyword: g.search_keyword, count: g._count.id }));
    const results = q ? rows.filter((r) => unaccentMatch(r.keyword, q)).slice(0, 10) : rows.slice(0, 10);

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
    const orderBy = [{ is_bookmarked: 'desc' as const }, secondaryOrderBy];

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
        avatar_url: p.avatar_url || '',
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
      avatar_url: p.avatar_url || '',
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

    const where: any = { profile_id: profileId };
    if (minPlays !== undefined) where.play_count = { gte: BigInt(minPlays) };

    let orderBy: any = { date_posted: 'desc' };
    if (sort === 'plays') orderBy = { play_count: 'desc' };
    else if (sort === 'likes') orderBy = { digg_count: 'desc' };

    const all = await this.prisma.scraperTikTokProfileVideo.findMany({ where, orderBy });

    const filtered = q
      ? all.filter((v) => unaccentMatch(v.description, q) || unaccentIncludesHashtag(v.hashtags, q))
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
      videos: paginated.map((v) => ({
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
          avatar_url: profile.avatar_url || '',
        },
      })),
    };
  }
}
