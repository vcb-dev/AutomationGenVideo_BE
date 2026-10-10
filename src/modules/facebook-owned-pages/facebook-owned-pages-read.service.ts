import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { vietnamDayRangeOf } from '../../utils/date.utils';
import { longDigitRun } from '../../utils/task-auto/task-video-match.util';
import { contentLineFilter } from '../scraper-aggregate/content-filters';
import { buildPageChannelMap, PageChannelRef } from './page-channel-resolver';

function parseIntOrDefault(val: any, def?: number): number | undefined {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
}

export interface VideoFilterParams {
  search?: string;
  min_views?: string;
  min_likes?: string;
  hashtag_category?: string;
  date_from?: string;
  date_to?: string;
}

/**
 * Bộ lọc video dùng chung cho màn "Xem video" của 1 page và tab "Video đã đăng" (mọi page).
 * Search dùng immutable_unaccent() qua GIN trigram index owned_video_content_caption_trgm
 * (Phase 1+2), thay vì kéo hết video về rồi filter bằng unaccentMatch() ở JS như trước.
 */
export function videoFilterConditions(params: VideoFilterParams): Prisma.Sql[] {
  const search = (params.search || '').trim();
  // Không mặc định ngưỡng: ô "Min views" trống thì FE không gửi param này.
  const minViews = parseIntOrDefault(params.min_views);
  const minLikes = parseIntOrDefault(params.min_likes);
  const hashtagCat = (params.hashtag_category || '').trim().toLowerCase();
  const dateFrom = (params.date_from || '').trim();
  const dateTo = (params.date_to || '').trim();

  const conditions: Prisma.Sql[] = [];
  if (minViews !== undefined) conditions.push(Prisma.sql`view_count >= ${BigInt(minViews)}`);
  if (minLikes !== undefined) conditions.push(Prisma.sql`like_count >= ${minLikes}`);
  if (hashtagCat) conditions.push(Prisma.sql`caption ILIKE ${'%#' + hashtagCat + '%'}`);
  const fromRange = dateFrom ? vietnamDayRangeOf(dateFrom) : null;
  const toRange = dateTo ? vietnamDayRangeOf(dateTo) : null;
  if (fromRange) conditions.push(Prisma.sql`published_at >= ${fromRange.gte}`);
  if (toRange) conditions.push(Prisma.sql`published_at < ${toRange.lt}`);
  if (search) {
    conditions.push(Prisma.sql`lower(immutable_unaccent(caption)) LIKE '%' || lower(immutable_unaccent(${search})) || '%'`);
  }
  return conditions;
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
  managed_page_id?: bigint;
  post_id: string;
  caption: string;
  published_at: Date;
  permalink_url: string | null;
  thumbnail_url: string | null;
  thumbnail_drive_url: string | null;
  video_url: string | null;
  view_count: bigint;
  like_count: number;
  comment_count: number;
  share_count: number;
  reach_count: number;
  link_clicks: number;
  last_updated_at: Date;
}

export interface OwnerVideo {
  post_id: string;
  caption: string;
  published_at: Date;
  permalink_url: string | null;
  view_count: number;
  page_name: string;
}

export interface OwnerVideos {
  page_count: number;
  total: number;
  total_views: number;
  videos: OwnerVideo[];
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

    const conditions: Prisma.Sql[] = [Prisma.sql`managed_page_id = ${pageObj.id}`, ...videoFilterConditions(params)];
    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM video_management_ownedvideocontent ${whereClause}
    `;

    const offset = (pageNum - 1) * pageSize;
    const videos = await this.prisma.$queryRaw<SyncedVideoRow[]>`
      SELECT post_id, caption, published_at, permalink_url, thumbnail_url, thumbnail_drive_url, video_url,
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
      videos: videos.map(toVideoDto),
    };
  }

  /**
   * Tab "Video đã đăng": video của mọi page nội bộ, lọc thêm team / người cầm kênh (suy từ
   * huyk_channels qua buildPageChannelMap). team_id nhận nhiều id phân cách dấu phẩy.
   */
  async getAllVideos(params: VideoFilterParams & { page?: string; page_size?: string; team_id?: string; owner_id?: string; sort?: string }) {
    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 20)!));
    const teamIds = (params.team_id || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const ownerId = (params.owner_id || '').trim();

    const { pages, refByPageId, teamNames, ownerNames } = await this.loadPageChannels();
    const channelOf = (pageId: string) => {
      const ref = refByPageId.get(pageId);
      if (!ref) return null;
      return {
        team_id: ref.teamId,
        team_name: ref.teamId ? (teamNames.get(ref.teamId) ?? null) : null,
        owner_id: ref.ownerId,
        owner_name: ref.ownerId ? (ownerNames.get(ref.ownerId) ?? null) : null,
      };
    };

    const conditions = videoFilterConditions(params);
    if (teamIds.length || ownerId) {
      const allowed = pagesInScope(pages, refByPageId, teamIds, ownerId);
      if (!allowed.length) {
        return { status: 'ok', count: 0, page: pageNum, page_size: pageSize, total_pages: 1, videos: [] };
      }
      conditions.push(Prisma.sql`managed_page_id IN (${Prisma.join(allowed.map((p) => p.id))})`);
    }
    const whereClause = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
    const orderBy = params.sort === 'views' ? Prisma.sql`ORDER BY view_count DESC, published_at DESC` : Prisma.sql`ORDER BY published_at DESC`;

    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM video_management_ownedvideocontent ${whereClause}
    `;

    const offset = (pageNum - 1) * pageSize;
    const videos = await this.prisma.$queryRaw<SyncedVideoRow[]>`
      SELECT managed_page_id, post_id, caption, published_at, permalink_url, thumbnail_url, thumbnail_drive_url,
             video_url, view_count, like_count, comment_count, share_count, reach_count, link_clicks, last_updated_at
      FROM video_management_ownedvideocontent
      ${whereClause}
      ${orderBy}
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const pageById = new Map(pages.map((p) => [p.id.toString(), p]));
    const linkedTasks = await this.findLinkedTasks(videos.map((v) => v.permalink_url));
    const totalNum = Number(total);
    return {
      status: 'ok',
      count: totalNum,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalNum > 0 ? Math.ceil(totalNum / pageSize) : 1,
      videos: videos.map((v) => {
        const pg = v.managed_page_id != null ? pageById.get(v.managed_page_id.toString()) : undefined;
        return {
          ...toVideoDto(v),
          page: pg ? { page_id: pg.page_id, name: pg.name, avatar_url: pg.avatar_drive_url || pg.avatar_url } : null,
          channel: pg ? channelOf(pg.page_id) : null,
          linked_task_ids: linkedTasks(v.permalink_url),
        };
      }),
    };
  }

  /**
   * Task nào đã gắn link của từng video. Link trong task có nhiều dạng nên khớp theo dãy số dài
   * nhất của permalink (giống TaskVideoMatchService.taskAlreadyHasVideo).
   */
  private async findLinkedTasks(permalinks: (string | null)[]): Promise<(permalink: string | null) => string[]> {
    const tokens = [...new Set(permalinks.map(longDigitRun).filter((t): t is string => !!t))];
    if (!tokens.length) return () => [];
    const rows = await this.prisma.$queryRaw<{ id: string; links: string }[]>`
      SELECT id, published_links::text AS links FROM tasks
      WHERE published_links::text LIKE ANY(${tokens.map((t) => `%${t}%`)}::text[])
    `;
    return (permalink) => {
      const token = longDigitRun(permalink);
      return token ? rows.filter((r) => r.links.includes(token)).map((r) => r.id) : [];
    };
  }

  /** Danh sách người cầm kênh có page Facebook nội bộ — nguồn cho ô lọc "Người cầm kênh". */
  async getVideoFilterOptions(scope: { teamIds?: string[]; ownerId?: string } = {}) {
    const loaded = await this.loadPageChannels();
    const { refByPageId, ownerNames } = loaded;
    const teamIds = scope.teamIds ?? [];
    const pages = teamIds.length || scope.ownerId ? pagesInScope(loaded.pages, refByPageId, teamIds, scope.ownerId) : loaded.pages;
    const owners = new Map<string, { id: string; full_name: string; team_ids: Set<string>; page_count: number }>();
    for (const p of pages) {
      const ref = refByPageId.get(p.page_id);
      if (!ref?.ownerId) continue;
      const o = owners.get(ref.ownerId) ?? { id: ref.ownerId, full_name: ownerNames.get(ref.ownerId) ?? '', team_ids: new Set<string>(), page_count: 0 };
      if (ref.teamId) o.team_ids.add(ref.teamId);
      o.page_count += 1;
      owners.set(ref.ownerId, o);
    }
    return {
      status: 'ok',
      total_pages: pages.length,
      unmatched_pages: pages.filter((p) => !refByPageId.has(p.page_id)).length,
      owners: [...owners.values()].map((o) => ({ ...o, team_ids: [...o.team_ids] })).sort((a, b) => a.full_name.localeCompare(b.full_name, 'vi')),
    };
  }

  /** Page thuộc phạm vi team/người cầm kênh — không lọc gì thì là mọi page. Dùng cho nút "Cập nhật". */
  async resolveScopePages(teamIds: string[], ownerId?: string) {
    const { pages, refByPageId } = await this.loadPageChannels();
    return teamIds.length || ownerId ? pagesInScope(pages, refByPageId, teamIds, ownerId) : pages;
  }

  /**
   * Video đã đăng trên các page mỗi người cầm — mục "Video đã đăng" trong file Excel xuất task.
   * `content_line` chỉ giữ video có hashtag tuyến đó trong caption. Mỗi người tối đa `limit_per_owner`
   * video mới nhất; `total`/`total_views` vẫn tính đủ.
   */
  async getVideosByOwner(
    ownerIds: string[],
    params: Pick<VideoFilterParams, 'date_from' | 'date_to'> & { team_ids?: string[]; content_line?: string; limit_per_owner: number },
  ): Promise<Map<string, OwnerVideos>> {
    const result = new Map<string, OwnerVideos>();
    const owners = new Set(ownerIds);
    if (!owners.size) return result;

    const { pages, refByPageId } = await this.loadPageChannels();
    const teamIds = params.team_ids ?? [];
    const ownerByPage = new Map<string, { ownerId: string; name: string }>();
    const pageIds: bigint[] = [];
    for (const p of pages) {
      const ref = refByPageId.get(p.page_id);
      if (!ref?.ownerId || !owners.has(ref.ownerId)) continue;
      if (teamIds.length && !(ref.teamId && teamIds.includes(ref.teamId))) continue;
      ownerByPage.set(p.id.toString(), { ownerId: ref.ownerId, name: p.name });
      pageIds.push(p.id);
      const agg = result.get(ref.ownerId) ?? { page_count: 0, total: 0, total_views: 0, videos: [] };
      agg.page_count += 1;
      result.set(ref.ownerId, agg);
    }
    if (!pageIds.length) return result;

    const conditions = [
      Prisma.sql`managed_page_id IN (${Prisma.join(pageIds)})`,
      ...videoFilterConditions({ date_from: params.date_from, date_to: params.date_to }),
    ];
    const lineCondition = params.content_line ? contentLineFilter(Prisma.sql`caption`, params.content_line) : null;
    if (lineCondition) conditions.push(lineCondition);
    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    // Top N mỗi PAGE là đủ: N video mới nhất của 1 người luôn nằm trong hợp các top N page của họ.
    const [totals, videos] = await Promise.all([
      this.prisma.$queryRaw<{ managed_page_id: bigint; total: bigint; views: bigint }[]>`
        SELECT managed_page_id, COUNT(*) AS total, COALESCE(SUM(view_count), 0)::bigint AS views
        FROM video_management_ownedvideocontent ${whereClause}
        GROUP BY managed_page_id
      `,
      this.prisma.$queryRaw<SyncedVideoRow[]>`
        SELECT managed_page_id, post_id, caption, published_at, permalink_url, view_count
        FROM (
          SELECT managed_page_id, post_id, caption, published_at, permalink_url, view_count,
                 ROW_NUMBER() OVER (PARTITION BY managed_page_id ORDER BY published_at DESC) AS rn
          FROM video_management_ownedvideocontent ${whereClause}
        ) ranked
        WHERE rn <= ${params.limit_per_owner}
      `,
    ]);

    for (const t of totals) {
      const page = ownerByPage.get(t.managed_page_id.toString());
      const agg = page && result.get(page.ownerId);
      if (!agg) continue;
      agg.total += Number(t.total);
      agg.total_views += Number(t.views);
    }
    for (const v of videos) {
      const page = v.managed_page_id != null ? ownerByPage.get(v.managed_page_id.toString()) : undefined;
      const agg = page && result.get(page.ownerId);
      if (!agg) continue;
      agg.videos.push({
        post_id: v.post_id,
        caption: v.caption,
        published_at: v.published_at,
        permalink_url: v.permalink_url,
        view_count: Number(v.view_count),
        page_name: page.name,
      });
    }
    for (const agg of result.values()) {
      agg.videos.sort((a, b) => b.published_at.getTime() - a.published_at.getTime());
      agg.videos.splice(params.limit_per_owner);
    }
    return result;
  }

  private async loadPageChannels() {
    const [pages, channels] = await Promise.all([
      this.prisma.video_management_managedfacebookpage.findMany({
        // is_active/is_scraping/page_access_token chỉ dùng nội bộ cho nút "Cập nhật" — getAllVideos
        // chỉ trả page_id/name/avatar ra ngoài.
        select: {
          id: true,
          page_id: true,
          name: true,
          username: true,
          avatar_url: true,
          avatar_drive_url: true,
          is_active: true,
          is_scraping: true,
          page_access_token: true,
        },
      }),
      this.prisma.channel.findMany({
        where: { OR: [{ team_id: { not: null } }, { owner_id: { not: null } }] },
        select: {
          platform: true,
          name: true,
          channel_id: true,
          link_channel: true,
          team_id: true,
          owner_id: true,
          channel_team: { select: { id: true, name: true } },
          channel_owner: { select: { id: true, full_name: true } },
        },
      }),
    ]);
    const teamNames = new Map<string, string>();
    const ownerNames = new Map<string, string>();
    for (const c of channels) {
      if (c.channel_team) teamNames.set(c.channel_team.id, c.channel_team.name);
      if (c.channel_owner) ownerNames.set(c.channel_owner.id, c.channel_owner.full_name);
    }
    return { pages, refByPageId: buildPageChannelMap(pages, channels), teamNames, ownerNames };
  }
}

/** Page ghép được kênh khớp team (1 trong teamIds) và/hoặc người cầm. Page chưa ghép kênh bị loại. */
function pagesInScope<P extends { page_id: string }>(pages: P[], refByPageId: Map<string, PageChannelRef>, teamIds: string[], ownerId?: string): P[] {
  return pages.filter((p) => {
    const ref = refByPageId.get(p.page_id);
    if (!ref) return false;
    if (teamIds.length && !(ref.teamId && teamIds.includes(ref.teamId))) return false;
    if (ownerId && ref.ownerId !== ownerId) return false;
    return true;
  });
}

function toVideoDto(v: SyncedVideoRow) {
  return {
    post_id: v.post_id,
    caption: v.caption,
    published_at: v.published_at,
    permalink_url: v.permalink_url,
    thumbnail_url: v.thumbnail_drive_url || v.thumbnail_url,
    video_url: v.video_url,
    view_count: Number(v.view_count),
    like_count: v.like_count,
    comment_count: v.comment_count,
    share_count: v.share_count,
    reach_count: v.reach_count,
    link_clicks: v.link_clicks,
    last_updated_at: v.last_updated_at,
  };
}
