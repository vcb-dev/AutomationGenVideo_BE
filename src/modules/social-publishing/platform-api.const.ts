/**
 * Điểm cuối API của các nền tảng, khai báo một chỗ duy nhất.
 *
 * Trước đây chuỗi `v21.0` được dán thẳng vào 11 chỗ trong 6 file khác nhau
 * (2 publisher, 2 OAuth strategy, accounts service). Meta khai tử phiên bản
 * Graph API theo lịch — đến ngày v21.0 hết hạn thì mọi lời gọi chết cùng lúc,
 * và người nâng cấp phải tự đi tìm đủ 11 chỗ, sót một chỗ là hỏng lặng lẽ.
 *
 * Nâng phiên bản giờ là sửa đúng một dòng dưới đây.
 *
 * Đối chiếu docs Meta ngày 29/08/2026.
 */
const GRAPH_API_VERSION = 'v21.0';

/** Threads đánh số phiên bản riêng, không đi theo Graph API */
const THREADS_API_VERSION = 'v1.0';

// ── Có kèm phiên bản ────────────────────────────────────────────────────────
export const FACEBOOK_GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
export const INSTAGRAM_GRAPH_BASE = `https://graph.instagram.com/${GRAPH_API_VERSION}`;
export const THREADS_GRAPH_BASE = `https://graph.threads.net/${THREADS_API_VERSION}`;

/** Host riêng cho việc nạp bytes của Reels API — không phải graph.facebook.com */
export const FACEBOOK_RUPLOAD_BASE = `https://rupload.facebook.com/video-upload/${GRAPH_API_VERSION}`;

// ── Không kèm phiên bản ─────────────────────────────────────────────────────
// Một số điểm cuối của Meta cố tình không nhận phiên bản: ảnh đại diện Page,
// và bước đổi token của Threads. Thêm phiên bản vào là lỗi 400.
export const FACEBOOK_GRAPH_ROOT = 'https://graph.facebook.com';
export const INSTAGRAM_GRAPH_ROOT = 'https://graph.instagram.com';
export const THREADS_GRAPH_ROOT = 'https://graph.threads.net';

// ── Hộp thoại OAuth (giao diện người dùng, không phải API) ──────────────────
/** Chỉ nhánh Instagram-qua-Facebook đánh phiên bản vào URL hộp thoại */
export const FACEBOOK_OAUTH_DIALOG = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`;
export const FACEBOOK_OAUTH_DIALOG_UNVERSIONED = 'https://www.facebook.com/dialog/oauth';
/**
 * Instagram Login dùng www.instagram.com — KHÔNG phải api.instagram.com (đó là
 * endpoint của Basic Display API đã ngừng). Client ID cấu hình trong Meta
 * dashboard chỉ được product mới nhận diện.
 */
export const INSTAGRAM_OAUTH_DIALOG = 'https://www.instagram.com/oauth/authorize';

// ── Google ──────────────────────────────────────────────────────────────────
export const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
export const YOUTUBE_UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3';
export const GOOGLE_OAUTH_DIALOG = 'https://accounts.google.com/o/oauth2/v2/auth';
