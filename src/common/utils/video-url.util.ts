/**
 * Bóc mã video và nền tảng từ một đường link.
 *
 * Mã này là khoá của toàn hệ thống: dùng để khớp với video đã cào
 * (scraper_*_videos.post_id), để chống trùng trong bộ sưu tập, và để gọi TikHub lấy số liệu.
 * Nhét cả đường link vào chỗ mã sẽ sinh ra bản ghi rác không bao giờ khớp được với dữ liệu
 * cào — đã từng xảy ra.
 *
 * Bộ mẫu ở đây phải KHỚP với 2 bản phía client:
 *   - AutomationGenVideo_FE/src/app/dashboard/video-library/page.tsx (extractVideoId)
 *   - public/extensions/vcb-video-downloader/content.js (detectVideoRef)
 * Sửa một chỗ thì sửa cả ba, nếu không cùng một video sẽ có 2 mã khác nhau.
 */

const VIDEO_ID_PATTERNS: Array<{ platform: string; host: RegExp; patterns: RegExp[] }> = [
  { platform: 'douyin', host: /douyin\.com|iesdouyin\.com/,
    patterns: [/\/video\/(\d{6,})/, /\/note\/(\d{6,})/, /[?&]modal_id=(\d{6,})/] },
  { platform: 'tiktok', host: /tiktok\.com/,
    patterns: [/\/video\/(\d{6,})/, /\/photo\/(\d{6,})/, /[?&]item_id=(\d{6,})/] },
  { platform: 'youtube', host: /youtube\.com|youtu\.be/,
    patterns: [/[?&]v=([\w-]{8,})/, /\/shorts\/([\w-]{8,})/, /\/embed\/([\w-]{8,})/, /youtu\.be\/([\w-]{8,})/] },
  { platform: 'bilibili', host: /bilibili\.com|b23\.tv/,
    patterns: [/\/video\/(BV[\w]{8,})/i, /\/video\/(av\d+)/i] },
  { platform: 'xiaohongshu', host: /xiaohongshu\.com|xhslink\.com|rednote\.com/,
    patterns: [/\/explore\/([\da-f]{16,})/i, /\/discovery\/item\/([\da-f]{16,})/i, /\/search_result\/([\da-f]{16,})/i] },
  { platform: 'kuaishou', host: /kuaishou\.com/,
    patterns: [/\/short-video\/([\w-]{6,})/, /\/f\/([\w-]{6,})/, /[?&]photoId=([\w-]{6,})/] },
  { platform: 'instagram', host: /instagram\.com/,
    patterns: [/\/reels?\/([\w-]{5,})/, /\/p\/([\w-]{5,})/, /\/tv\/([\w-]{5,})/] },
  { platform: 'facebook', host: /facebook\.com|fb\.watch/,
    patterns: [/\/videos\/(?:[^/]+\/)?(\d{6,})/, /\/reel\/(\d{6,})/, /[?&]v=(\d{6,})/] },
];

/** '' nghĩa là link không trỏ vào một video cụ thể (vd link trang cá nhân). */
export function extractVideoId(url: string): string {
  const u = (url || '').trim();
  if (!u) return '';
  for (const rule of VIDEO_ID_PATTERNS) {
    if (!rule.host.test(u)) continue;
    for (const re of rule.patterns) {
      const m = u.match(re);
      if (m?.[1]) return m[1];
    }
    return '';
  }
  return '';
}

/** '' nghĩa là không thuộc 8 nền tảng hệ thống hỗ trợ. */
export function detectPlatformFromUrl(url: string): string {
  const u = (url || '').trim();
  if (!u) return '';
  for (const rule of VIDEO_ID_PATTERNS) {
    if (rule.host.test(u)) return rule.platform;
  }
  return '';
}
