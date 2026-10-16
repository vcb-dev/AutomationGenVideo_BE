import { RedditScraperReadService } from '../src/modules/reddit-scraper/reddit-scraper-read.service';
import { buildPrisma } from './reddit-fixtures';

/**
 * GET scraper/reddit/posts và GET scraper/reddit/subreddits — kho bài Reddit đã lưu và danh sách
 * cộng đồng đã lưu (chỉ đọc, mọi vai trò xem được).
 */
const ROW = {
  id: 7n,
  post_id: '1wj5qbf',
  subreddit_id: 3n,
  subreddit_name: 'jewelry',
  title: 'Update on the ring',
  text: '1,100 comments...',
  url: 'https://www.reddit.com/r/jewelry/comments/1wj5qbf/x/',
  link_url: null,
  author: 'Icy-Air7918',
  author_avatar: null,
  media_type: 'IMAGE',
  thumbnail_url: 'https://preview.redd.it/t.jpeg',
  video_url: null,
  score: 6641n,
  comments_count: 363n,
  upvote_ratio: 0.95,
  is_nsfw: false,
  search_keyword: 'engagement ring',
  date_posted: new Date('2026-09-17T10:00:00Z'),
  created_at: new Date('2026-10-01T00:00:00Z'),
  updated_at: new Date('2026-10-01T00:00:00Z'),
};

describe('RedditScraperReadService.listPosts', () => {
  it('mặc định sắp theo điểm, trang 1 cỡ 24; trả số và ngày ISO', async () => {
    const prisma = buildPrisma();
    prisma.scraperRedditPost.count.mockResolvedValue(1);
    prisma.scraperRedditPost.findMany.mockResolvedValue([ROW]);

    const res = await new RedditScraperReadService(prisma).listPosts({});

    const args = prisma.scraperRedditPost.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ where: {}, skip: 0, take: 24, orderBy: { score: 'desc' } });
    expect(res).toMatchObject({ total: 1, page: 1, limit: 24, total_pages: 1 });
    expect(res.items[0]).toMatchObject({ id: 7, subreddit_id: 3, score: 6641, comments_count: 363, date_posted: '2026-09-17T10:00:00.000Z' });
  });

  it('lọc chữ (tiêu đề + nội dung), cộng đồng (nhận cả link), loại media; sắp theo bình luận', async () => {
    const prisma = buildPrisma();
    await new RedditScraperReadService(prisma).listPosts({
      search: ' ring ',
      subreddit: 'https://www.reddit.com/r/Jewelry/',
      media_type: 'VIDEO',
      sort_by: 'comments',
      page: 3,
      limit: 500,
    });
    const args = prisma.scraperRedditPost.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      OR: [{ title: { contains: 'ring', mode: 'insensitive' } }, { text: { contains: 'ring', mode: 'insensitive' } }],
      subreddit_name: 'jewelry',
      media_type: 'VIDEO',
    });
    expect(args.orderBy).toEqual({ comments_count: 'desc' });
    expect(args.take).toBe(100);
    expect(args.skip).toBe(200);
  });

  it('media_type ALL không lọc; sort_by date theo ngày đăng', async () => {
    const prisma = buildPrisma();
    await new RedditScraperReadService(prisma).listPosts({ media_type: 'ALL', sort_by: 'date' });
    const args = prisma.scraperRedditPost.findMany.mock.calls[0][0];
    expect(args.where).toEqual({});
    expect(args.orderBy).toEqual({ date_posted: 'desc' });
  });
});

describe('RedditScraperReadService.listSubreddits', () => {
  it('kèm số bài mỗi cộng đồng, tìm theo tên / tiêu đề', async () => {
    const prisma = buildPrisma();
    prisma.scraperRedditSubreddit.count.mockResolvedValue(1);
    prisma.scraperRedditSubreddit.findMany.mockResolvedValue([
      {
        id: 3n, name: 'jewelry', display_name: 'r/jewelry', title: 'JEWELRY', description: '', icon_url: null,
        subscribers_count: 382636n, is_nsfw: false, last_scraped_at: new Date('2026-10-01T10:30:00Z'),
        created_at: new Date('2026-10-01T10:30:00Z'), updated_at: new Date(), _count: { posts: 10 },
      },
    ]);

    const res = await new RedditScraperReadService(prisma).listSubreddits({ search: 'jew' });

    const args = prisma.scraperRedditSubreddit.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      OR: [{ name: { contains: 'jew', mode: 'insensitive' } }, { title: { contains: 'jew', mode: 'insensitive' } }],
    });
    expect(args.include).toEqual({ _count: { select: { posts: true } } });
    expect(res.items[0]).toMatchObject({ id: 3, subscribers_count: 382636, posts_count: 10, last_scraped_at: '2026-10-01T10:30:00.000Z' });
  });
});
