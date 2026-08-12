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
export function readAiServiceError(err: any): { status: number; error: string } | null {
  if (!err?.isAxiosError) return null;
  const res = err.response;
  const error = res?.data?.error;
  if (typeof error !== 'string' || !error) return null;
  return { status: res.status || HttpStatus.BAD_GATEWAY, error };
}
