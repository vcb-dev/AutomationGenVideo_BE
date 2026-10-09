import { ConflictException } from '@nestjs/common';
import {
  mutateTaskPublishedLinks,
  publishedLinkKey,
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
