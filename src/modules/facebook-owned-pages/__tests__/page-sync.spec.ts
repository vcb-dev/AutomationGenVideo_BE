import {
  DELTA_MAX_POSTS,
  FacebookOwnedPagesService,
  coversSinceLastSync,
  deltaSince,
} from '../facebook-owned-pages.service';

/**
 * Delta sync cào theo mốc thời gian thay vì N bài mới nhất. Mốc `last_synced_at` chỉ dời lên khi đã
 * lưu xong và lượt cào phủ trọn từ mốc cũ tới hiện tại.
 */
const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-09-29T00:00:00.000Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);

describe('deltaSince — mốc cào của delta', () => {
  it('lùi 2 ngày trước lần sync thành công gần nhất', () => {
    expect(deltaSince(daysAgo(1), now)).toEqual(daysAgo(3));
  });

  it('sự cố kéo dài 12 ngày ⇒ lượt chạy được đầu tiên cào lại cả 12 ngày (+2)', () => {
    expect(deltaSince(daysAgo(12), now)).toEqual(daysAgo(14));
  });

  it('chưa từng sync ⇒ lùi 2 ngày tính từ bây giờ', () => {
    expect(deltaSince(null, now)).toEqual(daysAgo(2));
  });

  it('page lâu không sync ⇒ chỉ lùi tối đa 30 ngày (xa hơn dùng Backfill)', () => {
    expect(deltaSince(daysAgo(90), now)).toEqual(daysAgo(30));
  });
});

describe('coversSinceLastSync — lượt cào có được dời mốc delta không', () => {
  it.each([
    ['cào từ trước mốc tới hiện tại', daysAgo(1), { since: daysAgo(3) }, true],
    ['since sau mốc cũ ⇒ hở khoảng giữa', daysAgo(5), { since: daysAgo(3) }, false],
    ['khoảng kết thúc trong quá khứ (lọc tháng trước)', daysAgo(1), { since: daysAgo(40), until: daysAgo(20) }, false],
    ['chưa có mốc', null, { since: daysAgo(3) }, true],
    ['không cào theo khoảng (10 bài mới nhất)', daysAgo(1), undefined, false],
  ])('%s', (_label, last, range, expected) => {
    expect(coversSinceLastSync(last as Date | null, range as any, now)).toBe(expected);
  });
});

describe('FacebookOwnedPagesService.syncPage / deltaSyncAllPages — cào theo khoảng', () => {
  let prisma: any;
  let aiClient: { fetchPageSync: jest.Mock };
  let service: FacebookOwnedPagesService;
  const PAGE = {
    id: 54n,
    page_id: '794930557036421',
    name: 'HuyK - Trang Sức Đá Quý',
    page_access_token: 'enc',
    last_synced_at: new Date(Date.now() - 1 * DAY),
    last_scraped_at: new Date(Date.now() - 1 * DAY),
  };
  const video = (postId: string) => ({
    post_id: postId, caption: 'c', published_at: '2026-09-28T10:00:00Z', permalink_url: `https://www.facebook.com/reel/${postId}/`,
    thumbnail_url: '', video_url: '', view_count: 1, like_count: 0, comment_count: 0, share_count: 0, raw_data: {},
  });

  beforeEach(() => {
    prisma = {
      video_management_managedfacebookpage: {
        findUnique: jest.fn().mockResolvedValue(PAGE),
        findMany: jest.fn().mockResolvedValue([PAGE]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockResolvedValue({}),
      },
      video_management_ownedvideocontent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    aiClient = {
      fetchPageSync: jest.fn().mockResolvedValue({ page_metadata: { name: PAGE.name }, videos: [video('1'), video('2')] }),
    };
    service = new FacebookOwnedPagesService(prisma, aiClient as any);
  });

  /** Lần ghi metadata page (có name) — nơi quyết định dời mốc last_synced_at. */
  const metadataWrite = () =>
    prisma.video_management_managedfacebookpage.update.mock.calls
      .map((c: any[]) => c[0].data)
      .find((d: any) => 'name' in d);

  it('delta cron: gửi since = mốc cũ − 2 ngày, trần DELTA_MAX_POSTS, lưu video rồi mới dời mốc', async () => {
    const out = await service.deltaSyncAllPages();

    expect(out).toEqual({ total: 1, done: 1, failed: 0 });
    const [pageId, token, maxPosts, range] = aiClient.fetchPageSync.mock.calls[0];
    expect([pageId, token, maxPosts]).toEqual([PAGE.page_id, 'enc', DELTA_MAX_POSTS]);
    expect(range.since).toEqual(new Date(PAGE.last_synced_at.getTime() - 2 * DAY));
    expect(prisma.video_management_ownedvideocontent.create).toHaveBeenCalledTimes(2);
    expect(metadataWrite().last_synced_at).toBeInstanceOf(Date);
  });

  it('lưu video lỗi giữa chừng ⇒ KHÔNG dời mốc (lần sau delta cào lại từ mốc cũ)', async () => {
    prisma.video_management_ownedvideocontent.create.mockRejectedValueOnce(new Error('db down'));

    await expect(service.syncPageDelta(PAGE)).rejects.toThrow('db down');

    expect(metadataWrite()).toBeUndefined();
    expect(prisma.video_management_managedfacebookpage.update.mock.calls.at(-1)[0].data).toMatchObject({
      is_scraping: false,
      scrape_error: 'db down',
    });
  });

  it('nút "Cập nhật" lọc tháng trước ⇒ lưu video nhưng không dời mốc delta', async () => {
    await service.syncPage(PAGE.page_id, 500, {
      since: new Date('2026-08-27T17:00:00.000Z'),
      until: new Date('2026-09-08T17:00:00.000Z'),
    });

    expect(prisma.video_management_ownedvideocontent.create).toHaveBeenCalledTimes(2);
    expect(metadataWrite()).not.toHaveProperty('last_synced_at');
  });

  it('không truyền khoảng (10 bài mới nhất) ⇒ không dời mốc delta', async () => {
    await service.syncPage(PAGE.page_id, 10);

    expect(aiClient.fetchPageSync.mock.calls[0][3]).toBeUndefined();
    expect(metadataWrite()).not.toHaveProperty('last_synced_at');
  });
});

/**
 * Batch đầu của backfill hỏng thì phần nền không chạy → phải tự mở khoá, nếu không page kẹt
 * is_scraping=true 30 phút mà UI không báo lỗi.
 */
describe('FacebookOwnedPagesService.backfillPageSync — mở khoá khi lỗi', () => {
  let prisma: any;
  let aiClient: { fetchPageBackfill: jest.Mock };
  let service: FacebookOwnedPagesService;

  beforeEach(() => {
    prisma = {
      video_management_managedfacebookpage: {
        findUnique: jest.fn().mockResolvedValue({ id: 86n, page_id: '148888379055195', page_access_token: 'enc' }),
        update: jest.fn().mockResolvedValue({}),
      },
      video_management_ownedvideocontent: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    aiClient = { fetchPageBackfill: jest.fn() };
    service = new FacebookOwnedPagesService(prisma, aiClient as any);
  });

  const lanGhiCuoi = () => prisma.video_management_managedfacebookpage.update.mock.calls.at(-1)[0].data;

  it('AI lỗi thì mở khoá, ghi scrape_error rồi ném lỗi tiếp cho controller', async () => {
    const err: any = new Error('Request failed with status code 502');
    err.response = { data: { error: 'Facebook Graph API: Invalid OAuth access token' } };
    aiClient.fetchPageBackfill.mockRejectedValue(err);

    await expect(service.backfillPageSync('148888379055195', 20)).rejects.toBe(err);

    expect(lanGhiCuoi()).toMatchObject({
      is_scraping: false,
      scrape_error: 'Facebook Graph API: Invalid OAuth access token',
    });
  });

  it('thành công thì GIỮ khoá cho phần nền chạy tiếp (không đổi hành vi cũ)', async () => {
    aiClient.fetchPageBackfill.mockResolvedValue({ videos: [] });

    await expect(service.backfillPageSync('148888379055195', 20)).resolves.toEqual({ created: 0, updated: 0 });

    expect(lanGhiCuoi()).toMatchObject({ is_scraping: true });
  });
});
