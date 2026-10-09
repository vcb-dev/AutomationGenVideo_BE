import { DateTime } from "luxon";
import { TeamProductCandidate } from "../types";

// Trần cửa sổ lookback truy vấn lịch sử giao SP — chặn query quét quá xa nếu ai đó
// lỡ set cooldown_days rất lớn (per-product override hoặc default_cooldown_days).
export const MAX_COOLDOWN_LOOKBACK_DAYS = 60;

export function effectiveCooldownDays(
  override: number | null | undefined,
  defaultDays: number,
): number {
  return override ?? defaultDays;
}

/**
 * true nếu sản phẩm đang trong thời gian cooldown của editor này — tức đã được giao
 * cho editor trong vòng chưa đủ `effectiveCooldownDays` NGÀY LỊCH kể từ lần giao gần nhất.
 * cooldown_days=1 nghĩa là "không giao lại ở ngày kế tiếp", tự do lại từ ngày thứ 3.
 */
export function isOnCooldown(
  product: Pick<TeamProductCandidate, "cooldown_days">,
  lastAssigned: Date | undefined,
  defaultDays: number,
  today: DateTime,
): boolean {
  const days = effectiveCooldownDays(product.cooldown_days, defaultDays);
  if (days <= 0 || !lastAssigned) return false;
  return calendarDaysSince(lastAssigned, today) < days;
}

/** Số NGÀY LỊCH (theo múi giờ của `today`) từ `last` tới `today` — cùng ngày = 0. */
export function calendarDaysSince(last: Date, today: DateTime): number {
  return today
    .startOf("day")
    .diff(DateTime.fromJSDate(last).setZone(today.zone).startOf("day"), "days").days;
}
