import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { unaccentMatch, unaccentIncludesHashtag } from '../../common/utils/unaccent.util';

function parseIntOrDefault(val: any, def?: number): number | undefined {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
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
      avatar_url: p.avatar_url || '',
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

    const where: any = {};
    if (minViews !== undefined) where.view_count = { gte: BigInt(minViews) };
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
    if (sort === 'views') orderBy = { view_count: 'desc' };
    else if (sort === 'likes') orderBy = { like_count: 'desc' };
    else if (sort === 'comments') orderBy = { comment_count: 'desc' };
    else if (sort === 'date') orderBy = { date_posted: 'desc' };

    const [total, paginated] = await Promise.all([
      this.prisma.scraperKuaishouSearchVideo.count({ where }),
      this.prisma.scraperKuaishouSearchVideo.findMany({ where, orderBy, skip: (pageNum - 1) * pageSize, take: pageSize }),
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
          avatar_url: v.author_avatar,
          is_verified: v.author_is_verified,
        },
      })),
    };
  }

  async keywordSuggest(q: string) {
    const groups = await this.prisma.scraperKuaishouSearchVideo.groupBy({
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
    const orderBy = [{ is_bookmarked: 'desc' as const }, secondaryOrderBy];

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

    const where: any = { profile_id: profileId };
    if (minViews !== undefined) where.view_count = { gte: BigInt(minViews) };

    let orderBy: any = { created_at: 'desc' };
    if (sort === 'views') orderBy = { view_count: 'desc' };
    else if (sort === 'likes') orderBy = { like_count: 'desc' };
    else if (sort === 'comments') orderBy = { comment_count: 'desc' };
    else if (sort === 'date') orderBy = { date_posted: 'desc' };

    const all = await this.prisma.scraperKuaishouVideo.findMany({ where, orderBy });

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
      profile: this.serializeProfile(profile, all.length),
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
