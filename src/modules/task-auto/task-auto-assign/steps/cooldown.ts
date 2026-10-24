import { DateTime } from "luxon";

/**
 * true nếu sản phẩm đang trong thời gian cooldown của editor này — tức đã được giao
 * cho editor khi chưa đủ `cooldownDays` NGÀY LỊCH kể từ lần giao gần nhất.
 * Ví dụ cooldown_days=5: giao ngày 01 thì có thể giao lại từ ngày 06.
 */
export function isOnCooldown(
  lastAssigned: Date | undefined,
  cooldownDays: number,
  today: DateTime,
): boolean {
  if (cooldownDays <= 0 || !lastAssigned) return false;
  return calendarDaysSince(lastAssigned, today) < cooldownDays;
}

/** Số NGÀY LỊCH (theo múi giờ của `today`) từ `last` tới `today` — cùng ngày = 0. */
export function calendarDaysSince(last: Date, today: DateTime): number {
  return today
    .startOf("day")
    .diff(DateTime.fromJSDate(last).setZone(today.zone).startOf("day"), "days").days;
}
