/**
 * Phân loại lỗi đăng bài: thử lại được hay hỏng vĩnh viễn.
 *
 * Worker mặc định thử lại 3 lượt với backoff 5 và 15 phút. Với lỗi không bao giờ tự
 * khỏi (sai định dạng media, token bị thu hồi, thiếu quyền) thì 2 lượt thử sau chỉ
 * lãng phí ~20 phút, và vì mỗi kênh chỉ chạy 1 bài một lúc (SOCIAL_ACCOUNT_CONCURRENCY)
 * nên suốt thời gian đó mọi bài khác của kênh phải xếp hàng chờ.
 *
 * Nguyên tắc: CHỈ đánh dấu vĩnh viễn khi chắc chắn. Không nhận ra thì trả false để
 * giữ nguyên hành vi thử lại như cũ — thà thử thừa còn hơn bỏ bài đáng lẽ đăng được.
 */

/** error_subcode của Meta cho các lỗi media không thể tự khỏi. */
const META_PERMANENT_SUBCODES = new Set([
  2207083, // Invalid Image Format — ảnh sai định dạng hoặc URL trả về trang lỗi
  2207026, // Video format not supported
  2207020, // Media fetch failed — không tải được URL media
  2207032, // Create media container failed
  2207003, // Media upload error
  2207057, // Aspect ratio không hợp lệ
  1363037, // Instagram: media không đạt yêu cầu nền tảng
]);

/** error.code của Meta cho lỗi xác thực/phân quyền — phải kết nối lại tài khoản. */
const META_PERMANENT_CODES = new Set([
  190, // Access token hết hạn hoặc bị thu hồi
  200, // Thiếu quyền cần thiết
  10,  // Ứng dụng không được phép thực hiện hành động này
  803, // Đối tượng không tồn tại
]);

/**
 * Mã rate-limit / quá tải của Meta — LUÔN đáng thử lại kể cả khi kèm
 * is_transient=false. Danh sách này được kiểm tra TRƯỚC mọi luật khác.
 */
const META_RETRYABLE_CODES = new Set([
  4,   // Application request limit reached
  17,  // User request limit reached
  32,  // Page-level throttling
  341, // Application limit reached
  613, // Calls to this api have exceeded the rate limit
]);

function readNumericField(message: string, field: string): number | null {
  const match = message.match(new RegExp(`"${field}"\\s*:\\s*(\\d+)`));
  return match ? Number(match[1]) : null;
}

/**
 * Lỗi có chắc chắn không tự khỏi khi thử lại không?
 *
 * Nhận vào chuỗi thông báo lỗi đã gom (các publisher bọc JSON phản hồi của nền tảng
 * vào message trước khi ném lên), nên chỉ cần đọc chuỗi là đủ.
 */
export function isPermanentPublishError(message: string | null | undefined): boolean {
  if (!message) return false;

  const code = readNumericField(message, 'code');
  const subcode = readNumericField(message, 'error_subcode');

  // Rate-limit luôn thắng: quá tải thì chờ rồi thử lại là đúng.
  if (code !== null && META_RETRYABLE_CODES.has(code)) return false;

  if (subcode !== null && META_PERMANENT_SUBCODES.has(subcode)) return true;
  if (code !== null && META_PERMANENT_CODES.has(code)) return true;

  return false;
}
