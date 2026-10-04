import { HttpException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../src/modules/auth/decorators/roles.decorator';
import { RedditScraperController } from '../src/modules/reddit-scraper/reddit-scraper.controller';
import { RedditScraperService } from '../src/modules/reddit-scraper/reddit-scraper.service';
import { normalizeSubredditName } from '../src/modules/reddit-scraper/reddit-input.util';
import { SUBREDDIT_INFO, aiError, aiPost, buildPrisma } from './reddit-fixtures';

/**
 * POST scraper/reddit/subreddits/scrape — cào bài của một cộng đồng (r/jewelry), lưu cộng đồng
 * vào danh sách để bấm cào lại. Không có cron (chốt 2026-10-01: chỉ cào khi bấm).
 */
describe('normalizeSubredditName', () => {
  it.each([
    ['r/Jewelry', 'jewelry'],
    ['/r/jewelry/', 'jewelry'],
    ['https://www.reddit.com/r/jewelry/top/?t=month', 'jewelry'],
    ['https://www.reddit.com/r/EngagementRings/s/AbCdEf', 'engagementrings'],
    ['https://old.reddit.com/r/jewelry/comments/1wj5qbf/x/', 'jewelry'],
    ['jewelry', 'jewelry'],
  ])('%s → %s', (raw, name) => {
    expect(normalizeSubredditName(raw)).toBe(name);
  });

  it.each(['u/someone', 'https://example.com', 'r/a', 'trang sức', ''])('%s → không hợp lệ', (raw) => {
    expect(normalizeSubredditName(raw)).toBe('');
  });
});

describe('RedditScraperController.scrapeSubreddit', () => {
  it('chỉ ADMIN/LEADER', () => {
    expect(Reflect.getMetadata(ROLES_KEY, RedditScraperController.prototype.scrapeSubreddit)).toEqual([
      UserRole.ADMIN,
      UserRole.LEADER,
    ]);
  });

  it('dán link → tên cộng đồng chuẩn hoá', async () => {
    const service = { scrapeSubreddit: jest.fn().mockResolvedValue({}) };
    const controller = new RedditScraperController(service as any, {} as any);
    await controller.scrapeSubreddit({ subreddit: 'https://www.reddit.com/r/Jewelry/', sort: 'HOT', time_range: 'all', count: 20 });
    expect(service.scrapeSubreddit).toHaveBeenCalledWith('jewelry', { sort: 'HOT', time_range: 'all', count: 20 });
  });

  it('link người dùng / tên sai → 400, không gọi TikHub', async () => {
    const service = { scrapeSubreddit: jest.fn() };
    const controller = new RedditScraperController(service as any, {} as any);
    const err = await controller.scrapeSubreddit({ subreddit: 'u/someone', sort: 'HOT', time_range: 'all' }).catch((e) => e);
    expect(err.getStatus()).toBe(400);
    expect(service.scrapeSubreddit).not.toHaveBeenCalled();
  });
});

describe('RedditScraperService.scrapeSubreddit', () => {
  const OPTIONS = { sort: 'HOT', time_range: 'all', count: 20 };

  it('lưu cộng đồng theo tên + bài gắn subreddit_id, trả số bài của cộng đồng', async () => {
    const prisma = buildPrisma();
    prisma.scraperRedditPost.count.mockResolvedValue(2);
    const aiClient = { subreddit: jest.fn().mockResolvedValue({ subreddit: SUBREDDIT_INFO, posts: [aiPost('a'), aiPost('b')] }) };

    const res = await new RedditScraperService(prisma, aiClient as any).scrapeSubreddit('jewelry', OPTIONS);

    expect(aiClient.subreddit).toHaveBeenCalledWith('jewelry', OPTIONS);
    const sub = prisma.scraperRedditSubreddit.upsert.mock.calls[0][0];
    expect(sub.where).toEqual({ name: 'jewelry' });
    expect(sub.update.subscribers_count).toBe(382636n);
    expect(sub.update.last_scraped_at).toBeInstanceOf(Date);
    const post = prisma.scraperRedditPost.upsert.mock.calls[0][0];
    expect(post.update.subreddit_id).toBe(1n);
    expect(post.update).not.toHaveProperty('search_keyword');
    expect(res.subreddit).toMatchObject({ name: 'jewelry', subscribers_count: 382636, posts_count: 2 });
    expect(res.posts).toHaveLength(2);
  });

  it('cộng đồng không tồn tại (AI 404) → 404 kèm câu của AI', async () => {
    const aiClient = { subreddit: jest.fn().mockRejectedValue(aiError(404, 'Không tìm thấy cộng đồng r/khongco trên Reddit')) };
    const prisma = buildPrisma();
    const err = await new RedditScraperService(prisma, aiClient as any).scrapeSubreddit('khongco', OPTIONS).catch((e) => e);
    expect(err.getStatus()).toBe(404);
    expect(err.getResponse().error).toContain('r/khongco');
    expect(prisma.scraperRedditSubreddit.upsert).not.toHaveBeenCalled();
  });
});
