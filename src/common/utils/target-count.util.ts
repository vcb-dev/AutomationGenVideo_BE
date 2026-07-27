/**
 * Chuẩn hoá số lượng video muốn cào cho 1 kênh (user tự đặt ở ô "Số video muốn cào").
 *
 * Trước đây con số này hardcode 300 trong từng service, user không đổi được.
 * Giá trị client gửi lên KHÔNG được tin tưởng trực tiếp: phải kẹp trong [1, MAX]
 * để tránh 1 request đặt số quá lớn làm treo job nền + đốt quota API bên thứ 3.
 */
export const DEFAULT_TARGET_COUNT = 300;
export const MAX_TARGET_COUNT = 1000;

export function normalizeTargetCount(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TARGET_COUNT;
  return Math.min(MAX_TARGET_COUNT, Math.floor(n));
}
