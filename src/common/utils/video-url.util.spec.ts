import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { extractVideoId, detectPlatformFromUrl } from './video-url.util';

/**
 * Mã video là khoá của cả hệ thống: khớp với video đã cào (scraper_*_videos.post_id), chống
 * trùng trong bộ sưu tập, và là tham số gọi TikHub lấy số liệu. Từng có sự cố lưu NGUYÊN CẢ
 * ĐƯỜNG LINK vào chỗ mã → bản ghi rác không bao giờ khớp được với dữ liệu cào.
 *
 * Bộ mẫu này tồn tại ở BA nơi (BE, FE video-library/page.tsx, extension content.js). Lệch
 * nhau thì cùng một video sẽ mang hai mã khác nhau — nên có hẳn một test đối chiếu bên dưới.
 */
const CASES: Array<[url: string, platform: string, id: string]> = [
  ['https://www.douyin.com/video/7659675415467902374', 'douyin', '7659675415467902374'],
  ['https://www.douyin.com/user/MS4wLjABAAAA?modal_id=7659675415467902374', 'douyin', '7659675415467902374'],
  ['https://www.douyin.com/user/MS4wLjABAAAAz42cfCPglOxaau85y1G-', 'douyin', ''],
  ['https://www.tiktok.com/@mrbeast/video/7412345678901234567', 'tiktok', '7412345678901234567'],
  ['https://www.tiktok.com/@mrbeast', 'tiktok', ''],
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
  ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'youtube', 'dQw4w9WgXcQ'],
  ['https://www.youtube.com/shorts/AbCdEfGhIjK', 'youtube', 'AbCdEfGhIjK'],
  ['https://www.youtube.com/@MixiGaming3con', 'youtube', ''],
  ['https://www.bilibili.com/video/BV1GJ411x7h7', 'bilibili', 'BV1GJ411x7h7'],
  ['https://www.bilibili.com/video/av170001', 'bilibili', 'av170001'],
  ['https://www.xiaohongshu.com/explore/65a1b2c3d4e5f60700000001?xsec_token=X', 'xiaohongshu', '65a1b2c3d4e5f60700000001'],
  ['https://www.xiaohongshu.com/user/profile/5f8a1b2c3d4e5f6070000001', 'xiaohongshu', ''],
  ['https://www.kuaishou.com/short-video/3xabcdef12345678', 'kuaishou', '3xabcdef12345678'],
  ['https://www.instagram.com/reel/C1a2B3c4D5e/', 'instagram', 'C1a2B3c4D5e'],
  ['https://www.instagram.com/p/C1a2B3c4D5e/', 'instagram', 'C1a2B3c4D5e'],
  ['https://www.instagram.com/mrbeast/', 'instagram', ''],
  ['https://www.facebook.com/watch?v=1234567890123', 'facebook', '1234567890123'],
  ['https://www.facebook.com/somepage/videos/1234567890123', 'facebook', '1234567890123'],
  ['https://www.facebook.com/reel/1234567890123', 'facebook', '1234567890123'],
  ['https://example.com/some/video', '', ''],
];

describe('video-url.util — bóc mã video từ link', () => {
  it.each(CASES)('%s → %s / %s', (url, platform, id) => {
    expect(detectPlatformFromUrl(url)).toBe(platform);
    expect(extractVideoId(url)).toBe(id);
  });

  it('link trang cá nhân của MỌI nền tảng đều phải trả rỗng (không đề xuất bừa)', () => {
    const profileUrls = CASES.filter(([, p, i]) => p && !i).map(([u]) => u);
    expect(profileUrls.length).toBeGreaterThanOrEqual(4);
    for (const u of profileUrls) expect(extractVideoId(u)).toBe('');
  });

  it('chuỗi rỗng / rác → không nổ, trả rỗng', () => {
    for (const bad of ['', '   ', 'khong-phai-link', 'javascript:alert(1)']) {
      expect(extractVideoId(bad)).toBe('');
      expect(detectPlatformFromUrl(bad)).toBe('');
    }
  });
});

/**
 * Đối chiếu với bản phía FE bằng HÀNH VI (không so văn bản regex — quá mong manh).
 *
 * Đây là test đáng giá nhất của file này: bộ mẫu tồn tại ở ba nơi (BE, FE, extension). Sửa
 * một nơi mà quên hai nơi kia thì cùng một video sinh ra hai mã khác nhau, dedup vô hiệu và
 * dữ liệu đề xuất không khớp được với dữ liệu đã cào.
 *
 * FE ≡ BE kiểm ở đây; extension ≡ FE đã kiểm ở bộ test riêng của extension — bắc cầu ra cả ba.
 */
describe('video-url.util — bản BE và bản FE phải cho cùng kết quả', () => {
  const FE_PAGE = path.resolve(
    __dirname,
    '../../../../AutomationGenVideo_FE/src/app/dashboard/video-library/page.tsx',
  );

  /** Cắt hàm extractVideoId trong page.tsx ra chạy (là TS thuần, bỏ vài chú thích kiểu là chạy được). */
  function loadFeExtractor(): ((url: string) => string) | null {
    if (!fs.existsSync(FE_PAGE)) return null;
    const src = fs.readFileSync(FE_PAGE, 'utf8');
    const start = src.indexOf('const VIDEO_ID_PATTERNS');
    const end = src.indexOf('// ─── Video Card');
    if (start < 0 || end < 0) return null;
    const snippet = src
      .slice(start, end)
      .replace(/:\s*Array<\[RegExp, RegExp\[\]\]>/, '')
      .replace(/\(url: string\): string/g, '(url)')
      .replace(/\(url: string\): boolean/g, '(url)')
      .replace(/m\?\.\[1\]/g, '(m && m[1])');
    const sandbox: any = { module: { exports: {} } };
    vm.createContext(sandbox);
    vm.runInContext(`${snippet}
module.exports = extractVideoId;`, sandbox);
    return sandbox.module.exports;
  }

  it('cho cùng mã video trên toàn bộ bộ link mẫu', () => {
    const feExtract = loadFeExtractor();
    if (!feExtract) {
      // Repo FE không nằm cạnh (vd chạy CI riêng BE) — bỏ qua thay vì báo đỏ giả.
      return;
    }
    const lech = CASES
      .map(([url]) => ({ url, be: extractVideoId(url), fe: feExtract(url) }))
      .filter((r) => r.be !== r.fe);

    expect(lech).toEqual([]);
  });
});
