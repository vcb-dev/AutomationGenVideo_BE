import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

function parseIntOrDefault(val: any, def?: number): number | undefined {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
}

const SORT_FIELDS: Record<string, any> = {
  likes: { liked_count: 'desc' },
  date: { date_posted: 'desc' },
  collects: { collected_count: 'desc' },
  comments: { comments_count: 'desc' },
  scraped: { created_at: 'desc' },
};

// Port từ xiaohongshu_search_views.py::list_xiaohongshu_videos/xiaohongshu_keyword_suggest/
// xhs_profiles_list/xhs_profile_detail/xhs_profile_videos (AI đã xóa) — chỉ đọc, không ghi.
// Lưu ý: các view này lọc q bằng SQL icontains (không unaccent), khác các nền tảng khác.
@Injectable()
export class XiaohongshuScraperReadService {
  constructor(private readonly prisma: PrismaService) {}

  private serializeVideo(v: any) {
    return {
      id: Number(v.id),
      note_id: v.note_id,
      url: v.url,
      title: v.title,
      description: v.description,
      thumbnail_url: v.thumbnail_drive_url || v.thumbnail_url || '',
      author_id: v.author_id,
      author_name: v.author_name,
      author_avatar: v.author_avatar || '',
      duration_seconds: v.duration_seconds,
      liked_count: Number(v.liked_count),
      collected_count: Number(v.collected_count),
      comments_count: Number(v.comments_count),
      shared_count: Number(v.shared_count),
      keywords: v.keywords,
      date_posted: v.date_posted,
    };
  }

  private async serializeProfile(p: any, includeVideoCount: boolean): Promise<any> {
    const dict: any = {
      id: Number(p.id),
      user_id: p.user_id,
      nickname: p.nickname,
      avatar_url: p.avatar_url || '',
      is_verified: p.is_verified,
      is_tracked: p.is_tracked,
      is_bookmarked: p.is_bookmarked,
      is_owned: p.is_owned,
      is_initial_scraped: p.is_initial_scraped,
      last_scraped_at: p.last_scraped_at,
      scraping_status: p.scraping_status,
      scrape_error: p.scrape_error,
      created_at: p.created_at,
    };
    if (includeVideoCount) {
      dict.videos_count = await this.prisma.scraperXiaohongshuVideo.count({ where: { profile_id: p.id } });
    }
    return dict;
  }

  async listVideos(params: {
    page?: string; page_size?: string; q?: string; sort?: string;
    min_likes?: string; date_from?: string; date_to?: string; keyword?: string;
  }) {
    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 24)!));
    const q = (params.q || '').trim();
    const orderBy = SORT_FIELDS[params.sort || 'scraped'] || SORT_FIELDS.scraped;
    const minLikes = parseIntOrDefault(params.min_likes);
    const dateFrom = (params.date_from || '').trim();
    const dateTo = (params.date_to || '').trim();
    const keywordFilter = (params.keyword || '').trim();

    const where: any = {};
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { author_name: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (keywordFilter) where.keywords = { has: keywordFilter };
    if (minLikes !== undefined) where.liked_count = { gte: BigInt(minLikes) };
    if (dateFrom || dateTo) {
      where.date_posted = {};
      if (dateFrom) where.date_posted.gte = new Date(`${dateFrom}T00:00:00.000Z`);
      if (dateTo) where.date_posted.lte = new Date(`${dateTo}T23:59:59.999Z`);
    }

    const total = await this.prisma.scraperXiaohongshuVideo.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (pageNum - 1) * pageSize;

    const videos = await this.prisma.scraperXiaohongshuVideo.findMany({ where, orderBy, skip: start, take: pageSize });

    return {
      status: 'ok',
      count: total,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      videos: videos.map((v) => this.serializeVideo(v)),
    };
  }

  async keywordSuggest(q: string): Promise<{ keyword: string; count: number }[]> {
    const rows = await this.prisma.scraperXiaohongshuVideo.findMany({ select: { keywords: true } });

    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const kw of row.keywords || []) {
        if (!q || kw.toLowerCase().includes(q.toLowerCase())) {
          counts.set(kw, (counts.get(kw) || 0) + 1);
        }
      }
    }

    return Array.from(counts.entries())
      .map(([keyword, count]) => ({ keyword, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
  }

  async listProfiles(params: {
    page?: string; page_size?: string; q?: string; bookmarked?: string; tracked?: string; is_owned?: string;
  }) {
    const q = (params.q || '').trim();
    const bookmarked = params.bookmarked || '';
    const tracked = params.tracked || '';
    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(50, Math.max(1, parseIntOrDefault(params.page_size, 20)!));
    const isOwnedParam = (params.is_owned || '').trim();

    const where: any = {};
    if (q) {
      where.OR = [
        { nickname: { contains: q, mode: 'insensitive' } },
        { user_id: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (bookmarked === 'true') where.is_bookmarked = true;
    if (tracked === 'true') where.is_tracked = true;
    if (isOwnedParam === 'true') where.is_owned = true;
    else if (isOwnedParam === 'false') where.is_owned = false;

    const total = await this.prisma.scraperXiaohongshuProfile.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (pageNum - 1) * pageSize;

    const profiles = await this.prisma.scraperXiaohongshuProfile.findMany({
      where,
      orderBy: [{ is_bookmarked: 'desc' }, { created_at: 'desc' }],
      skip: start,
      take: pageSize,
    });

    return {
      status: 'ok',
      count: total,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      profiles: await Promise.all(profiles.map((p) => this.serializeProfile(p, true))),
    };
  }

  async profileDetail(profileId: bigint): Promise<any | null> {
    const p = await this.prisma.scraperXiaohongshuProfile.findUnique({ where: { id: profileId } });
    if (!p) return null;
    return this.serializeProfile(p, true);
  }

  async profileVideos(
    profileId: bigint,
    params: { page?: string; page_size?: string; sort?: string; q?: string; min_likes?: string },
  ): Promise<any | null> {
    const profile = await this.prisma.scraperXiaohongshuProfile.findUnique({ where: { id: profileId } });
    if (!profile) return null;

    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 24)!));
    const orderBy = SORT_FIELDS[params.sort || 'likes'] || SORT_FIELDS.likes;
    const q = (params.q || '').trim();
    const minLikes = parseIntOrDefault(params.min_likes);

    const where: any = { profile_id: profileId };
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (minLikes !== undefined) where.liked_count = { gte: BigInt(minLikes) };

    const total = await this.prisma.scraperXiaohongshuVideo.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (pageNum - 1) * pageSize;

    const videos = await this.prisma.scraperXiaohongshuVideo.findMany({ where, orderBy, skip: start, take: pageSize });

    return {
      status: 'ok',
      count: total,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      profile: await this.serializeProfile(profile, false),
      videos: videos.map((v) => this.serializeVideo(v)),
    };
  }
}
