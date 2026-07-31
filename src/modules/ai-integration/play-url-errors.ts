/**
 * Tài khoản TikHub hết số dư.
 *
 * Tách hẳn thành một loại lỗi riêng thay vì trả `null` như mọi thất bại khác, vì hai
 * trường hợp này cần hai cách xử lý hoàn toàn khác nhau:
 *
 *   - "không tìm thấy link phát"  → video đó hỏng, các video khác vẫn xem được.
 *   - "hết số dư"                 → MỌI video của douyin/tiktok/xiaohongshu/kuaishou đều
 *                                    chết cùng lúc, và cách chữa là nạp tiền, không phải
 *                                    sửa code.
 *
 * Gộp chung hai thứ này đã từng làm mất khá nhiều thời gian dò nhầm hướng: giao diện chỉ
 * hiện "Không phát được video này", còn log chỉ ghi "khong lay duoc: not_found", nhìn vào
 * không ai đoán ra nguyên nhân thật là TikHub trả HTTP 402.
 */
export class PlayUrlNoCreditError extends Error {
  constructor() {
    super('Tài khoản TikHub đã hết số dư.');
    this.name = 'PlayUrlNoCreditError';
  }
}
