import { HttpException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../src/modules/auth/decorators/roles.decorator';
import { ThreadsScraperController } from '../src/modules/threads-scraper/threads-scraper.controller';
import { ThreadsScraperService, normalizeTopicTag } from '../src/modules/threads-scraper/threads-scraper.service';

/**
 * Tìm bài Threads theo TAG CHỦ ĐỀ (dòng "người đăng › trang sức" trên bài) — POST
 * scraper/threads/search/tag. Phần làm THÊM, tìm theo từ khoá (search/top) giữ nguyên.
 *
 * Bảng tin của tag lấy cả bài gắn tag mà nội dung không nhắc chữ đó (kiểm chứng 2026-10-01: tag
 * "trang sức" ra 19 bài, 7 bài không có chữ "trang sức"). Nguồn là actor Apify tính phí theo bài.
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

describe('normalizeTopicTag', () => {
  it('bỏ #, gộp khoảng trắng, chữ thường', () => {
    expect(normalizeTopicTag('#Trang  Sức ')).toBe('trang sức');
    expect(normalizeTopicTag('   ')).toBe('');
  });
});

describe('ThreadsScraperService.searchTagPosts', () => {
  it('gọi AI theo tag đã chuẩn hoá, lưu bài kèm tag, trả bài kể cả bài không nhắc chữ "trang sức"', async () => {
    const aiClient = { searchTag: jest.fn().mockResolvedValue({ tag: 'trang sức', posts: [POST] }) };
    const { service, prisma } = buildService(aiClient);

    const res = await service.searchTagPosts('#Trang Sức', 20);

    expect(aiClient.searchTag).toHaveBeenCalledWith('trang sức', 20);
    expect(res.tag).toBe('trang sức');
    expect(res.posts).toHaveLength(1);
    expect(res.posts[0].text).not.toContain('trang sức');
    const created = prisma.scraperThreadsPost.create.mock.calls[0][0].data;
    expect(created.topic_tag).toBe('trang sức');
    expect(created.post_id).toBe(POST.post_id);
  });

  it('bài AI trả thiếu tag thì gắn tag đang tìm', async () => {
    const aiClient = { searchTag: jest.fn().mockResolvedValue({ tag: 'trang sức', posts: [{ ...POST, topic_tag: '' }] }) };
    const { service } = buildService(aiClient);
    const res = await service.searchTagPosts('trang sức', 20);
    expect(res.posts[0].topic_tag).toBe('trang sức');
  });

  it('tag rỗng → 400, không gọi AI (không tốn tiền)', async () => {
    const aiClient = { searchTag: jest.fn() };
    const { service } = buildService(aiClient);
    const err = await service.searchTagPosts('  # ', 20).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(400);
    expect(aiClient.searchTag).not.toHaveBeenCalled();
  });

  it('AI báo thiếu biến cấu hình → hiện nguyên câu kèm tên biến', async () => {
    const axiosErr = {
      isAxiosError: true,
      message: 'Request failed with status code 400',
      response: { status: 400, data: { error: 'Thiếu biến môi trường APIFY_ACTOR_THREADS_TAG' } },
    };
    const aiClient = { searchTag: jest.fn().mockRejectedValue(axiosErr) };
    const { service } = buildService(aiClient);

    const err = await service.searchTagPosts('trang sức', 20).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(400);
    expect(err.message).toContain('APIFY_ACTOR_THREADS_TAG');
  });
});

describe('Tìm theo từ khoá giữ nguyên', () => {
  it('searchHotPosts vẫn gọi search-top theo từ khoá, không gọi tag (không tốn phí Apify)', async () => {
    const aiClient = {
      searchTop: jest.fn().mockResolvedValue({ query: 'trang sức', posts: [] }),
      searchTag: jest.fn(),
    };
    const { service } = buildService(aiClient);
    await service.searchHotPosts('trang sức', 20);
    expect(aiClient.searchTop).toHaveBeenCalledWith('trang sức', 20);
    expect(aiClient.searchTag).not.toHaveBeenCalled();
  });
});

describe('ThreadsScraperController — search/tag', () => {
  it('chỉ ADMIN/LEADER (tính phí theo bài)', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, ThreadsScraperController.prototype.searchTag);
    expect(roles).toEqual([UserRole.ADMIN, UserRole.LEADER]);
  });

  it('kẹp số bài trong giới hạn chung trước khi gọi service', async () => {
    const service = { searchTagPosts: jest.fn().mockResolvedValue({ tag: 'trang sức', posts: [] }) };
    const controller = new ThreadsScraperController(service as any, {} as any);
    await controller.searchTag({ tag: 'trang sức', count: 99999 });
    expect(service.searchTagPosts).toHaveBeenCalledWith('trang sức', 1000);
  });

  it('tag rỗng → 400', async () => {
    const service = { searchTagPosts: jest.fn() };
    const controller = new ThreadsScraperController(service as any, {} as any);
    await expect(controller.searchTag({ tag: ' ' })).rejects.toBeInstanceOf(HttpException);
    expect(service.searchTagPosts).not.toHaveBeenCalled();
  });
});
