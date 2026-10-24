/**
 * Khả dụng là hàm của MODEL và KHOẢNG THỜI GIAN, không phải trạng thái tức thời (QĐ-02).
 *
 * Tài liệu gốc của bộ phận Media tính "tổng máy trừ đang mượn trừ bảo trì" tại thời điểm
 * hiện tại. Cách đó từ chối oan mọi yêu cầu đặt trước: hôm nay là ngày 10, xin mượn ngày 25,
 * mà hai máy "đang mượn" thì đã trả từ ngày 12 rồi.
 *
 * Hàm này cố ý KHÔNG chạm Prisma. Tầng service nạp dữ liệu rồi gọi vào đây, nhờ vậy mọi
 * trường hợp biên (chạm đầu đuôi, buffer, lệnh bảo trì còn mở) test được trong vài mili giây.
 */

export interface BusyInterval {
  fromTime: Date;
  /** Null nghĩa là chưa có điểm kết thúc — chiếm dụng vô hạn về sau. */
  toTime: Date | null;
}

export interface AvailabilityInput {
  /** Số máy còn dùng được của model. Người gọi chịu trách nhiệm loại máy Chờ kiểm tra, Hỏng, Mất, Đã thanh lý và máy đã ngừng sử dụng. */
  totalUsableAssets: number;
  /** Mỗi phần tử là MỘT máy bị giữ chỗ. toTime phải là buffer_to_time, không phải to_time. */
  reservations: BusyInterval[];
  maintenances: BusyInterval[];
  requestedFrom: Date;
  requestedTo: Date;
}

export interface AvailabilityResult {
  available: number;
  busyByReservation: number;
  busyByMaintenance: number;
}

/**
 * Nửa mở `[from, to)`: trả lúc 12:00 và mượn lúc 12:00 KHÔNG tính là trùng.
 * Nếu dùng `<=` thì hai lượt mượn nối tiếp nhau sẽ bị chặn oan, và cả kho mất một nửa vòng quay.
 */
export function overlaps(a: BusyInterval, fromTime: Date, toTime: Date): boolean {
  const endsAfterStart = a.toTime === null || a.toTime.getTime() > fromTime.getTime();
  return a.fromTime.getTime() < toTime.getTime() && endsAfterStart;
}

export function computeAvailability(input: AvailabilityInput): AvailabilityResult {
  const { requestedFrom, requestedTo } = input;

  const busyByReservation = input.reservations.filter((r) =>
    overlaps(r, requestedFrom, requestedTo),
  ).length;

  const busyByMaintenance = input.maintenances.filter((m) =>
    overlaps(m, requestedFrom, requestedTo),
  ).length;

  const available = Math.max(
    0,
    input.totalUsableAssets - busyByReservation - busyByMaintenance,
  );

  return { available, busyByReservation, busyByMaintenance };
}
