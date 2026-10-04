import { ThreadsScraperService } from '../src/modules/threads-scraper/threads-scraper.service';

/**
 * Cột scraper_threads_posts.topic_tag (migration 20261001100000): ghi tag khi nguồn có trả (tìm
 * theo tag, tìm từ khoá qua crawl web). Cào theo kênh qua TikHub không bao giờ trả tag — không
 * được ghi '' đè mất tag đã biết.
 */

const POST = {
  post_id: '3856384667229985340',
  shortcode: 'DWEoWw_gZo8',
  url: 'https://www.threads.net/@ph.anhhhhdayyy/post/X2',
  text: 'Cơ địa hợp bạccc',
  media_type: 'TEXT',
  thumbnail_url: '',
  video_url: '',
  views_count: 0,
  likes_count: 2515,
  replies_count: 58,
  reposts_count: 0,
  quotes_count: 0,
  date_posted: '2026-09-03T00:00:00+00:00',
  author_username: 'ph.anhhhhdayyy',
  author_name: 'ph.anhhhhdayyy',
  author_avatar: '',
  topic_tag: 'trang sức',
};

function buildService(aiClient: any) {
  const prisma: any = {
    scraperThreadsProfile: {
      findUnique: jest.fn().mockResolvedValue({ id: 5n, username: 'ph.anhhhhdayyy' }),
      upsert: jest.fn().mockResolvedValue({ id: 5n, username: 'ph.anhhhhdayyy' }),
      create: jest.fn().mockResolvedValue({ id: 5n, username: 'ph.anhhhhdayyy' }),
    },
    scraperThreadsPost: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  return { service: new ThreadsScraperService(prisma, aiClient), prisma };
}

describe('ThreadsScraperService.upsertPost — cột topic_tag', () => {
  it('ghi tag khi nguồn có trả', async () => {
    const { service, prisma } = buildService({});
    await service.upsertPost(5n, POST as any);
    expect(prisma.scraperThreadsPost.create.mock.calls[0][0].data.topic_tag).toBe('trang sức');
  });

  it('cào lại theo kênh (TikHub không trả tag) KHÔNG xoá tag đã biết', async () => {
    const { service, prisma } = buildService({});
    prisma.scraperThreadsPost.findUnique.mockResolvedValue({ post_id: POST.post_id, topic_tag: 'trang sức' });
    await service.upsertPost(5n, { ...POST, topic_tag: '' } as any);
    const data = prisma.scraperThreadsPost.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('topic_tag');
  });
});
