import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { unaccentMatch, unaccentIncludesHashtag } from '../../common/utils/unaccent.util';

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
    const platform = (params.platform || '').trim();
    const minPlays = parseIntOrDefault(params.min_plays);
    const dateFrom = (params.date_from || '').trim();
    const dateTo = (params.date_to || '').trim();

    const dateWhere: any = {};
    if (dateFrom || dateTo) {
      dateWhere.date_posted = {};
      if (dateFrom) dateWhere.date_posted.gte = new Date(`${dateFrom}T00:00:00.000Z`);
      if (dateTo) dateWhere.date_posted.lte = new Date(`${dateTo}T23:59:59.999Z`);
    }

    let items: UnifiedItem[] = [];

    if (!platform || platform === 'facebook') {
      const where: any = { ...dateWhere };
      if (minPlays !== undefined) where.views_count = { gte: BigInt(minPlays) };
      const reels = await this.prisma.scraperFacebookReel.findMany({ where, include: { fanpage: true } });
      for (const r of reels) {
        if (q && !unaccentMatch(r.content, q) && !unaccentIncludesHashtag(r.hashtags, q)) continue;
        items.push({
          platform: 'facebook',
          post_id: r.post_id,
          url: r.url,
          description: r.content,
          thumbnail_url: r.thumbnail_url,
          duration_seconds: r.duration_seconds,
          play_count: Number(r.views_count),
          likes_count: Number(r.likes_count),
          comments_count: Number(r.comments_count),
          date_posted: r.date_posted,
          author_id: r.fanpage?.profile_id || '',
          author_name: r.fanpage?.name || '',
          author_avatar: r.fanpage?.avatar_url || '',
          author_username: r.fanpage?.handle || '',
        });
      }
    }

    if (!platform || platform === 'tiktok') {
      const where: any = { ...dateWhere };
      if (minPlays !== undefined) where.play_count = { gte: BigInt(minPlays) };
      const videos = await this.prisma.scraperTikTokProfileVideo.findMany({ where, include: { profile: true } });
      for (const v of videos) {
        if (q && !unaccentMatch(v.description, q) && !unaccentIncludesHashtag(v.hashtags, q)) continue;
        items.push({
          platform: 'tiktok',
          post_id: v.video_id,
          url: v.url,
          description: v.description,
          thumbnail_url: v.cover_image,
          duration_seconds: v.video_duration,
          play_count: Number(v.play_count),
          likes_count: Number(v.digg_count),
          comments_count: Number(v.comment_count),
          date_posted: v.date_posted,
          author_id: '',
          author_name: v.profile?.nickname || '',
          author_avatar: v.profile?.avatar_url || '',
          author_username: v.profile?.username || '',
        });
      }
    }

    if (!platform || platform === 'instagram') {
      const where: any = { ...dateWhere };
      if (minPlays !== undefined) where.play_count = { gte: BigInt(minPlays) };
      const reels = await this.prisma.scraperInstagramReel.findMany({ where, include: { profile: true } });
      for (const r of reels) {
        if (q && !unaccentMatch(r.description, q) && !unaccentIncludesHashtag(r.hashtags, q)) continue;
        items.push({
          platform: 'instagram',
          post_id: r.post_id,
          url: r.url,
          description: r.description,
          thumbnail_url: r.thumbnail_drive_url || r.thumbnail_url || '',
          duration_seconds: r.duration_seconds,
          play_count: Number(r.play_count),
          likes_count: Number(r.likes_count),
          comments_count: Number(r.comments_count),
          date_posted: r.date_posted,
          author_id: '',
          author_name: r.profile?.username || '',
          author_avatar: r.profile?.avatar_url || '',
          author_username: r.profile?.username || '',
        });
      }
    }

    if (sort === 'plays') items.sort((a, b) => b.play_count - a.play_count);
    else if (sort === 'likes') items.sort((a, b) => b.likes_count - a.likes_count);
    else items.sort((a, b) => b.date_posted.getTime() - a.date_posted.getTime());

    const total = items.length;
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
    const start = (pageNum - 1) * pageSize;
    const paginated = items.slice(start, start + pageSize);

    return {
      status: 'ok',
      count: total,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      videos: paginated,
    };
  }

  async ownedChannelVideos(params: {
    page?: string; page_size?: string; q?: string; sort?: string; platform?: string;
    min_plays?: string; date_from?: string; date_to?: string;
  }) {
    const pageNum = Math.max(1, parseIntOrDefault(params.page, 1)!);
    const pageSize = Math.min(100, Math.max(1, parseIntOrDefault(params.page_size, 24)!));
    const q = (params.q || '').trim();
    const sort = params.sort || 'date';
    const platform = (params.platform || '').trim();
    const minPlays = parseIntOrDefault(params.min_plays);
    const dateFrom = (params.date_from || '').trim();
    const dateTo = (params.date_to || '').trim();

    // Douyin/Xiaohongshu không có field view/play thật (TikHub không trả về) —
    // play_count luôn hardcode 0 bên dưới, nên khi lọc theo min_plays > 0
    // không có video nào của 2 nền tảng này thoả, bỏ qua hẳn để tránh query thừa.
    const canHaveViews = minPlays === undefined || minPlays <= 0;

    function dateRangeWhere(field: string): any {
      if (!dateFrom && !dateTo) return {};
      const range: any = {};
      if (dateFrom) range.gte = new Date(`${dateFrom}T00:00:00.000Z`);
      if (dateTo) range.lte = new Date(`${dateTo}T23:59:59.999Z`);
      return { [field]: range };
    }

    const items: Omit<UnifiedItem, 'author_id'>[] = [];

    if (!platform || platform === 'tiktok') {
      const where: any = { profile: { is_owned: true }, ...dateRangeWhere('date_posted') };
      if (minPlays !== undefined) where.play_count = { gte: BigInt(minPlays) };
      const videos = await this.prisma.scraperTikTokProfileVideo.findMany({ where, include: { profile: true } });
      for (const v of videos) {
        if (q && !unaccentMatch(v.description, q)) continue;
        items.push({
          platform: 'tiktok',
          post_id: v.video_id,
          url: v.url,
          description: v.description,
          thumbnail_url: v.cover_image || '',
          duration_seconds: v.video_duration,
          play_count: Number(v.play_count),
          likes_count: Number(v.digg_count),
          comments_count: Number(v.comment_count),
          date_posted: v.date_posted,
          author_name: v.profile?.nickname || '',
          author_avatar: v.profile?.avatar_url || '',
          author_username: v.profile?.username || '',
        });
      }
    }

    if (!platform || platform === 'instagram') {
      const where: any = { profile: { is_owned: true }, ...dateRangeWhere('date_posted') };
      if (minPlays !== undefined) where.play_count = { gte: BigInt(minPlays) };
      const reels = await this.prisma.scraperInstagramReel.findMany({ where, include: { profile: true } });
      for (const r of reels) {
        if (q && !unaccentMatch(r.description, q)) continue;
        items.push({
          platform: 'instagram',
          post_id: r.post_id,
          url: r.url,
          description: r.description,
          thumbnail_url: r.thumbnail_drive_url || r.thumbnail_url || '',
          duration_seconds: r.duration_seconds,
          play_count: Number(r.play_count),
          likes_count: Number(r.likes_count),
          comments_count: Number(r.comments_count),
          date_posted: r.date_posted,
          author_name: r.profile?.username || '',
          author_avatar: r.profile?.avatar_url || '',
          author_username: r.profile?.username || '',
        });
      }
    }

    if ((!platform || platform === 'douyin') && canHaveViews) {
      const ownedProfiles = await this.prisma.scraperDouyinProfile.findMany({
        where: { is_owned: true, username: { not: '' } },
        select: { username: true },
      });
      const ownedKeywords = ownedProfiles.map((p) => `@${p.username}`);
      if (ownedKeywords.length) {
        const videos = await this.prisma.scraperDouyinVideo.findMany({
          where: { search_keyword: { in: ownedKeywords }, ...dateRangeWhere('date_posted') },
        });
        for (const v of videos) {
          if (q && !unaccentMatch(v.description, q)) continue;
          items.push({
            platform: 'douyin',
            post_id: v.post_id,
            url: v.url,
            description: v.description,
            thumbnail_url: v.preview_image || '',
            duration_seconds: v.video_duration,
            play_count: 0,
            likes_count: Number(v.digg_count),
            comments_count: Number(v.comment_count),
            date_posted: v.date_posted,
            author_name: v.author_display_name,
            author_avatar: v.author_avatar || '',
            author_username: v.author_username,
          });
        }
      }
    }

    if ((!platform || platform === 'xiaohongshu') && canHaveViews) {
      const videos = await this.prisma.scraperXiaohongshuVideo.findMany({
        where: { profile: { is_owned: true }, ...dateRangeWhere('date_posted') },
      });
      for (const v of videos) {
        const text = `${v.title || ''} ${v.description || ''}`;
        if (q && !unaccentMatch(text, q)) continue;
        items.push({
          platform: 'xiaohongshu',
          post_id: v.note_id,
          url: v.url,
          description: v.title || v.description,
          thumbnail_url: v.thumbnail_drive_url || v.thumbnail_url || '',
          duration_seconds: v.duration_seconds,
          play_count: 0,
          likes_count: Number(v.liked_count),
          comments_count: Number(v.comments_count),
          date_posted: v.date_posted,
          author_name: v.author_name,
          author_avatar: v.author_avatar || '',
          author_username: v.author_id,
        });
      }
    }

    if (!platform || platform === 'youtube') {
      // ScraperYoutubeShort không có date_posted riêng — dùng created_at (ngày cào về).
      const where: any = { profile: { is_owned: true }, ...dateRangeWhere('created_at') };
      if (minPlays !== undefined) where.view_count = { gte: BigInt(minPlays) };
      const shorts = await this.prisma.scraperYoutubeShort.findMany({ where, include: { profile: true } });
      for (const s of shorts) {
        if (q && !unaccentMatch(s.title, q)) continue;
        items.push({
          platform: 'youtube',
          post_id: s.video_id,
          url: s.url,
          description: s.title,
          thumbnail_url: s.thumbnail_drive_url || s.thumbnail_url || '',
          duration_seconds: null,
          play_count: Number(s.view_count),
          likes_count: 0,
          comments_count: 0,
          date_posted: s.created_at,
          author_name: s.profile?.title || '',
          author_avatar: s.profile?.avatar_url || '',
          author_username: s.profile?.channel_id || '',
        });
      }
    }

    if (!platform || platform === 'facebook') {
      // video_management_ownedvideocontent dùng published_at, không phải date_posted.
      // Raw query thay vì findMany: (1) bỏ cột raw_data (JSON thô FB API ~3KB/dòng)
      // và access token của page mà include:managed_page kéo theo; (2) COALESCE sang
      // *_drive_url ngay tại DB — thumbnail_url CDN gốc (~516 ký tự) + avatar_url
      // page (~550) lặp ~17k lần qua join là lý do endpoint này từng trả hàng chục
      // MB, mất ~9.5s/lần gọi (đo pg_stat_statements 2026-07-16); bản drive ~69 ký tự.
      const conds: Prisma.Sql[] = [];
      if (dateFrom) conds.push(Prisma.sql`o.published_at >= ${new Date(`${dateFrom}T00:00:00.000Z`)}`);
      if (dateTo) conds.push(Prisma.sql`o.published_at <= ${new Date(`${dateTo}T23:59:59.999Z`)}`);
      if (minPlays !== undefined) conds.push(Prisma.sql`o.view_count >= ${minPlays}`);
      const whereSql = conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;

      const videos = await this.prisma.$queryRaw<Array<{
        post_id: string;
        permalink_url: string | null;
        caption: string | null;
        thumbnail_url: string | null;
        view_count: bigint;
        like_count: number;
        comment_count: number;
        published_at: Date;
        page_name: string | null;
        page_avatar: string | null;
        page_pid: string | null;
      }>>(Prisma.sql`
        SELECT o.post_id, o.permalink_url, o.caption,
               COALESCE(NULLIF(o.thumbnail_drive_url, ''), o.thumbnail_url, '') AS thumbnail_url,
               o.view_count, o.like_count, o.comment_count, o.published_at,
               p.name AS page_name,
               COALESCE(NULLIF(p.avatar_drive_url, ''), p.avatar_url, '') AS page_avatar,
               p.page_id AS page_pid
        FROM video_management_ownedvideocontent o
        LEFT JOIN video_management_managedfacebookpage p ON p.id = o.managed_page_id
        ${whereSql}
      `);
      for (const v of videos) {
        if (q && !unaccentMatch(v.caption || '', q)) continue;
        items.push({
          platform: 'facebook',
          post_id: v.post_id,
          url: v.permalink_url || '',
          description: v.caption || '',
          thumbnail_url: v.thumbnail_url || '',
          duration_seconds: null,
          play_count: Number(v.view_count),
          likes_count: v.like_count,
          comments_count: v.comment_count,
          date_posted: v.published_at,
          author_name: v.page_name || '',
          author_avatar: v.page_avatar || '',
          author_username: v.page_pid || '',
        });
      }
    }

    if (sort === 'plays') items.sort((a, b) => (b.play_count || 0) - (a.play_count || 0));
    else if (sort === 'likes') items.sort((a, b) => (b.likes_count || 0) - (a.likes_count || 0));
    else items.sort((a, b) => (b.date_posted?.getTime() || 0) - (a.date_posted?.getTime() || 0));

    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (pageNum - 1) * pageSize;
    const paginated = items.slice(start, start + pageSize);

    return {
      status: 'ok',
      count: total,
      page: pageNum,
      page_size: pageSize,
      total_pages: totalPages,
      videos: paginated,
    };
  }
}
