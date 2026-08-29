/** Giới hạn tiêu đề của YouTube */
const YOUTUBE_TITLE_MAX = 100;
/** YouTube bỏ qua tag vượt quá 500 ký tự tổng cộng — giữ ngưỡng an toàn */
const YOUTUBE_TAGS_MAX = 15;

/**
 * Dựng tiêu đề YouTube từ nội dung bài đăng.
 *
 * Trước đây dùng `message.substring(0, 100)` — cắt cụt giữa từ, và kéo theo cả
 * chuỗi hashtag ở cuối caption vào tiêu đề. Tiêu đề là tín hiệu xếp hạng mạnh
 * của Shorts nên một tiêu đề rác làm giảm khả năng được tìm thấy.
 *
 * Quy tắc: lấy dòng đầu có nội dung, bỏ hashtag, cắt ở ranh giới từ.
 */
export function buildYoutubeTitle(message: string, fallback = 'Video'): string {
  if (!message) return fallback;

  const firstLine = message
    .split('\n')
    .map((line) => stripHashtags(line).trim())
    .find((line) => line.length > 0);

  if (!firstLine) return fallback;
  if (firstLine.length <= YOUTUBE_TITLE_MAX) return firstLine;

  // Cắt ở khoảng trắng cuối cùng trước ngưỡng để không đứt giữa từ
  const truncated = firstLine.slice(0, YOUTUBE_TITLE_MAX);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > YOUTUBE_TITLE_MAX / 2 ? truncated.slice(0, lastSpace) : truncated).trim();
}

/**
 * Rút hashtag trong nội dung thành mảng tag cho YouTube.
 *
 * Trước đây `tags` luôn là mảng rỗng — bỏ trống hoàn toàn một trường mà người
 * dùng đã tự điền sẵn dưới dạng hashtag trong caption.
 */
export function extractHashtags(message: string): string[] {
  if (!message) return [];

  const matches = message.match(/#[\p{L}\p{N}_]+/gu) || [];
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const raw of matches) {
    const tag = raw.slice(1); // YouTube nhận tag không kèm dấu '#'
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= YOUTUBE_TAGS_MAX) break;
  }

  return tags;
}

function stripHashtags(text: string): string {
  return text.replace(/#[\p{L}\p{N}_]+/gu, ' ').replace(/\s+/g, ' ');
}
