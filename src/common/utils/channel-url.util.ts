/**
 * Bóc tách và chuẩn hoá định danh kênh / trang cá nhân từ URL hoặc chuỗi nhập.
 *
 * Tương tự video-url.util.ts (bóc video id), util này bóc ID/username tác giả
 * để tránh việc nhét nguyên URL hoặc link video vào cột ID của database gây lỗi 500.
 */

/**
 * Douyin: Trích xuất `sec_user_id`.
 * Hỗ trợ:
 * - URL web PC: https://www.douyin.com/user/<sec_uid>
 * - URL share mobile: https://www.iesdouyin.com/share/user/<sec_uid>
 * - Query param: ?sec_uid=<sec_uid> hoặc &sec_user_id=<sec_uid>
 * - sec_user_id thuần (MS4wLjABAAAA...)
 */
export function extractDouyinSecUserId(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  // 1. URL web PC hoặc share mobile
  const pathMatch = trimmed.match(/(?:douyin\.com|iesdouyin\.com)\/(?:share\/)?user\/([\w-]+)/i);
  if (pathMatch) return pathMatch[1];

  // 2. Query param
  const queryMatch = trimmed.match(/[?&](?:sec_uid|sec_user_id)=([\w-]+)/i);
  if (queryMatch) return queryMatch[1];

  // 3. sec_user_id thuần (không bắt đầu bằng http:// hoặc https://)
  if (!/^https?:\/\//i.test(trimmed) && /^[\w-]+$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * Xiaohongshu: Trích xuất `user_id` (chuỗi hex 24 ký tự).
 * Hỗ trợ:
 * - URL web/profile: https://www.xiaohongshu.com/user/profile/<hex_24>
 * - user_id thuần 24 ký tự hex (vd: 5b863d08e8cd0300018f8888)
 */
export function extractXiaohongshuUserId(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  // 1. URL web / profile
  const urlMatch = trimmed.match(/xiaohongshu\.com\/user\/profile\/([0-9a-f]{24})/i);
  if (urlMatch) return urlMatch[1];

  // 2. user_id thuần 24 ký tự hex
  if (!/^https?:\/\//i.test(trimmed) && /^[0-9a-f]{24}$/i.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * Kuaishou: Trích xuất `eid`.
 * Hỗ trợ:
 * - URL web/profile: https://www.kuaishou.com/profile/<eid>
 * - eid thuần (không phải URL)
 */
export function extractKuaishouEid(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  // 1. URL web / profile
  const urlMatch = trimmed.match(/kuaishou\.com\/profile\/([\w-]+)/i);
  if (urlMatch) return urlMatch[1];

  // 2. eid thuần (không phải URL)
  if (!/^https?:\/\//i.test(trimmed) && /^[\w-]+$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * Threads: Trích xuất `username`.
 * Hỗ trợ:
 * - URL: https://www.threads.net/@username hoặc https://threads.net/username
 * - Handle có @: @username
 * - Username thuần
 */
export function extractThreadsUsername(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  // 1. URL threads.net/@username hoặc threads.net/username
  const urlMatch = trimmed.match(/threads\.(?:net|com)\/@?([A-Za-z0-9_.]+)/i);
  const username = (urlMatch ? urlMatch[1] : trimmed.replace(/^@/, '')).trim().toLowerCase();

  // 2. Username Threads: chỉ chữ cái thường, số, dấu gạch dưới, dấu chấm, độ dài 1-30 ký tự
  if (/^[a-z0-9_.]{1,30}$/.test(username)) {
    return username;
  }

  return null;
}
