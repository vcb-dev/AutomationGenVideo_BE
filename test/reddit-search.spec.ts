import { HttpException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../src/modules/auth/decorators/roles.decorator';
import { RedditScraperController } from '../src/modules/reddit-scraper/reddit-scraper.controller';
import { RedditScraperService } from '../src/modules/reddit-scraper/reddit-scraper.service';
import { aiError, aiPost, buildPrisma } from './reddit-fixtures';

/**
 * POST scraper/reddit/search — tìm bài Reddit theo từ khoá (AI → TikHub, $0.001/lượt ~7 bài),
 * lưu vào kho. Bài tìm theo từ khoá không gắn cộng đồng đã lưu và không xoá liên kết đã có.
 */
describe('RedditScraperController.search', () => {
  it('chỉ ADMIN/LEADER (gọi TikHub tính phí)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, RedditScraperController.prototype.search)).toEqual([
      UserRole.ADMIN,
      UserRole.LEADER,
    ]);
  });

  it('chuẩn hoá sort / time_range, kẹp số bài trước khi gọi service', async () => {
    const service = { searchPosts: jest.fn().mockResolvedValue({ query: 'ring', posts: [] }) };
    const controller = new RedditScraperController(service as any, {} as any);
    await controller.search({ query: ' engagement ring ', sort: 'top', time_range: 'MONTH', count: 99999 });
    expect(service.searchPosts).toHaveBeenCalledWith('engagement ring', { sort: 'TOP', time_range: 'month', count: 1000 });
  });

  it.each([
    [{ query: ' ', sort: 'TOP', time_range: 'month' }],
    [{ query: 'ring', sort: 'BEST', time_range: 'month' }],
    [{ query: 'ring', sort: 'TOP', time_range: 'decade' }],
    [{ query: 'ring' }],
  ])('đầu vào sai → 400, không gọi TikHub: %j', async (body) => {
    const service = { searchPosts: jest.fn() };
    const controller = new RedditScraperController(service as any, {} as any);
    const err = await controller.search(body as any).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(400);
    expect(service.searchPosts).not.toHaveBeenCalled();
  });
});

describe('RedditScraperService.searchPosts', () => {
  const OPTIONS = { sort: 'TOP', time_range: 'month', count: 20 };

  it('lưu bài theo post_id kèm từ khoá, không gắn subreddit_id, trả số liệu dạng số + ngày ISO', async () => {
    const prisma = buildPrisma();
    const aiClient = { search: jest.fn().mockResolvedValue({ query: 'ring', posts: [aiPost('1we5wfx', { search_keyword: 'ring' })] }) };
    const service = new RedditScraperService(prisma, aiClient as any);

    const res = await service.searchPosts('ring', OPTIONS);

    expect(aiClient.search).toHaveBeenCalledWith('ring', OPTIONS);
    const args = prisma.scraperRedditPost.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ post_id: '1we5wfx' });
    expect(args.update).not.toHaveProperty('subreddit_id');
    expect(args.update.search_keyword).toBe('ring');
    expect(args.update.score).toBe(5444n);
    expect(res.posts[0]).toMatchObject({ post_id: '1we5wfx', score: 5444, comments_count: 120, subreddit_name: 'jewelry' });
    expect(res.posts[0].date_posted).toBe('2026-09-27T20:46:38.752Z');
  });

  it('bỏ bài thiếu post_id / tiêu đề', async () => {
    const prisma = buildPrisma();
    const aiClient = { search: jest.fn().mockResolvedValue({ posts: [aiPost(''), aiPost('b', { title: '' }), aiPost('c')] }) };
    const res = await new RedditScraperService(prisma, aiClient as any).searchPosts('ring', OPTIONS);
    expect(res.posts.map((p) => p.post_id)).toEqual(['c']);
  });

  it('AI báo lỗi (thiếu biến TikHub / TikHub từ chối khoá) → hiện nguyên câu, không nuốt', async () => {
    const aiClient = { search: jest.fn().mockRejectedValue(aiError(400, 'Thiếu biến môi trường TIKHUB_API_KEY')) };
    const err = await new RedditScraperService(buildPrisma(), aiClient as any).searchPosts('ring', OPTIONS).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(400);
    expect(err.getResponse().error).toContain('TIKHUB_API_KEY');
  });
});
