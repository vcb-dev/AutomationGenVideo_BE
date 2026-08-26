/**
 * Địa chỉ và API key của OMS (hệ thống kho/sản phẩm ngoài, warehouse-be) — dùng cho module
 * oms-integration để lấy dữ liệu sản phẩm (kho tổng) và cho leader "kéo" sản phẩm vào kho team.
 *
 * Không có giá trị mặc định: thiếu biến thì dừng ngay với thông báo rõ ràng, tránh âm thầm gọi
 * nhầm địa chỉ (theo đúng lý do đã áp dụng cho AI_SERVICE_URL — xem ai-service-url.ts).
 */

export const OMS_API_URL_ENV = 'OMS_API_URL';
export const OMS_API_KEY_ENV = 'OMS_API_KEY';

export function resolveOmsApiUrl(config: { get<T = string>(key: string): T | undefined }): string {
  const raw = config.get<string>(OMS_API_URL_ENV);
  if (!raw || !raw.trim()) {
    throw new Error(`Thiếu ${OMS_API_URL_ENV} trong .env — xem .env.example.`);
  }
  // Bỏ dấu / cuối để nơi gọi luôn ghép được `${url}/products` mà không sinh dấu // đôi.
  return raw.trim().replace(/\/$/, '');
}

export function resolveOmsApiKey(config: { get<T = string>(key: string): T | undefined }): string {
  const raw = config.get<string>(OMS_API_KEY_ENV);
  if (!raw || !raw.trim()) {
    throw new Error(`Thiếu ${OMS_API_KEY_ENV} trong .env — xem .env.example.`);
  }
  return raw.trim();
}
