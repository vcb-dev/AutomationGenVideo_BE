/**
 * Ảnh đã được đẩy lên kho của mình hay vẫn là URL CDN thô của nền tảng?
 *
 * Dùng ở hai chỗ phải khớp nhau, lệch một cái là sinh vòng lặp:
 *   - ThumbnailMigrationService: bỏ qua dòng đã đẩy lên kho rồi.
 *   - upsertVideo của các scraper: giữ URL kho khi cào lại, KHÔNG ghi đè về CDN gốc.
 *
 * Trước đây bản kiểm tra chỉ nhận Google Drive. Khi chuyển sang Cloudinary, scraper cào
 * lại là ghi đè URL Cloudinary về CDN gốc, phút sau migration lại upload — vừa đốt quota
 * vừa để UI hiện URL CDN hay bị 403 trong lúc chờ.
 *
 * Google Drive vẫn nằm trong danh sách vì dữ liệu cũ còn trỏ vào đó.
 */
const HOSTED_THUMBNAIL_HOSTS = [
  'cloudinary.com',
  'drive.google.com',
  'googleusercontent.com',
];

export function isHostedThumbnailUrl(url?: string | null): boolean {
  return !!url && HOSTED_THUMBNAIL_HOSTS.some((host) => url.includes(host));
}

/** Mệnh đề SQL loại các dòng đã nằm trong kho, dùng cho target ghi đè tại chỗ. */
export function notHostedThumbnailSql(expr: string): string {
  return HOSTED_THUMBNAIL_HOSTS.map((host) => `${expr} NOT LIKE '%${host}%'`).join(' AND ');
}

/**
 * Chọn ảnh để trả cho FE: bản đã đẩy lên kho nếu có, không thì URL gốc.
 *
 * ThumbnailMigrationService ghi chữ 'FAILED' vào cột *_drive_url khi đẩy ảnh thất bại (để
 * khỏi thử lại mãi). Viết `drive_url || url` thì chính chữ 'FAILED' thắng và FE gắn nó vào
 * <img src>, trình duyệt gọi /.../FAILED rồi 404 — trong khi URL gốc vẫn còn.
 */
export function preferHostedImage(hostedUrl?: string | null, originalUrl?: string | null): string | null {
  if (hostedUrl && hostedUrl !== 'FAILED') return hostedUrl;
  return originalUrl && originalUrl !== 'FAILED' ? originalUrl : null;
}
