/**
 * Một lượt mượn kéo dài bao lâu, và có quá hạn không.
 *
 * Cố ý KHÔNG chạm Prisma, giống `return-rules.ts` và `availability.ts`: mọi trường hợp biên
 * test được trong vài mili giây, tầng service chỉ còn việc lấy dữ liệu đưa vào.
 *
 * Ba mốc thời gian ở đây rất dễ lẫn:
 *   - `dueAt`        hạn ĐĂNG KÝ trên phiếu mượn (`to_time`)
 *   - `handedOverAt` lúc kho GIAO máy thật (`MemsHandover.received_at`)
 *   - `returnedAt`   lúc kho NHẬN LẠI thật (`MemsReturn.returned_at`)
 *
 * Luật đã chốt: đếm thời gian giữ theo mốc THẬT, còn trễ hay không thì so với hạn đăng ký.
 * Đếm theo hạn đăng ký sẽ không bao giờ lộ ra ai giữ lố ngày.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Số ngày TRỌN giữa hai mốc. Giữ 20 tiếng vẫn là 0 ngày — không làm tròn lên thành 1. */
const fullDaysBetween = (from: Date, to: Date): number =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY));

export interface BorrowDurationInput {
  handedOverAt: Date | null;
  dueAt: Date | null;
  returnedAt: Date | null;
  /** Truyền vào thay vì gọi `new Date()` bên trong để test cố định được thời điểm. */
  now: Date;
}

export interface BorrowDurationResult {
  /**
   * HOLDING  — đang giữ, còn trong hạn
   * OVERDUE  — đang giữ nhưng đã quá hạn (ca người quản lý kho cần thấy nhất)
   * RETURNED — đã trả
   * UNKNOWN  — thiếu mốc giao, không kết luận được
   */
  status: 'HOLDING' | 'OVERDUE' | 'RETURNED' | 'UNKNOWN';
  /** Số ngày trọn đã giữ máy; null khi không xác định được. */
  heldDays: number | null;
  /** Số ngày quá hạn; 0 khi đúng hạn hoặc trả sớm; null khi phiếu không đặt hạn. */
  lateDays: number | null;
}

export function borrowDuration(input: BorrowDurationInput): BorrowDurationResult {
  const { handedOverAt, dueAt, returnedAt, now } = input;

  // Dữ liệu cũ có thể thiếu mốc giao. Thà nói "không rõ" còn hơn hiện một con số sai lên màn
  // hình rồi có người dựa vào đó đi đòi máy.
  if (!handedOverAt) {
    return { status: 'UNKNOWN', heldDays: null, lateDays: null };
  }

  const endOfHolding = returnedAt ?? now;
  const heldDays = fullDaysBetween(handedOverAt, endOfHolding);

  // Không đặt hạn thì vẫn đếm được số ngày giữ, chỉ là không có căn cứ nói trễ.
  const lateDays = dueAt ? fullDaysBetween(dueAt, endOfHolding) : null;

  if (returnedAt) {
    return { status: 'RETURNED', heldDays, lateDays };
  }

  const overdue = lateDays !== null && lateDays > 0;
  return { status: overdue ? 'OVERDUE' : 'HOLDING', heldDays, lateDays };
}
