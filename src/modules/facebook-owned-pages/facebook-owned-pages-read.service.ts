import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

function parseIntOrDefault(val: any, def?: number): number | undefined {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
}

interface ManagedPageRow {
  page_id: string;
  name: string;
  username: string | null;
  category: string;
  avatar_url: string | null;
  avatar_drive_url: string | null;
  followers_count: bigint;
  likes_count: bigint;
  is_active: boolean;
  is_scraping: boolean;
  is_backfilled: boolean;
  last_synced_at: Date | null;
  last_scraped_at: Date | null;
  scrape_error: string | null;
  created_at: Date;
  updated_at: Date;
  video_count: bigint;
}

interface SyncedVideoRow {
  post_id: string;
  caption: string;
  published_at: Date;
  permalink_url: string | null;
  thumbnail_url: string | null;
  video_url: string | null;
  view_count: bigint;
  like_count: number;
  comment_count: number;
  share_count: number;
  reach_count: number;
  link_clicks: number;
  last_updated_at: Date;
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

    // Điều kiện WHERE dùng chung cho cả query lấy data lẫn query đếm total —
    // search dùng immutable_unaccent() (Phase 1) qua GIN trigram index
    // managed_facebook_page_name_trgm (Phase 2), thay vì kéo hết về rồi
    // filter bằng unaccentMatch() ở JS như trước.
    const conditions: Prisma.Sql[] = [];
    if (filterStatus === 'active') conditions.push(Prisma.sql`is_active = true`);
    else if (filterStatus === 'inactive') conditions.push(Prisma.sql`is_active = false`);
    if (minLikes !== undefined) conditions.push(Prisma.sql`likes_count >= ${BigInt(minLikes)}`);
    if (minFollowers !== undefined) conditions.push(Prisma.sql`followers_count >= ${BigInt(minFollowers)}`);
    if (search) {
      conditions.push(
        Prisma.sql`lower(immutable_unaccent(name)) LIKE '%' || lower(immutable_unaccent(${search})) || '%'`,
      );
    }
    const whereClause = conditions.length
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;

    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM video_management_managedfacebookpage ${whereClause}
    `;

    const offset = (pageNum - 1) * pageSize;
    // Sort: -video_count, -last_scraped_at, name (khớp order_by gốc) — video_count
    // là subquery đếm owned_videos, alias có thể dùng lại trong ORDER BY (Postgres).
    const pages = await this.prisma.$queryRaw<ManagedPageRow[]>`
      SELECT
        p.page_id, p.name, p.username, p.category, p.avatar_url, p.avatar_drive_url,
        p.followers_count, p.likes_count, p.is_active, p.is_scraping, p.is_backfilled,
        p.last_synced_at, p.last_scraped_at, p.scrape_error, p.created_at, p.updated_at,
        (SELECT COUNT(*) FROM video_management_ownedvideocontent ov WHERE ov.managed_page_id = p.id) AS video_count
      FROM video_management_managedfacebookpage p
      ${whereClause}
      ORDER BY video_count DESC, p.last_scraped_at DESC NULLS LAST, p.name ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const totalNum = Number(total);
    const totalPages = totalNum > 0 ? Math.ceil(totalNum / pageSize) : 1;

    return {
      status: 'ok',
      count: totalNum,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      pages: pages.map((p) => ({
        page_id: p.page_id,
        name: p.name,
        username: p.username,
        category: p.category,
        avatar_url: p.avatar_drive_url || p.avatar_url,
        followers_count: Number(p.followers_count),
        likes_count: Number(p.likes_count),
        is_active: p.is_active,
        is_scraping: p.is_scraping,
        is_backfilled: p.is_backfilled,
        last_synced_at: p.last_synced_at,
        last_scraped_at: p.last_scraped_at,
        scrape_error: p.scrape_error,
        video_count: Number(p.video_count),
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

    // Điều kiện WHERE dùng chung cho query data lẫn query đếm total — search
    // dùng immutable_unaccent() qua GIN trigram index
    // owned_video_content_caption_trgm (Phase 1+2), thay vì kéo hết video của
    // page về rồi filter bằng unaccentMatch() ở JS như trước.
    const conditions: Prisma.Sql[] = [Prisma.sql`managed_page_id = ${pageObj.id}`];
    if (minViews !== undefined) conditions.push(Prisma.sql`view_count >= ${BigInt(minViews)}`);
    if (minLikes !== undefined) conditions.push(Prisma.sql`like_count >= ${minLikes}`);
    if (hashtagCat) conditions.push(Prisma.sql`caption ILIKE ${'%#' + hashtagCat + '%'}`);
    if (dateFrom) conditions.push(Prisma.sql`published_at >= ${new Date(`${dateFrom}T00:00:00.000Z`)}`);
    if (dateTo) conditions.push(Prisma.sql`published_at <= ${new Date(`${dateTo}T23:59:59.999Z`)}`);
    if (search) {
      conditions.push(
        Prisma.sql`lower(immutable_unaccent(caption)) LIKE '%' || lower(immutable_unaccent(${search})) || '%'`,
      );
    }
    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM video_management_ownedvideocontent ${whereClause}
    `;

    const offset = (pageNum - 1) * pageSize;
    const videos = await this.prisma.$queryRaw<SyncedVideoRow[]>`
      SELECT post_id, caption, published_at, permalink_url, thumbnail_url, video_url,
             view_count, like_count, comment_count, share_count, reach_count, link_clicks, last_updated_at
      FROM video_management_ownedvideocontent
      ${whereClause}
      ORDER BY view_count DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const totalNum = Number(total);
    const totalPages = totalNum > 0 ? Math.ceil(totalNum / pageSize) : 1;

    return {
      status: 'ok',
      page_info: {
        page_id: pageObj.page_id,
        name: pageObj.name,
        username: pageObj.username,
        avatar_url: pageObj.avatar_drive_url || pageObj.avatar_url,
        category: pageObj.category,
        followers_count: Number(pageObj.followers_count),
        likes_count: Number(pageObj.likes_count),
        is_scraping: pageObj.is_scraping,
        last_scraped_at: pageObj.last_scraped_at,
      },
      count: totalNum,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      videos: videos.map((v) => ({
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
