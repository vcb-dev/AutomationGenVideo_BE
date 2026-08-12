import { HttpStatus } from '@nestjs/common';

/**
 * Nhận diện lỗi do AI service trả về (khuôn `{ error: "..." }`) nằm trong AxiosError.
 *
 * Vì sao cần: `AxiosError.response` là ĐỐI TƯỢNG PHẢN HỒI HTTP chứ không phải thân lỗi
 * kiểu HttpException, nên mọi chỗ đọc `err.response.error` đều ra undefined và rơi về
 * `err.message` — tức "Request failed with status code 502", câu chữ của thư viện.
 * AI service đã nói rõ nguyên nhân trong `data.error`; đánh mất nó ở đây là bắt người
 * dùng đoán, đúng thứ đã khiến sự cố token TikHub hết hạn 12/08/2026 bị chẩn sai
 * thành "kênh không tồn tại" suốt nhiều ngày.
 *
 * Trả null khi không phải khuôn đó — caller giữ nguyên đường xử lý cũ, không bịa thêm.
 */
/**
 * Mã KHÔNG được truyền thẳng ra client, dù AI service có trả về.
 *
 * 401/403: nói về quan hệ tin cậy BE↔AI, không nói gì về phiên đăng nhập của người dùng.
 * Nhưng FE không phân biệt được — interceptor ở api-client.ts gặp 401 là xoá localStorage
 * và đá thẳng về /login. Truyền ra là người dùng bị đăng xuất giữa chừng không rõ lý do.
 *
 * 429: FE tự thử lại 3 lần khi gặp mã này, tức bắn lại nguyên lệnh cào sau lưng người dùng.
 *
 * Cả ba quy về 502 Bad Gateway — đúng nghĩa "nhà cung cấp phía sau từ chối", và lý do thật
 * vẫn nằm nguyên trong phần `error`.
 */
const KHONG_TRUYEN_RA = new Set<number>([
  HttpStatus.UNAUTHORIZED,
  HttpStatus.FORBIDDEN,
  HttpStatus.TOO_MANY_REQUESTS,
]);

export function readAiServiceError(err: any): { status: number; error: string } | null {
  if (!err?.isAxiosError) return null;
  const res = err.response;
  const error = res?.data?.error;
  if (typeof error !== 'string' || !error) return null;

  const status = res.status || HttpStatus.BAD_GATEWAY;
  return { status: KHONG_TRUYEN_RA.has(status) ? HttpStatus.BAD_GATEWAY : status, error };
}
