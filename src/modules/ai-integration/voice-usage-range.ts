/**
 * Quy đổi khoảng ngày lọc của trang Tổng quan Tiện ích AI thành mốc thời gian tuyệt đối.
 *
 * Người dùng chọn "ngày" theo lịch Việt Nam, còn server có thể chạy ở UTC — nếu ghép
 * chuỗi ISO không kèm offset thì Node lấy timezone của máy chủ, khiến mốc ngày lệch 7
 * tiếng và số liệu đầu/cuối kỳ rơi nhầm sang ngày bên cạnh. Vì vậy luôn neo theo +07:00.
 */

/** Việt Nam không có giờ mùa hè nên +07:00 là hằng số, ghép thẳng vào chuỗi ISO được. */
const VN_OFFSET = '+07:00';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface VoiceUsageDateRange {
  gte?: Date;
  lte?: Date;
}

/** Ngày sai định dạng (hoặc không tồn tại, ví dụ 2026-02-31) bị bỏ qua thay vì tạo Invalid Date. */
function parseVnDate(date: string, endOfDay: boolean): Date | null {
  if (!DATE_PATTERN.test(date)) return null;
  const parsed = new Date(
    `${date}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}${VN_OFFSET}`,
  );
  if (Number.isNaN(parsed.getTime())) return null;
  // new Date('2026-02-31T...') tự trôi sang 03-03 chứ không báo lỗi, nên đối chiếu lại
  // phần ngày sau khi đưa về giờ VN.
  const roundTrip = new Date(parsed.getTime() + 7 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return roundTrip === date ? parsed : null;
}

/**
 * Trả về điều kiện lọc `created_at` cho Prisma, hoặc `null` khi không có mốc nào hợp lệ
 * (lúc đó gọi bên ngoài không gắn điều kiện — tức là thống kê toàn bộ lịch sử).
 * Nếu người dùng nhập ngược (from > to) thì đảo lại cho đúng thay vì trả về rỗng.
 */
export function buildVoiceUsageDateRange(
  dateFrom?: string,
  dateTo?: string,
): VoiceUsageDateRange | null {
  let gte = dateFrom ? parseVnDate(dateFrom, false) : null;
  let lte = dateTo ? parseVnDate(dateTo, true) : null;

  if (gte && lte && gte > lte) {
    const from = parseVnDate(dateTo as string, false);
    const to = parseVnDate(dateFrom as string, true);
    gte = from;
    lte = to;
  }

  if (!gte && !lte) return null;

  const range: VoiceUsageDateRange = {};
  if (gte) range.gte = gte;
  if (lte) range.lte = lte;
  return range;
}
