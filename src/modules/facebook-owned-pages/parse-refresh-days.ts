/**
 * Kiểm tra tham số `days` của endpoint kéo lại chỉ số. Tách khỏi controller để test được mà không
 * cần dựng Nest — cùng lối với `scraper-aggregate/content-filters.ts`.
 */

/** Cron hằng ngày dùng 7. Không truyền gì thì giữ nguyên hành vi đó. */
export const DEFAULT_REFRESH_DAYS = 7;

/**
 * Trần 60 ngày. Không phải con số tùy tiện: mỗi video là một lượt hỏi Graph API (gom lô 50), nên
 * `days` càng lớn càng đốt hạn mức của app. Kho có ~150 video/ngày trên 106 page, tức 60 ngày
 * ≈ 9.000 video ≈ 180 lượt gọi — vẫn trong tầm, nhưng gõ nhầm 600 thì thành 1.800 lượt và Facebook
 * chặn cả app, kéo sập luôn cron cào hằng ngày.
 */
export const MAX_REFRESH_DAYS = 60;

export class InvalidRefreshDaysError extends Error {}

/**
 * Trả về số ngày hợp lệ, hoặc ném lỗi kèm lý do đọc được.
 *
 * Nhận cả chuỗi vì body JSON hay gửi `"20"` thay vì `20`.
 */
export function parseRefreshDays(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_REFRESH_DAYS;

  const days = typeof raw === 'string' ? Number(raw.trim()) : raw;

  if (typeof days !== 'number' || !Number.isFinite(days)) {
    throw new InvalidRefreshDaysError('days phải là số');
  }
  if (!Number.isInteger(days)) {
    throw new InvalidRefreshDaysError('days phải là số nguyên');
  }
  if (days < 1) {
    throw new InvalidRefreshDaysError('days phải >= 1');
  }
  if (days > MAX_REFRESH_DAYS) {
    throw new InvalidRefreshDaysError(`days tối đa là ${MAX_REFRESH_DAYS}`);
  }
  return days;
}
