/**
 * Các đuôi file video mà Facebook, Instagram và Threads đều nhận.
 *
 * Khai báo một chỗ duy nhất thay vì cắm thẳng vào từng biểu thức: thêm định dạng
 * mới chỉ là thêm một phần tử, không phải đi sửa regex rải rác khắp module —
 * và đó chính là lý do `.mov` bị bỏ sót suốt trước đây.
 */
export const VIDEO_EXTENSIONS = ['mp4', 'mov'] as const;

/** `mp4|mov` — dùng để dựng biểu thức, đã escape sẵn cho việc ghép vào RegExp */
const EXT_PATTERN = VIDEO_EXTENSIONS.join('|');

/** Đuôi file nằm trực tiếp trên đường dẫn: .../abc.mp4, .../abc.mov?token=..., .../abc.mp4#t=5 */
const DIRECT_EXT = new RegExp(`\\.(${EXT_PATTERN})(\\?|#|$)`, 'i');

/** Tên file nằm trong query: ...?filename=abc.mov&... — dạng URL tải từ Google Drive */
const FILENAME_PARAM = new RegExp(`[?&]filename=[^&]+\\.(${EXT_PATTERN})(&|$)`, 'i');

/**
 * Nhận diện URL media dùng chung cho mọi platform publisher.
 *
 * Trước đây mỗi publisher tự viết biểu thức riêng và chúng lệch nhau: Facebook
 * chỉ bắt đuôi `.mp4`, còn Instagram/Threads bắt thêm dạng `?filename=x.mp4`.
 * Cùng một URL video đi qua Facebook bị coi là ảnh và đẩy nhầm vào /photos.
 */
export function isVideoUrl(url: string): boolean {
  if (!url) return false;
  return DIRECT_EXT.test(url) || FILENAME_PARAM.test(url);
}
