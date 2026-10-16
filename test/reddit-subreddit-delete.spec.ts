import { HttpException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../src/modules/auth/decorators/roles.decorator';
import { RedditScraperController } from '../src/modules/reddit-scraper/reddit-scraper.controller';
import { RedditScraperService } from '../src/modules/reddit-scraper/reddit-scraper.service';
import { buildPrisma } from './reddit-fixtures';

/**
 * DELETE scraper/reddit/subreddits/:id — xoá cứng cộng đồng kèm bài (khoá ngoại Cascade), như xoá
 * kênh ở các nền tảng khác. Số bài phải ĐẾM TRƯỚC khi xoá (đếm sau thì Cascade đã dọn, luôn ra 0).
 */
describe('RedditScraperService.deleteSubreddit', () => {
  it('đếm bài trước rồi mới xoá, trả tên hiển thị', async () => {
    const prisma = buildPrisma();
    const order: string[] = [];
    prisma.scraperRedditSubreddit.findUnique.mockResolvedValue({ id: 3n, name: 'jewelry', display_name: 'r/jewelry' });
    prisma.scraperRedditPost.count.mockImplementation(async () => (order.push('count'), 17));
    prisma.scraperRedditSubreddit.delete.mockImplementation(async () => (order.push('delete'), {}));

    const res = await new RedditScraperService(prisma, {} as any).deleteSubreddit(3n);

    expect(order).toEqual(['count', 'delete']);
    expect(prisma.scraperRedditPost.count).toHaveBeenCalledWith({ where: { subreddit_id: 3n } });
    expect(res).toEqual({ deleted: true, id: 3, name: 'r/jewelry', videos_deleted: 17 });
  });

  it('không có → 404', async () => {
    const prisma = buildPrisma();
    prisma.scraperRedditSubreddit.findUnique.mockResolvedValue(null);
    const err = await new RedditScraperService(prisma, {} as any).deleteSubreddit(9n).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(404);
    expect(prisma.scraperRedditSubreddit.delete).not.toHaveBeenCalled();
  });
});

describe('RedditScraperController.deleteSubreddit', () => {
  it('chỉ ADMIN/LEADER', () => {
    expect(Reflect.getMetadata(ROLES_KEY, RedditScraperController.prototype.deleteSubreddit)).toEqual([
      UserRole.ADMIN,
      UserRole.LEADER,
    ]);
  });

  it('id không phải số → 400 thay vì lỗi BigInt 500', async () => {
    const service = { deleteSubreddit: jest.fn() };
    const controller = new RedditScraperController(service as any, {} as any);
    const err = await controller.deleteSubreddit('abc').catch((e) => e);
    expect(err.getStatus()).toBe(400);
    expect(service.deleteSubreddit).not.toHaveBeenCalled();
  });
});
