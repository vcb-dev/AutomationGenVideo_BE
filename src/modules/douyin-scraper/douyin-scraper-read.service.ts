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

// Khớp unaccentIncludesHashtag() cũ — hashtags KHÔNG unaccent, chỉ lowercase.
function hashtagLike(hashtagsCol: Prisma.Sql, q: string): Prisma.Sql {
  const hq = q.replace(/^#/, '');
  return Prisma.sql`EXISTS (SELECT 1 FROM unnest(${hashtagsCol}) h WHERE lower(h) LIKE '%' || lower(${hq}) || '%')`;
}

interface DouyinVideoRow {
  post_id: string; url: string; description: string; hashtags: string[]; preview_image: string | null;
  video_duration: number; region: string; digg_count: bigint; comment_count: bigint; share_count: bigint;
  collect_count: bigint; music_title: string; search_keyword: string; date_posted: Date;
  author_id: string; author_username: string; author_display_name: string; author_avatar: string | null;
  author_followers: bigint; author_is_verified: boolean;
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

    const conditions: Prisma.Sql[] = [];
    if (minDigg !== undefined) conditions.push(Prisma.sql`digg_count >= ${BigInt(minDigg)}`);
    if (dateFrom) conditions.push(Prisma.sql`date_posted >= ${new Date(`${dateFrom}T00:00:00.000Z`)}`);
    if (dateTo) conditions.push(Prisma.sql`date_posted <= ${new Date(`${dateTo}T23:59:59.999Z`)}`);
    if (kwFilter) conditions.push(unaccentLike(Prisma.sql`search_keyword`, kwFilter));
    if (q) {
      conditions.push(Prisma.sql`(${unaccentLike(Prisma.sql`description`, q)} OR ${unaccentLike(Prisma.sql`search_keyword`, q)} OR ${hashtagLike(Prisma.sql`hashtags`, q)})`);
    }
    const whereClause = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    let orderCol: Prisma.Sql = Prisma.sql`created_at`;
    if (sort === 'likes') orderCol = Prisma.sql`digg_count`;
    else if (sort === 'date') orderCol = Prisma.sql`date_posted`;

    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM scraper_douyin_videos ${whereClause}
    `;
    const totalNum = Number(total);
    const totalPages = totalNum > 0 ? Math.ceil(totalNum / pageSize) : 1;
    const offset = (pageNum - 1) * pageSize;

    const videos = await this.prisma.$queryRaw<DouyinVideoRow[]>`
      SELECT post_id, url, description, hashtags, preview_image, video_duration, region, digg_count,
             comment_count, share_count, collect_count, music_title, search_keyword, date_posted,
             author_id, author_username, author_display_name, author_avatar, author_followers, author_is_verified
      FROM scraper_douyin_videos
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
      videos: videos.map((v) => ({
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
    const conditions: Prisma.Sql[] = [Prisma.sql`search_keyword <> ''`, Prisma.sql`search_keyword NOT LIKE '@%'`];
    if (q) conditions.push(unaccentLike(Prisma.sql`search_keyword`, q));

    const rows = await this.prisma.$queryRaw<{ keyword: string; count: bigint }[]>`
      SELECT search_keyword AS keyword, COUNT(*) AS count
      FROM scraper_douyin_videos
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY search_keyword
      ORDER BY count DESC
      LIMIT 10
    `;
    const results = rows.map((r) => ({ keyword: r.keyword, count: Number(r.count) }));

    return { suggestions: results };
  }

  private serializeProfile(p: any, videosInDb: number) {
    return {
      id: Number(p.id),
      sec_user_id: p.sec_user_id,
      uid: p.uid,
      username: p.username,
      nickname: p.nickname,
      avatar_url: p.avatar_drive_url || p.avatar_url,
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
