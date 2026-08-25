import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Nhánh Threads từng dùng cột `p.nickname` — cột KHÔNG tồn tại.
 *
 * Bảng `scraper_threads_profiles` đặt tên hiển thị ở cột `name` (xem model
 * ScraperThreadsProfile), khác với tiktok/kuaishou/bilibili/xiaohongshu/douyin — mấy bảng đó
 * mới có `nickname`. Postgres trả 42703, và vì trang Tổng quan kênh nội bộ mặc định gộp cả 5
 * nền tảng nên hỏng một nhánh là 500 nguyên trang.
 *
 * Bản test cũ của file này chỉ khẳng định `['nickname', …].toContain('nickname')` — một phép
 * so sánh với chính nó, xanh suốt trong khi SQL thật thì gãy. Nay soát thẳng mã nguồn.
 */
describe('SQL nhánh Threads — dùng đúng tên cột', () => {
  const SOURCE_FILES = [
    'owned-stats.service.ts',
    'owned-duplicate.service.ts',
    'scraper-aggregate-read.service.ts',
  ];

  const readSource = (file: string): string =>
    readFileSync(join(__dirname, '..', file), 'utf8');

  /** Các dòng SQL nằm trong một nhánh threads (nhận diện bằng bảng threads ở gần đó). */
  const threadsLines = (source: string): string[] => {
    const lines = source.split('\n');
    return lines.filter((line, i) => {
      const context = lines.slice(Math.max(0, i - 14), i + 16).join('\n');
      return /scraper_threads_(profiles|posts)/.test(context) && !/scraper_(tiktok|instagram|kuaishou|bilibili|douyin|xiaohongshu)_/.test(context);
    });
  };

  it.each(SOURCE_FILES)('%s: nhánh threads không đụng tới p.nickname', (file) => {
    const viPham = threadsLines(readSource(file)).filter((l) => l.includes('p.nickname'));
    expect(viPham).toEqual([]);
  });

  it.each(SOURCE_FILES)('%s: nhánh threads không đụng tới p.profile_id', (file) => {
    // `scraper_threads_profiles` khoá ngoài tên là `threads_user_id`, không phải `profile_id`.
    const viPham = threadsLines(readSource(file)).filter((l) => /\bp\.profile_id\b/.test(l));
    expect(viPham).toEqual([]);
  });

  it('các nền tảng thật sự có cột nickname thì vẫn được dùng bình thường', () => {
    const source = readSource('owned-stats.service.ts');
    expect(source).toMatch(/COALESCE\(NULLIF\(p\.nickname, ''\), p\.username\)/);
  });
});
