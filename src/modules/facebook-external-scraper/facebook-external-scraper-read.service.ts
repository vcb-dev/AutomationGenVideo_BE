import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { unaccentMatch } from '../../common/utils/unaccent.util';

function parseIntOrDefault(val: any, def?: number): number | undefined {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
}

// Khớp Django ArrayField `hashtags__icontains` cũ: Postgres cast array sang text
// dạng '{tag1,tag2}' rồi LIKE case-insensitive trên chuỗi đó (không phải so khớp
// từng phần tử) — quirk cố ý giữ nguyên, không phải bug mới.
function arrayTextIncludes(items: string[], substr: string): boolean {
  return `{${(items || []).join(',')}}`.toLowerCase().includes(substr.toLowerCase());
}

// Port từ scraper_views.py::discovered_fanpages/fanpage_detail/search_reels
// (AI đã xóa) — chỉ đọc, không ghi.
@Injectable()
export class FacebookExternalScraperReadService {
  constructor(private readonly prisma: PrismaService) {}

  private serializeFanpage(p: any, reelsCount: number) {
    return {
      id: Number(p.id),
      profile_id: p.profile_id,
      name: p.name,
      handle: p.handle,
      page_url: p.page_url,
      avatar_url: p.avatar_url,
      is_verified: p.is_verified,
      followers_count: Number(p.followers_count),
      likes_count: Number(p.likes_count),
      is_visible_on_ui: p.is_visible_on_ui,
      is_periodic_crawl: p.is_periodic_crawl,
      is_bookmarked: p.is_bookmarked,
      is_initial_scraped: p.is_initial_scraped,
      scraping_status: p.scraping_status,
      last_scraped_at: p.last_scraped_at,
      scrape_error: p.scrape_error,
      reels_count: reelsCount,
      created_at: p.created_at,
    };
  }

  async discoveredFanpages(params: {
    page?: string; page_size?: string; search?: string; bookmarked?: string; periodic?: string;
  }) {
    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(50, Math.max(1, parseIntOrDefault(params.page_size, 12)!));
    const search = (params.search || '').trim();
    const bookmarked = (params.bookmarked || '').trim();
    const periodic = (params.periodic || '').trim();

    const where: any = { is_visible_on_ui: true };
    if (bookmarked === 'true') where.is_bookmarked = true;
    if (periodic === 'true') where.is_periodic_crawl = true;

    const all = await this.prisma.scraperFanpage.findMany({
      where,
      orderBy: [{ is_bookmarked: 'desc' }, { followers_count: 'desc' }],
    });

    const filtered = search ? all.filter((p) => unaccentMatch(p.name, search)) : all;

    const total = filtered.length;
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
    const start = (pageNum - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);

    const reelCounts = paginated.length
      ? await this.prisma.scraperFacebookReel.groupBy({
          by: ['fanpage_id'],
          where: { fanpage_id: { in: paginated.map((p) => p.id) } },
          _count: { id: true },
        })
      : [];
    const countMap = new Map(reelCounts.map((r) => [r.fanpage_id.toString(), r._count.id]));

    return {
      status: 'ok',
      count: total,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      fanpages: paginated.map((p) => this.serializeFanpage(p, countMap.get(p.id.toString()) || 0)),
    };
  }

  async fanpageDetail(fanpageId: bigint): Promise<any | null> {
    const fp = await this.prisma.scraperFanpage.findUnique({ where: { id: fanpageId } });
    if (!fp) return null;

    const agg = await this.prisma.scraperFacebookReel.aggregate({
      where: { fanpage_id: fanpageId },
      _sum: { views_count: true, likes_count: true, comments_count: true, shares_count: true },
      _count: { id: true },
    });

    const data = this.serializeFanpage(fp, agg._count.id);
    return {
      ...data,
      total_views: Number(agg._sum.views_count || 0),
      total_likes: Number(agg._sum.likes_count || 0),
      total_comments: Number(agg._sum.comments_count || 0),
      total_shares: Number(agg._sum.shares_count || 0),
    };
  }

  async searchReels(params: {
    q?: string; page?: string; page_size?: string; min_views?: string; min_likes?: string;
    fanpage_id?: string; date_from?: string; date_to?: string; sort?: string;
  }) {
    const q = (params.q || '').trim();
    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 20)!));
    const minViews = parseIntOrDefault(params.min_views);
    const minLikes = parseIntOrDefault(params.min_likes);
    const fanpageId = parseIntOrDefault(params.fanpage_id);
    const dateFrom = (params.date_from || '').trim();
    const dateTo = (params.date_to || '').trim();
    const sortBy = params.sort || 'date';

    const where: any = {};
    if (fanpageId) where.fanpage_id = BigInt(fanpageId);
    if (minViews !== undefined) where.views_count = { gte: BigInt(minViews) };
    if (minLikes !== undefined) where.likes_count = { gte: BigInt(minLikes) };
    if (dateFrom || dateTo) {
      where.date_posted = {};
      if (dateFrom) where.date_posted.gte = new Date(`${dateFrom}T00:00:00.000Z`);
      if (dateTo) where.date_posted.lte = new Date(`${dateTo}T23:59:59.999Z`);
    }

    let orderBy: any = { date_posted: 'desc' };
    if (sortBy === 'views') orderBy = { views_count: 'desc' };
    else if (sortBy === 'likes') orderBy = { likes_count: 'desc' };

    const all = await this.prisma.scraperFacebookReel.findMany({ where, orderBy, include: { fanpage: true } });

    let filteredReels: typeof all;
    if (q) {
      const qLower = q.toLowerCase().replace(/^#/, '');
      const hashtagMatchIds = new Set(all.filter((r) => arrayTextIncludes(r.hashtags, qLower)).map((r) => r.id));
      const captionMatchIds = new Set(all.filter((r) => unaccentMatch(r.content, q)).map((r) => r.id));
      const allMatchIds = new Set<bigint>([...hashtagMatchIds, ...captionMatchIds]);
      filteredReels = allMatchIds.size > 0
        ? all.filter((r) => allMatchIds.has(r.id)).sort((a, b) => (b.views_count > a.views_count ? 1 : b.views_count < a.views_count ? -1 : 0))
        : [];
    } else {
      filteredReels = all;
    }

    const total = filteredReels.length;
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
    const start = (pageNum - 1) * pageSize;
    const paginated = filteredReels.slice(start, start + pageSize);

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
        content: r.content,
        hashtags: r.hashtags,
        video_url: r.video_url,
        thumbnail_url: r.thumbnail_url,
        duration_seconds: r.duration_seconds,
        has_audio: r.has_audio,
        date_posted: r.date_posted,
        views_count: Number(r.views_count),
        likes_count: Number(r.likes_count),
        comments_count: Number(r.comments_count),
        shares_count: Number(r.shares_count),
        fanpage: r.fanpage
          ? {
              id: Number(r.fanpage.id),
              name: r.fanpage.name,
              handle: r.fanpage.handle,
              avatar_url: r.fanpage.avatar_url,
            }
          : null,
      })),
    };
  }
}
