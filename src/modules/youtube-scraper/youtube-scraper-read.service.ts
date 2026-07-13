import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { unaccentMatch, unaccentIncludesHashtag } from '../../common/utils/unaccent.util';

function parseIntOrDefault(val: any, def?: number): number | undefined {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
}

// Nền tảng mới — BE sở hữu đọc từ đầu, không có view AI cũ để migrate.
// Mirror pattern đọc của TikTok/Douyin (list/detail/videos + unaccent search).
@Injectable()
export class YoutubeScraperReadService {
  private serializeProfile(p: any, shortsInDb: number) {
    return {
      id: Number(p.id),
      channel_id: p.channel_id,
      title: p.title,
      description: p.description || '',
      url: p.url,
      avatar_url: p.avatar_url || '',
      banner_url: p.banner_url || '',
      is_verified: p.is_verified,
      has_business_email: p.has_business_email,
      subscriber_count: Number(p.subscriber_count),
      video_count: p.video_count,
      view_count: Number(p.view_count),
      country: p.country,
      channel_created_at: p.channel_created_at,
      is_tracked: p.is_tracked,
      is_bookmarked: p.is_bookmarked,
      is_owned: p.is_owned,
      is_initial_scraped: p.is_initial_scraped,
      scraping_status: p.scraping_status,
      scrape_error: p.scrape_error,
      last_scraped_at: p.last_scraped_at,
      created_at: p.created_at,
      shorts_in_db: shortsInDb,
    };
  }

  constructor(private readonly prisma: PrismaService) {}

  async listProfiles(params: {
    page?: string; page_size?: string; search?: string; sort_by?: string; is_owned?: string;
  }) {
    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 12)!));
    const search = (params.search || '').trim();
    const sortBy = params.sort_by || 'subscribers';
    const isOwnedParam = (params.is_owned || '').trim();

    const where: any = {};
    if (isOwnedParam === 'true') where.is_owned = true;
    else if (isOwnedParam === 'false') where.is_owned = false;

    const secondaryOrderBy = sortBy === 'recent' ? { created_at: 'desc' as const } : { subscriber_count: 'desc' as const };

    const all = await this.prisma.scraperYoutubeProfile.findMany({
      where,
      orderBy: [{ is_bookmarked: 'desc' }, secondaryOrderBy],
    });

    const filtered = search ? all.filter((p) => unaccentMatch(p.title, search)) : all;

    const total = filtered.length;
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
    const start = (pageNum - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);

    const shortsCounts = paginated.length
      ? await this.prisma.scraperYoutubeShort.groupBy({
          by: ['profile_id'],
          where: { profile_id: { in: paginated.map((p) => p.id) } },
          _count: { id: true },
        })
      : [];
    const countMap = new Map(shortsCounts.map((c) => [c.profile_id.toString(), c._count.id]));

    return {
      status: 'ok',
      count: total,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      profiles: paginated.map((p) => this.serializeProfile(p, countMap.get(p.id.toString()) || 0)),
    };
  }

  async listShorts(params: {
    page?: string; page_size?: string; q?: string;
    profile_id?: string; min_views?: string; sort?: string;
  }) {
    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 24)!));
    const q = (params.q || '').trim();
    const minViews = parseIntOrDefault(params.min_views);
    const sort = params.sort || 'views';
    const profileId = parseIntOrDefault(params.profile_id);

    const where: any = {};
    if (profileId !== undefined) where.profile_id = BigInt(profileId);
    if (minViews !== undefined) where.view_count = { gte: BigInt(minViews) };
    if (q) where.title = { contains: q, mode: 'insensitive' };

    const orderBy: any = sort === 'recent' ? { created_at: 'desc' } : { view_count: 'desc' };

    const [total, shorts] = await Promise.all([
      this.prisma.scraperYoutubeShort.count({ where }),
      this.prisma.scraperYoutubeShort.findMany({
        where,
        orderBy,
        include: { profile: { select: { id: true, channel_id: true, title: true, avatar_url: true } } },
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;

    return {
      status: 'ok',
      count: total,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      shorts: shorts.map((s) => ({
        video_id: s.video_id,
        title: s.title,
        hashtags: s.hashtags,
        url: s.url,
        thumbnail_url: (s as any).thumbnail_drive_url || s.thumbnail_url || '',
        view_count: Number(s.view_count),
        view_count_text: s.view_count_text,
        created_at: s.created_at,
        profile: {
          id: Number(s.profile.id),
          channel_id: s.profile.channel_id,
          title: s.profile.title,
          avatar_url: s.profile.avatar_url || '',
        },
      })),
    };
  }

  async profileDetail(profileId: bigint): Promise<any | null> {
    const p = await this.prisma.scraperYoutubeProfile.findUnique({ where: { id: profileId } });
    if (!p) return null;

    const agg = await this.prisma.scraperYoutubeShort.aggregate({
      where: { profile_id: profileId },
      _sum: { view_count: true },
      _count: { id: true },
    });

    return {
      ...this.serializeProfile(p, agg._count.id),
      total_views: Number(agg._sum.view_count || 0),
    };
  }

  async profileShorts(
    profileId: bigint,
    params: { page?: string; page_size?: string; sort?: string; q?: string; min_views?: string },
  ): Promise<any | null> {
    const profile = await this.prisma.scraperYoutubeProfile.findUnique({ where: { id: profileId } });
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

    const all = await this.prisma.scraperYoutubeShort.findMany({ where, orderBy });

    const filtered = q
      ? all.filter((s) => unaccentMatch(s.title, q) || unaccentIncludesHashtag(s.hashtags, q))
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
      shorts: paginated.map((s) => ({
        video_id: s.video_id,
        title: s.title,
        hashtags: s.hashtags,
        url: s.url,
        thumbnail_url: s.thumbnail_drive_url || s.thumbnail_url || '',
        view_count: Number(s.view_count),
        view_count_text: s.view_count_text,
        created_at: s.created_at,
      })),
    };
  }
}
