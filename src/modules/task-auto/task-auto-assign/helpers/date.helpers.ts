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

export function remainingCalendarDays(today: DateTime): number {
  const last = today.endOf("month").startOf("day");
  const todayStart = today.startOf("day");
  const diff = Math.floor(last.diff(todayStart, "days").days) + 1;
  return Math.max(1, diff);
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
