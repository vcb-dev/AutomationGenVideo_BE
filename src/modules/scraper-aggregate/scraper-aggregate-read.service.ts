import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { marketFilter, contentLineFilter, hashtagFilter, channelFilter } from './content-filters';
import { PrismaService } from '../../common/prisma/prisma.service';

function parseIntOrDefault(val: any, def?: number): number | undefined {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
}

export interface UnifiedItem {
  platform: string;
  post_id: string;
  url: string;
  description: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  play_count: number;
  likes_count: number;
  comments_count: number;
  date_posted: Date;
  author_id?: string;
  author_name: string;
  author_avatar: string;
  author_username: string;
}

interface UnifiedRow {
  platform: string;
  post_id: string;
  url: string;
  description: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  play_count: bigint;
  likes_count: bigint;
  comments_count: bigint;
  date_posted: Date;
  author_id: string;
  author_name: string;
  author_avatar: string;
  author_username: string;
}

function toUnifiedItem(r: UnifiedRow): UnifiedItem {
  return {
    platform: r.platform,
    post_id: r.post_id,
    url: r.url,
    description: r.description,
    thumbnail_url: r.thumbnail_url,
    duration_seconds: r.duration_seconds,
    play_count: Number(r.play_count),
    likes_count: Number(r.likes_count),
    comments_count: Number(r.comments_count),
    date_posted: r.date_posted,
    author_id: r.author_id,
    author_name: r.author_name,
    author_avatar: r.author_avatar,
    author_username: r.author_username,
  };
}

// search bằng immutable_unaccent() qua GIN trigram index (Phase 1+2) — thay
// unaccentMatch() JS. Hashtags array giữ nguyên hành vi cũ của
// unaccentIncludesHashtag: KHÔNG unaccent, chỉ so khớp lowercase.
function searchCondition(descriptionExpr: Prisma.Sql, hashtagsCol: Prisma.Sql | null, q: string): Prisma.Sql {
  const textCond = Prisma.sql`lower(immutable_unaccent(${descriptionExpr})) LIKE '%' || lower(immutable_unaccent(${q})) || '%'`;
  if (!hashtagsCol) return textCond;
  const hashtagQ = q.replace(/^#/, '');
  const hashtagCond = Prisma.sql`EXISTS (SELECT 1 FROM unnest(${hashtagsCol}) h WHERE lower(h) LIKE '%' || lower(${hashtagQ}) || '%')`;
  return Prisma.sql`(${textCond} OR ${hashtagCond})`;
}

// post_id là khoá phụ phá hoà. Thiếu nó, các dòng hoà nhau (rất nhiều video cùng số tim,
// cùng lượt xem) bị Postgres trả về theo thứ tự tuỳ ý ở mỗi lần gọi — lật trang là thấy
// video lặp lại, và một số video khác thì không bao giờ hiện ra.
function sortExpr(sort: string): Prisma.Sql {
  if (sort === 'plays') return Prisma.sql`play_count DESC, post_id DESC`;
  if (sort === 'likes') return Prisma.sql`likes_count DESC, post_id DESC`;
  return Prisma.sql`date_posted DESC, post_id DESC`;
}

// Port từ scraper_views.py::all_external_videos/owned_channel_videos (AI đã xóa) —
// gom video từ nhiều bảng khác nhau, chỉ đọc, không ghi.
@Injectable()
export class ScraperAggregateReadService {
  constructor(private readonly prisma: PrismaService) {}

  async allExternalVideos(params: {
    page?: string; page_size?: string; q?: string; sort?: string; platform?: string;
    min_plays?: string; date_from?: string; date_to?: string;
  }) {
    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 24)!));
    const q = (params.q || '').trim();
    const sort = params.sort || 'date';
    // 'all' (và chuỗi rỗng) đều nghĩa là KHÔNG lọc nền tảng. Không nhận 'all' thì nó không
    // khớp nhánh nào và API trả về danh sách rỗng — rất khó lần ra vì vẫn HTTP 200.
    const rawPlatform = (params.platform || '').trim().toLowerCase();
    const platform = rawPlatform === 'all' ? '' : rawPlatform;
    const minPlays = parseIntOrDefault(params.min_plays);
    const dateFrom = (params.date_from || '').trim();
    const dateTo = (params.date_to || '').trim();

    // Mỗi platform là 1 branch UNION ALL — cùng 14 cột theo đúng thứ tự
    // UnifiedItem để Postgres resolve type composite được. Lọc (date/min_plays/q)
    // ở từng branch bằng DB, gộp lại rồi mới ORDER BY + LIMIT/OFFSET 1 lần trên
    // toàn bộ tập hợp nhất (không phải mỗi platform limit riêng).
    const branches: Prisma.Sql[] = [];

    if (!platform || platform === 'facebook') {
      const conditions: Prisma.Sql[] = [];
      if (dateFrom) conditions.push(Prisma.sql`r.date_posted >= ${new Date(`${dateFrom}T00:00:00.000Z`)}`);
      if (dateTo) conditions.push(Prisma.sql`r.date_posted <= ${new Date(`${dateTo}T23:59:59.999Z`)}`);
      if (minPlays !== undefined) conditions.push(Prisma.sql`r.views_count >= ${BigInt(minPlays)}`);
      if (q) conditions.push(searchCondition(Prisma.sql`r.content`, Prisma.sql`r.hashtags`, q));
      const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
      branches.push(Prisma.sql`
        SELECT 'facebook' AS platform, r.post_id, r.url, r.content AS description,
               COALESCE(NULLIF(r.thumbnail_drive_url, ''), r.thumbnail_url, '') AS thumbnail_url,
               r.duration_seconds::double precision AS duration_seconds, r.views_count AS play_count,
               r.likes_count, r.comments_count, r.date_posted,
               COALESCE(f.profile_id, '') AS author_id, COALESCE(f.name, '') AS author_name,
               COALESCE(NULLIF(f.avatar_drive_url, ''), f.avatar_url, '') AS author_avatar,
               COALESCE(f.handle, '') AS author_username
        FROM scraper_facebook_reels r
        LEFT JOIN scraper_fanpages f ON f.id = r.fanpage_id
        ${where}
      `);
    }

    if (!platform || platform === 'tiktok') {
      const conditions: Prisma.Sql[] = [];
      if (dateFrom) conditions.push(Prisma.sql`v.date_posted >= ${new Date(`${dateFrom}T00:00:00.000Z`)}`);
      if (dateTo) conditions.push(Prisma.sql`v.date_posted <= ${new Date(`${dateTo}T23:59:59.999Z`)}`);
      if (minPlays !== undefined) conditions.push(Prisma.sql`v.play_count >= ${BigInt(minPlays)}`);
      if (q) conditions.push(searchCondition(Prisma.sql`v.description`, Prisma.sql`v.hashtags`, q));
      const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
      branches.push(Prisma.sql`
        SELECT 'tiktok' AS platform, v.video_id AS post_id, v.url, v.description, v.cover_image AS thumbnail_url,
               v.video_duration::double precision AS duration_seconds, v.play_count,
               v.digg_count AS likes_count, v.comment_count AS comments_count, v.date_posted,
               '' AS author_id, COALESCE(p.nickname, '') AS author_name,
               COALESCE(p.avatar_url, '') AS author_avatar, COALESCE(p.username, '') AS author_username
        FROM scraper_tiktok_profile_videos v
        LEFT JOIN scraper_tiktok_profiles p ON p.id = v.profile_id
        ${where}
      `);
    }

    if (!platform || platform === 'instagram') {
      const conditions: Prisma.Sql[] = [];
      if (dateFrom) conditions.push(Prisma.sql`r.date_posted >= ${new Date(`${dateFrom}T00:00:00.000Z`)}`);
      if (dateTo) conditions.push(Prisma.sql`r.date_posted <= ${new Date(`${dateTo}T23:59:59.999Z`)}`);
      if (minPlays !== undefined) conditions.push(Prisma.sql`r.play_count >= ${BigInt(minPlays)}`);
      if (q) conditions.push(searchCondition(Prisma.sql`r.description`, Prisma.sql`r.hashtags`, q));
      const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
      branches.push(Prisma.sql`
        SELECT 'instagram' AS platform, r.post_id, r.url, r.description,
               COALESCE(NULLIF(r.thumbnail_drive_url, ''), r.thumbnail_url, '') AS thumbnail_url,
               r.duration_seconds::double precision AS duration_seconds, r.play_count,
               r.likes_count, r.comments_count, r.date_posted,
               '' AS author_id, COALESCE(p.username, '') AS author_name,
               COALESCE(p.avatar_url, '') AS author_avatar, COALESCE(p.username, '') AS author_username
        FROM scraper_instagram_reels r
        LEFT JOIN scraper_instagram_profiles p ON p.id = r.profile_id
        ${where}
      `);
    }

    // ─── 5 nền tảng còn lại ─────────────────────────────────────────────────
    // Trước đây trang "Tất cả" chỉ gộp facebook/tiktok/instagram — tức nó KHÔNG hề "tất cả",
    // thiếu hẳn Douyin, Xiaohongshu, Kuaishou, Bilibili, YouTube (657 video trong khi thực tế
    // có ~9000). Mỗi nhánh phải trả ĐÚNG 14 cột theo đúng thứ tự để Postgres gộp UNION được.
    //
    // Nền tảng nào không có chỉ số nào thì trả 0 chứ không bịa: Douyin/Xiaohongshu không công
    // khai lượt xem, Bilibili không có lượt thích, YouTube Shorts không lưu lượt thích/bình luận.
    const buildWhere = (conds: Prisma.Sql[]) =>
      conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;

    if (!platform || platform === 'douyin') {
      const c: Prisma.Sql[] = [];
      if (dateFrom) c.push(Prisma.sql`v.date_posted >= ${new Date(`${dateFrom}T00:00:00.000Z`)}`);
      if (dateTo) c.push(Prisma.sql`v.date_posted <= ${new Date(`${dateTo}T23:59:59.999Z`)}`);
      // Douyin không công khai lượt xem → lọc theo lượt xem thì bỏ hẳn nhánh này ra.
      if (minPlays !== undefined) c.push(Prisma.sql`false`);
      if (q) c.push(searchCondition(Prisma.sql`v.description`, Prisma.sql`v.hashtags`, q));
      branches.push(Prisma.sql`
        SELECT 'douyin' AS platform, v.post_id, v.url, v.description,
               COALESCE(v.preview_image, '') AS thumbnail_url,
               v.video_duration::double precision AS duration_seconds, 0::bigint AS play_count,
               v.digg_count AS likes_count, v.comment_count AS comments_count, v.date_posted,
               COALESCE(v.author_id, '') AS author_id, COALESCE(v.author_display_name, '') AS author_name,
               COALESCE(v.author_avatar, '') AS author_avatar, COALESCE(v.author_username, '') AS author_username
        FROM scraper_douyin_videos v
        ${buildWhere(c)}
      `);
    }

    if (!platform || platform === 'xiaohongshu') {
      const c: Prisma.Sql[] = [];
      if (dateFrom) c.push(Prisma.sql`v.date_posted >= ${new Date(`${dateFrom}T00:00:00.000Z`)}`);
      if (dateTo) c.push(Prisma.sql`v.date_posted <= ${new Date(`${dateTo}T23:59:59.999Z`)}`);
      if (minPlays !== undefined) c.push(Prisma.sql`false`); // không công khai lượt xem
      if (q) c.push(searchCondition(Prisma.sql`(v.title || ' ' || v.description)`, Prisma.sql`v.keywords`, q));
      branches.push(Prisma.sql`
        SELECT 'xiaohongshu' AS platform, v.note_id AS post_id, v.url,
               COALESCE(NULLIF(v.title, ''), v.description) AS description,
               COALESCE(NULLIF(v.thumbnail_drive_url, ''), v.thumbnail_url, '') AS thumbnail_url,
               v.duration_seconds::double precision AS duration_seconds, 0::bigint AS play_count,
               v.liked_count AS likes_count, v.comments_count, v.date_posted,
               COALESCE(v.author_id, '') AS author_id, COALESCE(v.author_name, '') AS author_name,
               COALESCE(v.author_avatar, '') AS author_avatar, COALESCE(v.author_name, '') AS author_username
        FROM scraper_xiaohongshu_videos v
        ${buildWhere(c)}
      `);
    }

    if (!platform || platform === 'kuaishou') {
      const c: Prisma.Sql[] = [];
      if (dateFrom) c.push(Prisma.sql`v.date_posted >= ${new Date(`${dateFrom}T00:00:00.000Z`)}`);
      if (dateTo) c.push(Prisma.sql`v.date_posted <= ${new Date(`${dateTo}T23:59:59.999Z`)}`);
      if (minPlays !== undefined) c.push(Prisma.sql`v.view_count >= ${BigInt(minPlays)}`);
      if (q) c.push(searchCondition(Prisma.sql`v.description`, Prisma.sql`v.hashtags`, q));
      branches.push(Prisma.sql`
        SELECT 'kuaishou' AS platform, v.post_id, v.url, v.description,
               COALESCE(NULLIF(v.thumbnail_drive_url, ''), v.thumbnail_url, '') AS thumbnail_url,
               v.video_duration::double precision AS duration_seconds, v.view_count AS play_count,
               v.like_count AS likes_count, v.comment_count AS comments_count, v.date_posted,
               '' AS author_id, COALESCE(p.nickname, '') AS author_name,
               COALESCE(p.avatar_url, '') AS author_avatar, COALESCE(p.username, '') AS author_username
        FROM scraper_kuaishou_videos v
        LEFT JOIN scraper_kuaishou_profiles p ON p.id = v.profile_id
        ${buildWhere(c)}
      `);
    }

    if (!platform || platform === 'bilibili') {
      const c: Prisma.Sql[] = [];
      if (dateFrom) c.push(Prisma.sql`v.date_posted >= ${new Date(`${dateFrom}T00:00:00.000Z`)}`);
      if (dateTo) c.push(Prisma.sql`v.date_posted <= ${new Date(`${dateTo}T23:59:59.999Z`)}`);
      if (minPlays !== undefined) c.push(Prisma.sql`v.view_count >= ${BigInt(minPlays)}`);
      if (q) c.push(searchCondition(Prisma.sql`v.description`, null, q));
      branches.push(Prisma.sql`
        SELECT 'bilibili' AS platform, v.post_id, v.url, v.description,
               COALESCE(NULLIF(v.thumbnail_drive_url, ''), v.thumbnail_url, '') AS thumbnail_url,
               v.video_duration::double precision AS duration_seconds, v.view_count AS play_count,
               0::bigint AS likes_count,
               v.danmaku_count AS comments_count, v.date_posted,
               '' AS author_id, COALESCE(p.nickname, '') AS author_name,
               COALESCE(p.avatar_url, '') AS author_avatar, COALESCE(p.username, '') AS author_username
        FROM scraper_bilibili_videos v
        LEFT JOIN scraper_bilibili_profiles p ON p.id = v.profile_id
        ${buildWhere(c)}
      `);
    }

    if (!platform || platform === 'youtube') {
      const c: Prisma.Sql[] = [];
      // Bảng YouTube Shorts KHÔNG có ngày đăng — dùng thời điểm cào (created_at) thay thế,
      // nên lọc/sắp theo ngày với YouTube là theo ngày cào chứ không phải ngày đăng.
      if (dateFrom) c.push(Prisma.sql`v.created_at >= ${new Date(`${dateFrom}T00:00:00.000Z`)}`);
      if (dateTo) c.push(Prisma.sql`v.created_at <= ${new Date(`${dateTo}T23:59:59.999Z`)}`);
      if (minPlays !== undefined) c.push(Prisma.sql`v.view_count >= ${BigInt(minPlays)}`);
      if (q) c.push(searchCondition(Prisma.sql`v.title`, Prisma.sql`v.hashtags`, q));
      branches.push(Prisma.sql`
        SELECT 'youtube' AS platform, v.video_id AS post_id, v.url, v.title AS description,
               COALESCE(NULLIF(v.thumbnail_drive_url, ''), v.thumbnail_url, '') AS thumbnail_url,
               0::double precision AS duration_seconds, v.view_count AS play_count,
               0::bigint AS likes_count, 0::bigint AS comments_count, v.created_at AS date_posted,
               '' AS author_id, COALESCE(p.title, '') AS author_name,
               COALESCE(p.avatar_url, '') AS author_avatar, COALESCE(p.title, '') AS author_username
        FROM scraper_youtube_shorts v
        LEFT JOIN scraper_youtube_profiles p ON p.id = v.profile_id
        ${buildWhere(c)}
      `);
    }

    if (!platform || platform === 'threads') {
      const c: Prisma.Sql[] = [];
      if (dateFrom) c.push(Prisma.sql`tp.date_posted >= ${new Date(`${dateFrom}T00:00:00.000Z`)}`);
      if (dateTo) c.push(Prisma.sql`tp.date_posted <= ${new Date(`${dateTo}T23:59:59.999Z`)}`);
      if (minPlays !== undefined) c.push(Prisma.sql`tp.views_count >= ${BigInt(minPlays)}`);
      if (q) c.push(searchCondition(Prisma.sql`tp.text`, Prisma.sql`tp.hashtags`, q));
      branches.push(Prisma.sql`
        SELECT 'threads' AS platform, tp.post_id, tp.url, tp.text AS description,
               COALESCE(NULLIF(tp.thumbnail_drive_url, ''), tp.thumbnail_url, '') AS thumbnail_url,
               NULL::double precision AS duration_seconds, tp.views_count AS play_count,
               tp.likes_count, tp.replies_count AS comments_count, tp.date_posted,
               COALESCE(p.profile_id, '') AS author_id,
               COALESCE(NULLIF(p.nickname, ''), p.username) AS author_name,
               COALESCE(NULLIF(p.avatar_drive_url, ''), p.avatar_url, '') AS author_avatar,
               p.username AS author_username
        FROM scraper_threads_posts tp
        JOIN scraper_threads_profiles p ON p.id = tp.profile_id
        ${buildWhere(c)}
      `);
    }

    if (branches.length === 0) {
      return { status: 'ok', count: 0, page: pageNum, page_size: pageSize, total_pages: 1, videos: [] };
    }

    const combined = Prisma.sql`(${Prisma.join(branches, ' UNION ALL ')})`;

    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM ${combined} AS combined
    `;
    const totalNum = Number(total);
    const totalPages = totalNum > 0 ? Math.ceil(totalNum / pageSize) : 1;
    const offset = (pageNum - 1) * pageSize;

    const rows = await this.prisma.$queryRaw<UnifiedRow[]>`
      SELECT * FROM ${combined} AS combined
      ORDER BY ${sortExpr(sort)}
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    return {
      status: 'ok',
      count: totalNum,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      videos: rows.map(toUnifiedItem),
    };
  }

  async ownedChannelVideos(params: {
    page?: string; page_size?: string; q?: string; sort?: string; platform?: string;
    min_plays?: string; date_from?: string; date_to?: string;
    /** 'vn' | 'global' — đoán theo dấu tiếng Việt, xem content-filters.ts */
    market?: string;
    /** 'A1'..'A5' — bắt theo hashtag #A1..#A5 sẵn có trong caption */
    content_line?: string;
    /** Định danh kênh: page_id (Facebook) / username / channel_id tuỳ nền tảng */
    channel?: string;
    /** Hashtag bất kỳ, có hoặc không có dấu # đều được */
    hashtag?: string;
  }) {
    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 24)!));
    const q = (params.q || '').trim();
    const sort = params.sort || 'date';
    const platform = (params.platform || '').trim();
    const minPlays = parseIntOrDefault(params.min_plays);
    const dateFrom = (params.date_from || '').trim();
    const dateTo = (params.date_to || '').trim();
    const market = (params.market || '').trim();
    const contentLine = (params.content_line || '').trim();
    const channel = (params.channel || '').trim();
    const hashtag = (params.hashtag || '').trim();

    /** Hai bộ lọc mới đều dựa vào chữ, mà mỗi nhánh gọi cột chữ một tên khác nhau. */
    function filterByKeyword(cotChu: Prisma.Sql, cotHashtag?: Prisma.Sql): Prisma.Sql[] {
      const c: Prisma.Sql[] = [];
      const tt = marketFilter(cotChu, market);
      if (tt) c.push(tt);
      const tuyen = contentLineFilter(cotChu, contentLine, cotHashtag);
      if (tuyen) c.push(tuyen);
      const the = hashtagFilter(cotChu, hashtag, cotHashtag);
      if (the) c.push(the);
      return c;
    }

    /** Cột định danh kênh khác tên ở từng nhánh nên phải truyền vào. */
    function filterByChannel(cotKenh: Prisma.Sql): Prisma.Sql[] {
      const dk = channelFilter(cotKenh, channel);
      return dk ? [dk] : [];
    }

    // Douyin/Xiaohongshu không có field view/play thật (TikHub không trả về) —
    // play_count luôn hardcode 0, nên khi lọc theo min_plays > 0 không có video
    // nào của 2 nền tảng này thoả, bỏ qua hẳn branch để tránh query thừa.
    const canHaveViews = minPlays === undefined || minPlays <= 0;

    function dateCond(col: Prisma.Sql): Prisma.Sql[] {
      const c: Prisma.Sql[] = [];
      if (dateFrom) c.push(Prisma.sql`${col} >= ${new Date(`${dateFrom}T00:00:00.000Z`)}`);
      if (dateTo) c.push(Prisma.sql`${col} <= ${new Date(`${dateTo}T23:59:59.999Z`)}`);
      return c;
    }

    const branches: Prisma.Sql[] = [];

    if (!platform || platform === 'tiktok') {
      const conditions = [Prisma.sql`p.is_owned = true`, ...dateCond(Prisma.sql`v.date_posted`)];
      if (minPlays !== undefined) conditions.push(Prisma.sql`v.play_count >= ${BigInt(minPlays)}`);
      if (q) conditions.push(searchCondition(Prisma.sql`v.description`, null, q));
      conditions.push(...filterByKeyword(Prisma.sql`v.description`, Prisma.sql`v.hashtags`));
      conditions.push(...filterByChannel(Prisma.sql`p.username`));
      branches.push(Prisma.sql`
        SELECT 'tiktok' AS platform, v.video_id AS post_id, v.url, v.description,
               COALESCE(v.cover_image, '') AS thumbnail_url, v.video_duration::double precision AS duration_seconds,
               v.play_count, v.digg_count AS likes_count, v.comment_count AS comments_count, v.date_posted,
               COALESCE(p.nickname, '') AS author_name, COALESCE(p.avatar_url, '') AS author_avatar,
               COALESCE(p.username, '') AS author_username
        FROM scraper_tiktok_profile_videos v
        JOIN scraper_tiktok_profiles p ON p.id = v.profile_id
        WHERE ${Prisma.join(conditions, ' AND ')}
      `);
    }

    if (!platform || platform === 'instagram') {
      const conditions = [Prisma.sql`p.is_owned = true`, ...dateCond(Prisma.sql`r.date_posted`)];
      if (minPlays !== undefined) conditions.push(Prisma.sql`r.play_count >= ${BigInt(minPlays)}`);
      if (q) conditions.push(searchCondition(Prisma.sql`r.description`, null, q));
      conditions.push(...filterByKeyword(Prisma.sql`r.description`, Prisma.sql`r.hashtags`));
      conditions.push(...filterByChannel(Prisma.sql`p.username`));
      branches.push(Prisma.sql`
        SELECT 'instagram' AS platform, r.post_id, r.url, r.description,
               COALESCE(NULLIF(r.thumbnail_drive_url, ''), r.thumbnail_url, '') AS thumbnail_url,
               r.duration_seconds::double precision AS duration_seconds, r.play_count,
               r.likes_count, r.comments_count, r.date_posted,
               COALESCE(p.username, '') AS author_name, COALESCE(p.avatar_url, '') AS author_avatar,
               COALESCE(p.username, '') AS author_username
        FROM scraper_instagram_reels r
        JOIN scraper_instagram_profiles p ON p.id = r.profile_id
        WHERE ${Prisma.join(conditions, ' AND ')}
      `);
    }

    if ((!platform || platform === 'douyin') && canHaveViews) {
      const conditions = [
        Prisma.sql`v.search_keyword IN (SELECT '@' || dp.username FROM scraper_douyin_profiles dp WHERE dp.is_owned = true AND dp.username <> '')`,
        ...dateCond(Prisma.sql`v.date_posted`),
      ];
      if (q) conditions.push(searchCondition(Prisma.sql`v.description`, null, q));
      conditions.push(...filterByKeyword(Prisma.sql`v.description`, Prisma.sql`v.hashtags`));
      conditions.push(...filterByChannel(Prisma.sql`v.author_username`));
      branches.push(Prisma.sql`
        SELECT 'douyin' AS platform, v.post_id, v.url, v.description,
               COALESCE(v.preview_image, '') AS thumbnail_url, v.video_duration::double precision AS duration_seconds,
               0::bigint AS play_count, v.digg_count AS likes_count, v.comment_count AS comments_count, v.date_posted,
               v.author_display_name AS author_name, COALESCE(v.author_avatar, '') AS author_avatar,
               v.author_username AS author_username
        FROM scraper_douyin_videos v
        WHERE ${Prisma.join(conditions, ' AND ')}
      `);
    }

    if ((!platform || platform === 'xiaohongshu') && canHaveViews) {
      const conditions = [Prisma.sql`p.is_owned = true`, ...dateCond(Prisma.sql`v.date_posted`)];
      if (q) {
        conditions.push(
          searchCondition(Prisma.sql`(COALESCE(v.title, '') || ' ' || COALESCE(v.description, ''))`, null, q),
        );
      }
      conditions.push(...filterByKeyword(Prisma.sql`(COALESCE(v.title, '') || ' ' || COALESCE(v.description, ''))`));
      conditions.push(...filterByChannel(Prisma.sql`v.author_id`));
      branches.push(Prisma.sql`
        SELECT 'xiaohongshu' AS platform, v.note_id AS post_id, v.url,
               COALESCE(NULLIF(v.title, ''), v.description) AS description,
               COALESCE(NULLIF(v.thumbnail_drive_url, ''), v.thumbnail_url, '') AS thumbnail_url,
               v.duration_seconds::double precision AS duration_seconds,
               0::bigint AS play_count, v.liked_count AS likes_count, v.comments_count, v.date_posted,
               v.author_name, COALESCE(v.author_avatar, '') AS author_avatar, v.author_id AS author_username
        FROM scraper_xiaohongshu_videos v
        JOIN scraper_xiaohongshu_profiles p ON p.id = v.profile_id
        WHERE ${Prisma.join(conditions, ' AND ')}
      `);
    }

    if (!platform || platform === 'youtube') {
      // ScraperYoutubeShort không có date_posted riêng — dùng created_at (ngày cào về).
      const conditions = [Prisma.sql`p.is_owned = true`, ...dateCond(Prisma.sql`s.created_at`)];
      if (minPlays !== undefined) conditions.push(Prisma.sql`s.view_count >= ${BigInt(minPlays)}`);
      if (q) conditions.push(searchCondition(Prisma.sql`s.title`, null, q));
      conditions.push(...filterByKeyword(Prisma.sql`s.title`, Prisma.sql`s.hashtags`));
      conditions.push(...filterByChannel(Prisma.sql`p.channel_id`));
      branches.push(Prisma.sql`
        SELECT 'youtube' AS platform, s.video_id AS post_id, s.url, s.title AS description,
               COALESCE(NULLIF(s.thumbnail_drive_url, ''), s.thumbnail_url, '') AS thumbnail_url,
               NULL::double precision AS duration_seconds, s.view_count AS play_count,
               0::bigint AS likes_count, 0::bigint AS comments_count, s.created_at AS date_posted,
               COALESCE(p.title, '') AS author_name, COALESCE(p.avatar_url, '') AS author_avatar,
               COALESCE(p.channel_id, '') AS author_username
        FROM scraper_youtube_shorts s
        JOIN scraper_youtube_profiles p ON p.id = s.profile_id
        WHERE ${Prisma.join(conditions, ' AND ')}
      `);
    }

    if (!platform || platform === 'facebook') {
      // video_management_ownedvideocontent dùng published_at, không phải date_posted.
      const conditions = [...dateCond(Prisma.sql`v.published_at`)];
      if (minPlays !== undefined) conditions.push(Prisma.sql`v.view_count >= ${BigInt(minPlays)}`);
      if (q) conditions.push(searchCondition(Prisma.sql`v.caption`, null, q));
      conditions.push(...filterByKeyword(Prisma.sql`v.caption`));
      conditions.push(...filterByChannel(Prisma.sql`mp.page_id`));
      const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
      branches.push(Prisma.sql`
        SELECT 'facebook' AS platform, v.post_id, COALESCE(v.permalink_url, '') AS url, COALESCE(v.caption, '') AS description,
               COALESCE(NULLIF(v.thumbnail_drive_url, ''), v.thumbnail_url, '') AS thumbnail_url,
               NULL::double precision AS duration_seconds,
               v.view_count AS play_count, v.like_count::bigint AS likes_count, v.comment_count::bigint AS comments_count,
               v.published_at AS date_posted,
               COALESCE(mp.name, '') AS author_name,
               COALESCE(NULLIF(mp.avatar_drive_url, ''), mp.avatar_url, '') AS author_avatar,
               COALESCE(mp.page_id, '') AS author_username
        FROM video_management_ownedvideocontent v
        LEFT JOIN video_management_managedfacebookpage mp ON mp.id = v.managed_page_id
        ${where}
      `);
    }

    if (!platform || platform === 'threads') {
      const conditions = [Prisma.sql`p.is_owned = true`, ...dateCond(Prisma.sql`tp.date_posted`)];
      if (minPlays !== undefined) conditions.push(Prisma.sql`tp.views_count >= ${BigInt(minPlays)}`);
      if (q) conditions.push(searchCondition(Prisma.sql`tp.text`, null, q));
      conditions.push(...filterByKeyword(Prisma.sql`tp.text`, Prisma.sql`tp.hashtags`));
      conditions.push(...filterByChannel(Prisma.sql`p.username`));
      branches.push(Prisma.sql`
        SELECT 'threads' AS platform, tp.post_id, tp.url, tp.text AS description,
               COALESCE(NULLIF(tp.thumbnail_drive_url, ''), tp.thumbnail_url, '') AS thumbnail_url,
               NULL::double precision AS duration_seconds, tp.views_count AS play_count,
               tp.likes_count, tp.replies_count AS comments_count, tp.date_posted,
               COALESCE(NULLIF(p.nickname, ''), p.username) AS author_name,
               COALESCE(NULLIF(p.avatar_drive_url, ''), p.avatar_url, '') AS author_avatar,
               p.username AS author_username
        FROM scraper_threads_posts tp
        JOIN scraper_threads_profiles p ON p.id = tp.profile_id
        WHERE ${Prisma.join(conditions, ' AND ')}
      `);
    }

    if (branches.length === 0) {
      return { status: 'ok', count: 0, page: pageNum, page_size: pageSize, total_pages: 1, videos: [] };
    }

    const combined = Prisma.sql`(${Prisma.join(branches, ' UNION ALL ')})`;

    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM ${combined} AS combined
    `;
    const totalNum = Number(total);
    const totalPages = Math.max(1, Math.ceil(totalNum / pageSize));
    const offset = (pageNum - 1) * pageSize;

    const rows = await this.prisma.$queryRaw<Omit<UnifiedRow, 'author_id'>[]>`
      SELECT * FROM ${combined} AS combined
      ORDER BY ${sortExpr(sort)}
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    return {
      status: 'ok',
      count: totalNum,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      videos: rows.map((r) => {
        const { author_id, ...rest } = toUnifiedItem({ ...r, author_id: '' });
        return rest;
      }),
    };
  }

  /**
   * Danh sách KÊNH NỘI BỘ để đổ vào ô chọn, kèm số video của từng kênh.
   *
   * Thực tế trong dữ liệu: 97 fanpage Facebook, còn TikTok/Instagram/YouTube chưa có kênh
   * nội bộ nào. Vẫn gộp cả các nền tảng kia để sau này bật lên là chạy, không phải sửa lại.
   *
   * Sắp theo SỐ VIDEO giảm dần chứ không theo tên: 97 dòng mà xếp theo bảng chữ cái thì
   * kênh chính nằm lẫn đâu đó giữa danh sách.
   */
  async ownedChannels() {
    const rows = await this.prisma.$queryRaw<
      { platform: string; id: string; ten: string; so_video: number }[]
    >`
      SELECT 'facebook' AS platform, mp.page_id AS id, mp.name AS ten, COUNT(v.id)::int AS so_video
      FROM video_management_managedfacebookpage mp
      LEFT JOIN video_management_ownedvideocontent v ON v.managed_page_id = mp.id
      GROUP BY mp.page_id, mp.name
      UNION ALL
      SELECT 'tiktok', p.username, COALESCE(NULLIF(p.nickname, ''), p.username),
             (SELECT COUNT(*)::int FROM scraper_tiktok_profile_videos t WHERE t.profile_id = p.id)
      FROM scraper_tiktok_profiles p WHERE p.is_owned
      UNION ALL
      SELECT 'instagram', p.username, p.username,
             (SELECT COUNT(*)::int FROM scraper_instagram_reels r WHERE r.profile_id = p.id)
      FROM scraper_instagram_profiles p WHERE p.is_owned
      UNION ALL
      SELECT 'youtube', p.channel_id, COALESCE(NULLIF(p.title, ''), p.channel_id),
             (SELECT COUNT(*)::int FROM scraper_youtube_shorts s WHERE s.profile_id = p.id)
      FROM scraper_youtube_profiles p WHERE p.is_owned
      UNION ALL
      SELECT 'threads', p.username, COALESCE(NULLIF(p.nickname, ''), p.username),
             (SELECT COUNT(*)::int FROM scraper_threads_posts tp WHERE tp.profile_id = p.id)
      FROM scraper_threads_profiles p WHERE p.is_owned
      ORDER BY so_video DESC, ten ASC
    `;
    return { channels: rows };
  }

  /**
   * Hashtag đang thực sự có trong dữ liệu, để đổ vào ô chọn.
   *
   * Bảng video Facebook nội bộ KHÔNG có cột hashtag — mà đó là nơi chứa gần như toàn bộ dữ
   * liệu nội bộ — nên phải bóc thẳng từ caption bằng biểu thức chính quy.
   *
   * `regexp_matches(..., 'g')` trả một DÒNG cho mỗi lần khớp, nên một caption gắn #vang hai
   * lần sẽ bị đếm hai. Dùng COUNT(DISTINCT v.id) để đếm đúng SỐ VIDEO, không phải số lần khớp.
   */
  async ownedHashtags(limit = 60) {
    const gioiHan = Math.min(200, Math.max(1, limit));
    const rows = await this.prisma.$queryRaw<{ the: string; so_video: number }[]>`
      SELECT lower(m[1]) AS the, COUNT(DISTINCT v.id)::int AS so_video
      FROM video_management_ownedvideocontent v,
           regexp_matches(v.caption, '#([[:alnum:]_]{1,64})', 'g') AS m
      GROUP BY 1
      HAVING COUNT(DISTINCT v.id) >= 3
      ORDER BY so_video DESC, the ASC
      LIMIT ${gioiHan}
    `;
    return { hashtags: rows };
  }
}
