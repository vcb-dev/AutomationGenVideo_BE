/**
 * Một chỗ duy nhất quyết định địa chỉ AI service.
 *
 * Trước đây 24 chỗ trong mã nguồn tự đọc `AI_SERVICE_URL` kèm giá trị mặc định riêng, và hai
 * giá trị đó KHÁC NHAU: 8 chỗ dùng `localhost:8001`, 16 chỗ dùng `localhost:8000`. Con số nào
 * cũng có lý ở một nơi — `start-all.sh` chạy Django ở 8001, còn `Dockerfile` đặt `PORT=8000` —
 * nên khi thiếu biến môi trường thì một nửa module gọi đúng cổng, nửa kia gọi vào chỗ không có
 * ai nghe. Lỗi kiểu đó không báo gì lúc khởi động, chỉ lộ ra ở đúng tính năng ít dùng nhất.
 *
 * Vì vậy không còn giá trị mặc định: thiếu biến thì dừng ngay với thông báo nói rõ phải đặt gì.
 */

export const AI_SERVICE_URL_ENV = 'AI_SERVICE_URL';

/** Đọc từ ConfigService (module NestJS đã inject sẵn). */
export function resolveAiServiceUrl(config: { get<T = string>(key: string): T | undefined }): string {
  return normalize(config.get<string>(AI_SERVICE_URL_ENV));
}

/** Đọc thẳng process.env — dùng cho property khởi tạo lúc dựng class, chưa có ConfigService. */
export function resolveAiServiceUrlFromEnv(): string {
  return normalize(process.env[AI_SERVICE_URL_ENV]);
}

function normalize(raw: string | undefined): string {
  if (!raw || !raw.trim()) {
    throw new Error(
      `Thiếu ${AI_SERVICE_URL_ENV} trong .env — xem .env.example. ` +
        `Chạy local theo start-all.sh thì AI service nghe ở cổng 8001; bản Docker đặt PORT=8000.`,
    );
  }
  // Bỏ dấu / cuối để nơi gọi luôn ghép được `${url}/api/...` mà không sinh dấu // đôi.
  return raw.trim().replace(/\/$/, '');
}
