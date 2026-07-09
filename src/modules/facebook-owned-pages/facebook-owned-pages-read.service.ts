import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { unaccentMatch } from '../../common/utils/unaccent.util';

function parseIntOrDefault(val: any, def?: number): number | undefined {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
}

// Port từ facebook_views.py::get_managed_pages/get_synced_videos (AI đã xóa) — chỉ đọc, không ghi.
@Injectable()
export class FacebookOwnedPagesReadService {
  constructor(private readonly prisma: PrismaService) {}

  async getManagedPages(params: {
    page?: string; page_size?: string; search?: string; status?: string;
    min_likes?: string; min_followers?: string;
  }) {
    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 20)!));
    const search = (params.search || '').trim();
    const filterStatus = (params.status || '').trim().toLowerCase();
    const minLikes = parseIntOrDefault(params.min_likes);
    const minFollowers = parseIntOrDefault(params.min_followers);

    const where: any = {};
    if (filterStatus === 'active') where.is_active = true;
    else if (filterStatus === 'inactive') where.is_active = false;
    if (minLikes !== undefined) where.likes_count = { gte: BigInt(minLikes) };
    if (minFollowers !== undefined) where.followers_count = { gte: BigInt(minFollowers) };

    const pages = await this.prisma.video_management_managedfacebookpage.findMany({
      where,
      include: { _count: { select: { owned_videos: true } } },
    });

    // Sort: -video_count, -last_scraped_at, name (khớp order_by gốc)
    pages.sort((a, b) => {
      const vc = b._count.owned_videos - a._count.owned_videos;
      if (vc !== 0) return vc;
      const at = a.last_scraped_at ? a.last_scraped_at.getTime() : -Infinity;
      const bt = b.last_scraped_at ? b.last_scraped_at.getTime() : -Infinity;
      if (bt !== at) return bt - at;
      return a.name.localeCompare(b.name);
    });

    const filtered = search ? pages.filter((p) => unaccentMatch(p.name, search)) : pages;

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
      pages: paginated.map((p) => ({
        page_id: p.page_id,
        name: p.name,
        username: p.username,
        category: p.category,
        avatar_url: p.avatar_url,
        followers_count: Number(p.followers_count),
        likes_count: Number(p.likes_count),
        is_active: p.is_active,
        is_scraping: p.is_scraping,
        is_backfilled: p.is_backfilled,
        last_synced_at: p.last_synced_at,
        last_scraped_at: p.last_scraped_at,
        scrape_error: p.scrape_error,
        video_count: p._count.owned_videos,
        created_at: p.created_at,
        updated_at: p.updated_at,
      })),
    };
  }

  async getSyncedVideos(
    pageId: string,
    params: {
      page?: string; page_size?: string; search?: string; min_views?: string; min_likes?: string;
      hashtag_category?: string; date_from?: string; date_to?: string;
    },
  ) {
    const pageObj = await this.prisma.video_management_managedfacebookpage.findUnique({ where: { page_id: pageId } });
    if (!pageObj) throw new NotFoundException();

    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 20)!));
    const search = (params.search || '').trim();
    const minViews = parseIntOrDefault(params.min_views, 10000);
    const minLikes = parseIntOrDefault(params.min_likes);
    const hashtagCat = (params.hashtag_category || '').trim().toLowerCase();
    const dateFrom = (params.date_from || '').trim();
    const dateTo = (params.date_to || '').trim();

    const where: any = { managed_page_id: pageObj.id };
    if (minViews !== undefined) where.view_count = { gte: BigInt(minViews) };
    if (minLikes !== undefined) where.like_count = { gte: minLikes };
    if (hashtagCat) where.caption = { contains: `#${hashtagCat}`, mode: 'insensitive' };
    if (dateFrom || dateTo) {
      where.published_at = {};
      if (dateFrom) where.published_at.gte = new Date(`${dateFrom}T00:00:00.000Z`);
      if (dateTo) where.published_at.lte = new Date(`${dateTo}T23:59:59.999Z`);
    }

    const all = await this.prisma.video_management_ownedvideocontent.findMany({
      where,
      orderBy: { view_count: 'desc' },
    });

    const filtered = search ? all.filter((v) => unaccentMatch(v.caption || '', search)) : all;

    const total = filtered.length;
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
    const start = (pageNum - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);

    return {
      status: 'ok',
      page_info: {
        page_id: pageObj.page_id,
        name: pageObj.name,
        username: pageObj.username,
        avatar_url: pageObj.avatar_url,
        category: pageObj.category,
        followers_count: Number(pageObj.followers_count),
        likes_count: Number(pageObj.likes_count),
        is_scraping: pageObj.is_scraping,
        last_scraped_at: pageObj.last_scraped_at,
      },
      count: total,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      videos: paginated.map((v) => ({
        post_id: v.post_id,
        caption: v.caption,
        published_at: v.published_at,
        permalink_url: v.permalink_url,
        thumbnail_url: v.thumbnail_url,
        video_url: v.video_url,
        view_count: Number(v.view_count),
        like_count: v.like_count,
        comment_count: v.comment_count,
        share_count: v.share_count,
        reach_count: v.reach_count,
        link_clicks: v.link_clicks,
        last_updated_at: v.last_updated_at,
      })),
    };
  }
}
