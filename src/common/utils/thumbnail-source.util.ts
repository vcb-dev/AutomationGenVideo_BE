/**
 * Chuẩn hoá URL ảnh nguồn trước khi tải về đẩy lên Cloudinary.
 *
 * Ba CDN hỏng theo ba kiểu khác nhau. Kết luận dưới đây đo bằng request thật, không suy đoán:
 *
 *   rednotecdn (XiaoHongShu)  nguyên URL → 498 {"code":1007,"msg":"request failed - special"}
 *                             bỏ query   → 200 image/jpeg 390KB
 *                             ⇒ tham số sign=/t= là thủ phạm, bỏ đi là chạy.
 *
 *   kwimgs (Kuaishou)         nguyên URL → 200 nhưng content-type image/kvif
 *                             .kvif→.jpg → 400
 *                             bỏ query   → vẫn image/kvif
 *                             ⇒ định dạng riêng của Kuaishou, kho ảnh lẫn trình duyệt đều
 *                               không đọc được. Không có đường vòng bằng URL, chỉ còn cách
 *                               loại khỏi hàng đợi.
 *
 *   tiktokcdn                 URL mới    → 200 image/jpeg
 *                             URL cũ     → 403 (x-expires đã qua)
 *                             ⇒ không phải bị chặn mà là chữ ký hết hạn. Không sửa được ở
 *                               tầng URL — phải upload sớm hơn, xem ThumbnailMigrationService.
 */

/** CDN mà chữ ký trong query là thứ gây lỗi chứ không phải điều kiện bắt buộc. */
const STRIP_QUERY_HOSTS = ['rednotecdn.com'];

/** Đuôi tệp kho ảnh và trình duyệt không đọc được. */
const UNSUPPORTED_EXTENSIONS = ['.kvif'];

export function normalizeThumbnailSourceUrl(url: string): string {
  if (!url) return url;
  // Chỉ bỏ query ở CDN đã kiểm chứng. Làm đại trà là hỏng tiktokcdn: bỏ x-signature ở đó
  // thì ăn 403 ngay cả khi URL còn hạn.
  if (!STRIP_QUERY_HOSTS.some((host) => url.includes(host))) return url;
  return url.split('?')[0];
}

export function isUnsupportedThumbnailFormat(url?: string | null): boolean {
  if (!url) return false;
  const path = url.split('?')[0].toLowerCase();
  return UNSUPPORTED_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/**
 * Mệnh đề SQL loại các định dạng không dùng được ngay từ truy vấn.
 *
 * Phải loại ở tầng SQL chứ không phải sau khi tải về: 4312/6177 thumbnail Kuaishou là .kvif,
 * để chúng lọt vào batch thì vừa tốn lượt tải vừa làm log ngập lỗi mỗi phút, và tệ nhất là
 * chiếm chỗ của những dòng tải được.
 */
export function supportedThumbnailSql(expr: string): string {
  return UNSUPPORTED_EXTENSIONS.map((ext) => `${expr} NOT LIKE '%${ext}%'`).join(' AND ');
}
