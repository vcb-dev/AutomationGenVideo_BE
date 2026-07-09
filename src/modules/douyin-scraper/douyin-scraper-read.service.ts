import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { unaccentMatch, unaccentIncludesHashtag } from '../../common/utils/unaccent.util';

function parseIntOrDefault(val: any, def?: number): number | undefined {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
}

// Port từ scraper_views.py::douyin_videos_list/douyin_keyword_suggest/douyin_profiles_list/
// douyin_profile_detail/douyin_profile_videos (AI đã xóa) — chỉ đọc, không ghi.
@Injectable()
export class DouyinScraperReadService {
  constructor(private readonly prisma: PrismaService) {}

  async listVideos(params: {
    page?: string; page_size?: string; q?: string; min_digg?: string;
    date_from?: string; date_to?: string; sort?: string; search_keyword?: string;
  }) {
    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 24)!));
    const q = (params.q || '').trim();
    const minDigg = parseIntOrDefault(params.min_digg);
    const dateFrom = (params.date_from || '').trim();
    const dateTo = (params.date_to || '').trim();
    const sort = params.sort || 'scraped';
    const kwFilter = (params.search_keyword || '').trim();

    const where: any = {};
    if (minDigg !== undefined) where.digg_count = { gte: BigInt(minDigg) };
    if (dateFrom || dateTo) {
      where.date_posted = {};
      if (dateFrom) where.date_posted.gte = new Date(`${dateFrom}T00:00:00.000Z`);
      if (dateTo) where.date_posted.lte = new Date(`${dateTo}T23:59:59.999Z`);
    }
    if (kwFilter) where.search_keyword = { contains: kwFilter, mode: 'insensitive' };

    let orderBy: any = { created_at: 'desc' };
    if (sort === 'likes') orderBy = { digg_count: 'desc' };
    else if (sort === 'date') orderBy = { date_posted: 'desc' };

    const all = await this.prisma.scraperDouyinVideo.findMany({ where, orderBy });

    const filtered = q
      ? all.filter(
          (v) =>
            unaccentMatch(v.description, q) ||
            unaccentMatch(v.search_keyword, q) ||
            unaccentIncludesHashtag(v.hashtags, q),
        )
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
        post_id: v.post_id,
        url: v.url,
        description: v.description,
        hashtags: v.hashtags,
        preview_image: v.preview_image,
        video_duration: v.video_duration,
        region: v.region,
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
          followers: Number(v.author_followers),
          is_verified: v.author_is_verified,
        },
      })),
    };
  }

  async keywordSuggest(q: string) {
    const groups = await this.prisma.scraperDouyinVideo.groupBy({
      by: ['search_keyword'],
      where: { NOT: { search_keyword: '' } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 50,
    });

    const rows = groups.map((g) => ({ keyword: g.search_keyword, count: g._count.id }));
    const results = q ? rows.filter((r) => unaccentMatch(r.keyword, q)).slice(0, 10) : rows.slice(0, 10);

    return { suggestions: results };
  }

  private serializeProfile(p: any, videosInDb: number) {
    return {
      id: Number(p.id),
      sec_user_id: p.sec_user_id,
      uid: p.uid,
      username: p.username,
      nickname: p.nickname,
      avatar_url: p.avatar_url,
      biography: p.biography,
      is_verified: p.is_verified,
      followers_count: Number(p.followers_count),
      is_bookmarked: p.is_bookmarked,
      is_tracked: p.is_tracked,
      is_owned: p.is_owned,
      is_initial_scraped: p.is_initial_scraped,
      last_scraped_at: p.last_scraped_at,
      scraping_status: p.scraping_status,
      scrape_error: p.scrape_error,
      created_at: p.created_at,
      videos_in_db: videosInDb,
    };
  }

  async listProfiles(params: {
    page?: string; page_size?: string; search?: string; sort_by?: string; is_owned?: string;
  }) {
    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(50, Math.max(1, parseIntOrDefault(params.page_size, 12)!));
    const search = (params.search || '').trim();
    const sortBy = params.sort_by || 'followers';
    const isOwnedParam = (params.is_owned || '').trim();

    const where: any = {};
    if (search) {
      where.OR = [
        { username: { contains: search, mode: 'insensitive' } },
        { nickname: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (isOwnedParam === 'true') where.is_owned = true;
    else if (isOwnedParam === 'false') where.is_owned = false;

    const secondaryOrderBy = sortBy === 'recent' ? { created_at: 'desc' as const } : { followers_count: 'desc' as const };

    const total = await this.prisma.scraperDouyinProfile.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const offset = (pageNum - 1) * pageSize;

    const profiles = await this.prisma.scraperDouyinProfile.findMany({
      where,
      orderBy: [{ is_bookmarked: 'desc' }, secondaryOrderBy],
      skip: offset,
      take: pageSize,
    });

    const usernames = profiles.filter((p) => p.username).map((p) => `@${p.username}`);
    const counts = usernames.length
      ? await this.prisma.scraperDouyinVideo.groupBy({
          by: ['search_keyword'],
          where: { search_keyword: { in: usernames } },
          _count: { id: true },
        })
      : [];
    const countMap = new Map(counts.map((c) => [c.search_keyword, c._count.id]));

    return {
      status: 'ok',
      count: total,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      profiles: profiles.map((p) => this.serializeProfile(p, countMap.get(`@${p.username}`) || 0)),
    };
  }

  async profileDetail(pk: bigint): Promise<any | null> {
    const profile = await this.prisma.scraperDouyinProfile.findUnique({ where: { id: pk } });
    if (!profile) return null;

    const label = profile.username ? `@${profile.username}` : '';
    const agg = label
      ? await this.prisma.scraperDouyinVideo.aggregate({
          where: { search_keyword: label },
          _sum: { digg_count: true, comment_count: true, share_count: true, collect_count: true },
          _count: { id: true },
        })
      : null;

    const result = this.serializeProfile(profile, agg?._count.id || 0);
    return {
      ...result,
      total_diggs: Number(agg?._sum.digg_count || 0),
      total_comments: Number(agg?._sum.comment_count || 0),
      total_shares: Number(agg?._sum.share_count || 0),
      total_collects: Number(agg?._sum.collect_count || 0),
    };
  }

  async profileVideos(
    pk: bigint,
    params: { page?: string; page_size?: string; sort?: string; q?: string; min_digg?: string },
  ): Promise<any | null> {
    const profile = await this.prisma.scraperDouyinProfile.findUnique({ where: { id: pk } });
    if (!profile) return null;

    const label = profile.username ? `@${profile.username}` : '';
    if (!label) {
      return { videos: [], count: 0, page: 1, page_size: 24, total_pages: 0 };
    }

    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 24)!));
    const sort = params.sort || 'date';
    const q = (params.q || '').trim();
    const minDigg = parseIntOrDefault(params.min_digg);

    const where: any = { search_keyword: label };
    if (q) {
      where.OR = [
        { description: { contains: q, mode: 'insensitive' } },
        { hashtags: { has: q } },
      ];
    }
    if (minDigg !== undefined) where.digg_count = { gte: BigInt(minDigg) };

    const orderBy: any = sort === 'likes' ? { digg_count: 'desc' } : { date_posted: 'desc' };

    const total = await this.prisma.scraperDouyinVideo.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const offset = (pageNum - 1) * pageSize;

    const videos = await this.prisma.scraperDouyinVideo.findMany({ where, orderBy, skip: offset, take: pageSize });

    return {
      count: total,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      videos: videos.map((v) => ({
        post_id: v.post_id,
        url: v.url,
        description: v.description,
        hashtags: v.hashtags,
        preview_image: v.preview_image || '',
        video_duration: v.video_duration,
        region: v.region,
        digg_count: Number(v.digg_count),
        comment_count: Number(v.comment_count),
        share_count: Number(v.share_count),
        collect_count: Number(v.collect_count),
        music_title: v.music_title,
        date_posted: v.date_posted,
      })),
    };
  }
}
