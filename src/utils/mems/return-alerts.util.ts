import { MemsRequestStatus } from '@prisma/client';

/** Trạng thái phiếu còn máy nằm ngoài kho. */
export const HOLDING_STATUSES: MemsRequestStatus[] = ['ON_LOAN', 'PARTIALLY_RETURNED'];

/** Còn dưới chừng này phút tới hạn trả thì tính là sắp hết hạn. */
export const EXPIRING_SOON_MINUTES = 120;

/** Chia phiếu thành quá hạn và sắp hết hạn, kèm số phút trễ hoặc còn lại. */
export function classifyReturnAlerts<T extends { to_time: Date }>(requests: T[], now: Date) {
  const overdue: (T & { overdue_minutes: number })[] = [];
  const expiringSoon: (T & { remaining_minutes: number })[] = [];
  for (const request of requests) {
    const diffMs = request.to_time.getTime() - now.getTime();
    if (diffMs < 0) {
      overdue.push({ ...request, overdue_minutes: Math.ceil(-diffMs / 60_000) });
    } else if (diffMs <= EXPIRING_SOON_MINUTES * 60_000) {
      expiringSoon.push({ ...request, remaining_minutes: Math.floor(diffMs / 60_000) });
    }
  }
  return { overdue, expiringSoon };
}
