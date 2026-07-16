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

// Khớp Django ArrayField `hashtags__icontains` cũ: Postgres cast array sang text
// dạng '{tag1,tag2}' rồi LIKE case-insensitive trên chuỗi đó (không phải so khớp
// từng phần tử) — quirk cố ý giữ nguyên, không phải bug mới. hashtags::text
// trong Postgres cho ra đúng định dạng '{tag1,tag2}' này.
function arrayTextIncludes(col: Prisma.Sql, substr: string): Prisma.Sql {
  return Prisma.sql`lower(${col}::text) LIKE '%' || lower(${substr}) || '%'`;
}

interface FacebookReelRow {
  post_id: string; shortcode: string; url: string; content: string; hashtags: string[];
  video_url: string | null; thumbnail_url: string | null; duration_seconds: number | null;
  has_audio: boolean; date_posted: Date; views_count: bigint; likes_count: bigint;
  comments_count: bigint; shares_count: bigint; fanpage_id: bigint;
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
      avatar_url: p.avatar_drive_url || p.avatar_url,
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

    const conditions: Prisma.Sql[] = [Prisma.sql`is_visible_on_ui = true`];
    if (bookmarked === 'true') conditions.push(Prisma.sql`is_bookmarked = true`);
    if (periodic === 'true') conditions.push(Prisma.sql`is_periodic_crawl = true`);
    if (search) conditions.push(unaccentLike(Prisma.sql`name`, search));
    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM scraper_fanpages ${whereClause}
    `;
    const totalNum = Number(total);
    const totalPages = totalNum > 0 ? Math.ceil(totalNum / pageSize) : 1;
    const offset = (pageNum - 1) * pageSize;

    const paginated = await this.prisma.$queryRaw<{
      id: bigint; profile_id: string; name: string; handle: string; page_url: string; avatar_url: string | null;
      avatar_drive_url: string | null; is_verified: boolean | null; followers_count: bigint; likes_count: bigint;
      is_visible_on_ui: boolean; is_periodic_crawl: boolean; is_bookmarked: boolean; is_initial_scraped: boolean;
      scraping_status: string; last_scraped_at: Date | null; scrape_error: string | null; created_at: Date;
      reels_count: bigint;
    }[]>`
      SELECT p.id, p.profile_id, p.name, p.handle, p.page_url, p.avatar_url, p.avatar_drive_url, p.is_verified,
             p.followers_count, p.likes_count, p.is_visible_on_ui, p.is_periodic_crawl, p.is_bookmarked,
             p.is_initial_scraped, p.scraping_status, p.last_scraped_at, p.scrape_error, p.created_at,
             (SELECT COUNT(*) FROM scraper_facebook_reels r WHERE r.fanpage_id = p.id) AS reels_count
      FROM scraper_fanpages p
      ${whereClause}
      ORDER BY p.is_bookmarked DESC, p.followers_count DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    return {
      status: 'ok',
      count: totalNum,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      fanpages: paginated.map((p) => this.serializeFanpage(p, Number(p.reels_count))),
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

    const conditions: Prisma.Sql[] = [];
    if (fanpageId) conditions.push(Prisma.sql`r.fanpage_id = ${BigInt(fanpageId)}`);
    if (minViews !== undefined) conditions.push(Prisma.sql`r.views_count >= ${BigInt(minViews)}`);
    if (minLikes !== undefined) conditions.push(Prisma.sql`r.likes_count >= ${BigInt(minLikes)}`);
    if (dateFrom) conditions.push(Prisma.sql`r.date_posted >= ${new Date(`${dateFrom}T00:00:00.000Z`)}`);
    if (dateTo) conditions.push(Prisma.sql`r.date_posted <= ${new Date(`${dateTo}T23:59:59.999Z`)}`);
    if (q) {
      const qLower = q.replace(/^#/, '');
      conditions.push(Prisma.sql`(${arrayTextIncludes(Prisma.sql`r.hashtags`, qLower)} OR ${unaccentLike(Prisma.sql`r.content`, q)})`);
    }
    const whereClause = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    // Khớp hành vi cũ: khi có q, LUÔN sort theo views_count DESC bất kể sortBy
    // (ưu tiên hiển thị video hot nhất trong kết quả search) — chỉ tôn trọng
    // sortBy khi không search.
    let orderCol: Prisma.Sql = Prisma.sql`r.date_posted`;
    if (sortBy === 'views') orderCol = Prisma.sql`r.views_count`;
    else if (sortBy === 'likes') orderCol = Prisma.sql`r.likes_count`;
    if (q) orderCol = Prisma.sql`r.views_count`;

    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM scraper_facebook_reels r ${whereClause}
    `;
    const totalNum = Number(total);
    const totalPages = totalNum > 0 ? Math.ceil(totalNum / pageSize) : 1;
    const offset = (pageNum - 1) * pageSize;

    const paginated = await this.prisma.$queryRaw<(FacebookReelRow & { fanpage_name: string | null; fanpage_handle: string | null; fanpage_avatar_url: string | null; fanpage_avatar_drive_url: string | null })[]>`
      SELECT r.post_id, r.shortcode, r.url, r.content, r.hashtags, r.video_url, r.thumbnail_url,
             r.duration_seconds, r.has_audio, r.date_posted, r.views_count, r.likes_count,
             r.comments_count, r.shares_count, r.fanpage_id,
             f.name AS fanpage_name, f.handle AS fanpage_handle, f.avatar_url AS fanpage_avatar_url,
             f.avatar_drive_url AS fanpage_avatar_drive_url
      FROM scraper_facebook_reels r
      LEFT JOIN scraper_fanpages f ON f.id = r.fanpage_id
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
        fanpage: r.fanpage_id
          ? {
              id: Number(r.fanpage_id),
              name: r.fanpage_name,
              handle: r.fanpage_handle,
              avatar_url: r.fanpage_avatar_drive_url || r.fanpage_avatar_url,
            }
          : null,
      })),
    };
  }
}
