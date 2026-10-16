import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { normalizeSubredditName } from './reddit-input.util';
import { serializeRedditPost, serializeRedditSubreddit } from './reddit-serialize.util';

const MAX_PAGE_SIZE = 100;

export interface RedditPostsQuery {
  search?: string;
  subreddit?: string;
  media_type?: string;
  sort_by?: string;
  page?: number;
  limit?: number;
}

function pageParams(page?: number, limit?: number, defaultLimit = 24) {
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safeLimit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(limit) || defaultLimit)));
  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit };
}

@Injectable()
export class RedditScraperReadService {
  constructor(private readonly prisma: PrismaService) {}

  async listSubreddits(params: { search?: string; page?: number; limit?: number }) {
    const { page, limit, skip } = pageParams(params.page, params.limit, 12);
    const q = (params.search || '').trim();
    const where: Prisma.ScraperRedditSubredditWhereInput = q
      ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { title: { contains: q, mode: 'insensitive' } }] }
      : {};

    const [total, items] = await Promise.all([
      this.prisma.scraperRedditSubreddit.count({ where }),
      this.prisma.scraperRedditSubreddit.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updated_at: 'desc' },
        include: { _count: { select: { posts: true } } },
      }),
    ]);
    return { items: items.map(serializeRedditSubreddit), total, page, limit, total_pages: Math.ceil(total / limit) };
  }

  // Kho bài: lọc theo chữ (tiêu đề + nội dung), theo cộng đồng (tên, kể cả cộng đồng chưa lưu),
  // theo loại media; sắp theo điểm / bình luận / ngày đăng.
  async listPosts(params: RedditPostsQuery) {
    const { page, limit, skip } = pageParams(params.page, params.limit);
    const where: Prisma.ScraperRedditPostWhereInput = {};

    const q = (params.search || '').trim();
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { text: { contains: q, mode: 'insensitive' } },
      ];
    }
    const subreddit = normalizeSubredditName(params.subreddit || '');
    if (subreddit) where.subreddit_name = subreddit;
    if (params.media_type && params.media_type !== 'ALL') where.media_type = params.media_type;

    let orderBy: Prisma.ScraperRedditPostOrderByWithRelationInput = { score: 'desc' };
    if (params.sort_by === 'comments') orderBy = { comments_count: 'desc' };
    else if (params.sort_by === 'date') orderBy = { date_posted: 'desc' };

    const [total, items] = await Promise.all([
      this.prisma.scraperRedditPost.count({ where }),
      this.prisma.scraperRedditPost.findMany({ where, skip, take: limit, orderBy }),
    ]);
    return { items: items.map(serializeRedditPost), total, page, limit, total_pages: Math.ceil(total / limit) };
  }
}
