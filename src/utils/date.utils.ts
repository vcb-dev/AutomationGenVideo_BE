import { DateTime } from "luxon";

export function isWeekend(d: DateTime): boolean {
  return d.weekday >= 6;
}

export function monthKey(d: DateTime): string {
  return d.toFormat("yyyy-MM");
}

export function addCalendarDays(d: DateTime, n: number): DateTime {
  return d.plus({ days: n });
}

// Task giao hôm nay → editor làm từ ngày mai.
// Tất cả tính toán KPI đều dùng ngày mai làm mốc (effective date).
// Nếu hôm nay là ngày cuối tháng → ngày mai là ngày đầu tháng mới → đếm toàn bộ tháng mới.
export function effectiveAssignmentDate(today: DateTime): DateTime {
  return today.startOf("day").plus({ days: 1 });
}

export function remainingCalendarDays(today: DateTime): number {
  const tomorrow = effectiveAssignmentDate(today);
  const lastDay = tomorrow.endOf("month").startOf("day");
  return Math.floor(lastDay.diff(tomorrow, "days").days) + 1;
}

export function deriveDailyTarget(
  monthlyTarget: number,
  doneThisMonth: number,
  today: DateTime,
): number {
  const remaining = Math.max(0, monthlyTarget - doneThisMonth);
  if (remaining === 0) return 0;
  const days = remainingCalendarDays(today);
  return Math.min(remaining, Math.ceil(remaining / days));
}

// Cột EditorDailyKpi.date là DATE, lưu tại UTC midnight của ngày lịch VN —
// mọi nơi đọc/ghi bảng này phải cùng quy ước "YYYY-MM-DD" → UTC midnight.
export function dailyKpiDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

// Ngày lịch VN của một thời điểm, dạng "YYYY-MM-DD" — bất kể server chạy timezone gì.
export function vietnamDateString(d: Date = new Date()): string {
  return DateTime.fromJSDate(d)
    .setZone("Asia/Ho_Chi_Minh")
    .toFormat("yyyy-MM-dd");
}
