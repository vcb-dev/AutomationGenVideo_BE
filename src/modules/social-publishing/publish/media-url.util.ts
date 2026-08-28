/**
 * Nhận diện URL media dùng chung cho mọi platform publisher.
 *
 * Trước đây mỗi publisher tự viết biểu thức riêng và chúng lệch nhau:
 * Facebook chỉ bắt đuôi `.mp4`, còn Instagram/Threads bắt thêm dạng
 * `?filename=x.mp4`. Cùng một URL video đi qua Facebook bị coi là ảnh
 * và đẩy nhầm vào /photos → đăng lỗi hoặc đăng sai loại bài.
 */
export function isVideoUrl(url: string): boolean {
  if (!url) return false;
  // Đuôi file trực tiếp: .../abc.mp4, .../abc.mp4?token=..., .../abc.mp4#frag
  if (/\.mp4(\?|#|$)/i.test(url)) return true;
  // Tên file nằm trong query: ...?filename=abc.mp4&...
  if (/[?&]filename=[^&]+\.mp4(&|$)/i.test(url)) return true;
  return false;
}
