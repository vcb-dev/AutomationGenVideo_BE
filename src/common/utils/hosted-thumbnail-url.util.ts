/**
 * Ảnh đã được đẩy lên kho của mình hay vẫn là URL CDN thô của nền tảng?
 *
 * Dùng ở hai chỗ phải khớp nhau, lệch một cái là sinh vòng lặp:
 *   - ThumbnailMigrationService: bỏ qua dòng đã đẩy lên kho rồi.
 *   - upsertVideo của các scraper: giữ URL kho khi cào lại, KHÔNG ghi đè về CDN gốc.
 *
 * Google Drive là kho chính. `cloudinary.com` vẫn nằm trong danh sách vì 880 ảnh từ đợt thử
 * Cloudinary còn trỏ vào đó và vẫn hiển thị được — bỏ ra khỏi danh sách thì scraper cào lại
 * sẽ ghi đè chúng về URL CDN gốc, và ảnh đang dùng tốt bỗng thành 403 cho tới lượt cào sau.
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
