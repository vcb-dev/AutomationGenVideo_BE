import { ThreadsScraperReadService } from '../src/modules/threads-scraper/threads-scraper-read.service';

/**
 * GET scraper/threads/posts?topic_tag= — bấm "› trang sức" trên bài để lọc kho theo tag. Tag lưu
 * từ hai nguồn (tên hiển thị của Threads, tag người dùng gõ) nên so không phân biệt hoa thường.
 */

describe('ThreadsScraperReadService.listAllPosts — lọc theo tag', () => {
  function buildRead() {
    const prisma: any = {
      scraperThreadsPost: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    return { read: new ThreadsScraperReadService(prisma), prisma };
  }

  it('lọc không phân biệt hoa thường, bỏ #', async () => {
    const { read, prisma } = buildRead();
    await read.listAllPosts({ topic_tag: '#Trang sức' });
    const where = prisma.scraperThreadsPost.findMany.mock.calls[0][0].where;
    expect(where.topic_tag).toEqual({ equals: 'Trang sức', mode: 'insensitive' });
    expect(where.profile).toEqual({ is_owned: false });
  });

  it('không truyền tag thì không lọc', async () => {
    const { read, prisma } = buildRead();
    await read.listAllPosts({});
    expect(prisma.scraperThreadsPost.findMany.mock.calls[0][0].where).not.toHaveProperty('topic_tag');
  });
});
