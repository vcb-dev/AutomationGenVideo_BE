import { ConflictException } from '@nestjs/common';
import {
  isShortVideoKey,
  mutateTaskPublishedLinks,
  publishedLinkError,
  publishedLinkKey,
  publishedVideoKey,
  videoKeySearchToken,
  withFetchedStats,
} from '../task-published-links.util';

const FB = { id: 'l1', platform: 'Facebook', url: 'https://facebook.com/reel/1' };
const YT = { id: 'l2', platform: 'YouTube', url: 'https://youtube.com/watch?v=2' };

/** 1 task trong "DB" giả: ghi chỉ thành công khi updated_at chưa đổi kể từ lúc đọc, như Postgres. */
function fakeDb(initialLinks: any[] | null) {
  let row: { published_links: any; updated_at: Date } | null = {
    published_links: initialLinks,
    updated_at: new Date(1),
  };
  let tick = 1;
  const db = {
    task: {
      findUnique: jest.fn(async () => (row ? { ...row } : null)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (!row || row.updated_at.getTime() !== where.updated_at.getTime()) return { count: 0 };
        row = { published_links: data.published_links, updated_at: new Date(++tick) };
        return { count: 1 };
      }),
    },
  };
  return {
    db: db as any,
    /** Nơi khác ghi xen vào (vd user nộp link) — đổi updated_at như Prisma @updatedAt. */
    concurrentWrite: (links: any[]) => {
      row = { published_links: links, updated_at: new Date(++tick) };
    },
    remove: () => {
      row = null;
    },
    links: () => row?.published_links,
  };
}

describe('mutateTaskPublishedLinks', () => {
  it('bị ghi xen giữa lúc đọc và lúc ghi → đọc lại bản mới nhất, giữ link nơi khác vừa thêm', async () => {
    const store = fakeDb([FB]);
    const fetched = new Map([[publishedLinkKey(FB), { views: 500 }]]);
    let calls = 0;

    const result = await mutateTaskPublishedLinks(store.db, 'task-1', (current) => {
      // Lần gọi đầu: trong lúc "đang cào", user nộp thêm link YouTube.
      if (calls++ === 0) store.concurrentWrite([FB, YT]);
      return withFetchedStats(current, fetched);
    });

    expect(result).toEqual({ changed: true, links: [{ ...FB, stats: { views: 500 } }, YT] });
    expect(store.links()).toEqual([{ ...FB, stats: { views: 500 } }, YT]);
    expect(store.db.task.updateMany).toHaveBeenCalledTimes(2);
  });

  it('ghi kèm điều kiện updated_at đã đọc', async () => {
    const store = fakeDb([]);
    await mutateTaskPublishedLinks(store.db, 'task-1', (current) => [...current, FB]);

    expect(store.db.task.updateMany).toHaveBeenCalledWith({
      where: { id: 'task-1', updated_at: new Date(1) },
      data: { published_links: [FB] },
    });
  });

  it('mutate trả null → không ghi, trả danh sách hiện tại', async () => {
    const store = fakeDb([FB]);
    const result = await mutateTaskPublishedLinks(store.db, 'task-1', () => null);

    expect(result).toEqual({ changed: false, links: [FB] });
    expect(store.db.task.updateMany).not.toHaveBeenCalled();
  });

  it('published_links null → mutate nhận mảng rỗng', async () => {
    const store = fakeDb(null);
    const mutate = jest.fn(() => [FB]);
    await mutateTaskPublishedLinks(store.db, 'task-1', mutate);

    expect(mutate).toHaveBeenCalledWith([]);
    expect(store.links()).toEqual([FB]);
  });

  it('task đã bị xoá → null, không ghi', async () => {
    const store = fakeDb([FB]);
    store.remove();

    await expect(mutateTaskPublishedLinks(store.db, 'task-1', () => [YT])).resolves.toBeNull();
    expect(store.db.task.updateMany).not.toHaveBeenCalled();
  });

  it('bị ghi xen liên tục → ConflictException sau 5 lần thử, không ghi đè', async () => {
    const store = fakeDb([FB]);
    const mutate = jest.fn((current: any[]) => {
      store.concurrentWrite([...current]);
      return [...current, YT];
    });

    await expect(mutateTaskPublishedLinks(store.db, 'task-1', mutate)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(mutate).toHaveBeenCalledTimes(5);
    expect(store.links()).toEqual([FB]);
  });
});

describe('withFetchedStats', () => {
  it('gắn số liệu vào đúng link, giữ nguyên link không được cào', () => {
    const fetched = new Map([[publishedLinkKey(FB), { views: 500 }]]);

    expect(withFetchedStats([FB, YT], fetched)).toEqual([{ ...FB, stats: { views: 500 } }, YT]);
  });

  it('link bị xoá hoặc sửa url trong lúc cào → không gắn số liệu cũ vào, trả null nếu không còn gì để gắn', () => {
    const fetched = new Map([[publishedLinkKey(FB), { views: 500 }]]);
    const editedUrl = { ...FB, url: 'https://facebook.com/reel/khac' };

    expect(withFetchedStats([YT], fetched)).toBeNull();
    expect(withFetchedStats([editedUrl], fetched)).toBeNull();
  });
});

describe('publishedVideoKey', () => {
  it.each([
    ['https://www.facebook.com/reel/1376370697349012', 'FACEBOOK:1376370697349012'],
    ['https://m.facebook.com/reel/1376370697349012/?mibextid=abc', 'FACEBOOK:1376370697349012'],
    ['https://www.facebook.com/huykjewelry/videos/1376370697349012/', 'FACEBOOK:1376370697349012'],
    ['https://www.facebook.com/huykjewelry/videos/vong-tay-bac/1376370697349012/', 'FACEBOOK:1376370697349012'],
    ['https://www.facebook.com/watch/?v=1376370697349012', 'FACEBOOK:1376370697349012'],
    ['https://facebook.com/1991689688210673', 'FACEBOOK:1991689688210673'],
    ['https://www.facebook.com/108765432123456_1376370697349012', 'FACEBOOK:1376370697349012'],
    ['https://www.facebook.com/huykjewelry/posts/pfbid02q5FabcXYZ', 'FACEBOOK:pfbid02q5FabcXYZ'],
    ['https://www.facebook.com/share/r/1KyNyNv88v/', 'FACEBOOK:short-1KyNyNv88v'],
    ['https://www.instagram.com/reel/DdVs0emlJQt/', 'INSTAGRAM:DdVs0emlJQt'],
    ['https://www.instagram.com/huyknghenhantrangsuc/reel/DdVs0emlJQt/', 'INSTAGRAM:DdVs0emlJQt'],
    ['https://www.instagram.com/p/DcTSj3tmi7p/', 'INSTAGRAM:DcTSj3tmi7p'],
    ['https://www.tiktok.com/@nhannhan.thoda/video/7681272721812000021?is_from_webapp=1', 'TIKTOK:7681272721812000021'],
    ['https://vt.tiktok.com/ZSabc123/', 'TIKTOK:short-ZSabc123'],
    ['https://youtube.com/shorts/dQw4w9WgXcQ', 'YOUTUBE:dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=x', 'YOUTUBE:dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'YOUTUBE:dQw4w9WgXcQ'],
    ['https://www.threads.net/@huyk/post/DAbc123xyz', 'THREADS:DAbc123xyz'],
    ['https://shopee.vn/video/abc/', 'URL:shopee.vn/video/abc'],
  ])('%s → %s', (url, key) => {
    expect(publishedVideoKey(url)).toBe(key);
  });

  it.each([
    'https://www.facebook.com/huykjewelry',
    'https://www.facebook.com/profile.php?id=100012345678',
    'https://www.instagram.com/nhannhan.04/',
    'https://www.tiktok.com/@huykjewelry1',
    'https://www.youtube.com/@huyk',
    'facebook.com/reel/1376370697349012',
    'không phải link',
  ])('không ra video cụ thể → null: %s', (url) => {
    expect(publishedVideoKey(url)).toBeNull();
  });

  it('khoá link rút gọn lọc thô bằng mã chia sẻ, khoá thường bằng chính id', () => {
    expect(isShortVideoKey('FACEBOOK:short-1KyNyNv88v')).toBe(true);
    expect(videoKeySearchToken('FACEBOOK:short-1KyNyNv88v')).toBe('1KyNyNv88v');
    expect(isShortVideoKey('URL:short-link.vn/a')).toBe(false);
    expect(videoKeySearchToken('URL:shopee.vn/video/short-abc')).toBe('shopee.vn/video/short-abc');
  });
});

describe('publishedLinkError', () => {
  it.each([
    ['Facebook', 'https://www.facebook.com/reel/1376370697349012'],
    ['facebook', 'https://www.facebook.com/share/r/1KyNyNv88v/'],
    ['Instagram', 'https://www.instagram.com/huyknghenhantrangsuc/reel/DdVs0emlJQt/'],
    ['TikTok', 'https://www.tiktok.com/@chungthoda/video/7672401752959814930'],
    ['YouTube', 'https://youtube.com/shorts/dQw4w9WgXcQ'],
    ['Threads', 'https://www.threads.net/@huyk/post/DAbc123xyz'],
    ['Shopee', 'https://shopee.vn/video/abc'],
  ])('hợp lệ: %s %s', (platform, url) => {
    expect(publishedLinkError(platform, url)).toBeNull();
  });

  it('nhãn Instagram nhưng dán link TikTok → báo đúng nền tảng của link', () => {
    expect(
      publishedLinkError('Instagram', 'https://www.tiktok.com/@huyk.xuongchetac2/video/7610704678313037063'),
    ).toMatch(/là link TikTok, không phải Instagram/);
  });

  it('nền tảng tự gõ nhưng link thuộc nền tảng đã hỗ trợ → bắt chọn đúng nền tảng', () => {
    expect(publishedLinkError('Facebook Reels', 'https://www.facebook.com/reel/1376370697349012')).toMatch(
      /chọn nền tảng Facebook/,
    );
  });

  it('chọn Facebook nhưng dán link trang web khác', () => {
    expect(publishedLinkError('Facebook', 'https://shopee.vn/video/abc')).toMatch(/không phải link Facebook/);
  });

  it('link trang/kênh thay vì 1 video', () => {
    expect(publishedLinkError('Facebook', 'https://www.facebook.com/huykjewelry')).toMatch(
      /không trỏ tới một video Facebook cụ thể/,
    );
    expect(publishedLinkError('TikTok', 'https://www.tiktok.com/@huykjewelry1')).toMatch(/video TikTok cụ thể/);
  });

  it('không phải URL http(s)', () => {
    expect(publishedLinkError('Facebook', 'abc')).toMatch(/không hợp lệ/);
    expect(publishedLinkError('Khác', 'ftp://files.vn/a.mp4')).toMatch(/không hợp lệ/);
  });
});
