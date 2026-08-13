/**
 * Quy tắc chọn video vào báo cáo tuần. Tách khỏi service để test được mà không cần DB —
 * cùng lối với `scraper-aggregate/content-filters.ts`.
 */

/** Video phải sống đủ 7 ngày mới chốt số, để mọi video được đo trên cùng độ dài vòng đời. */
export const FULL_WEEK_DAYS = 7;

/**
 * Chặn dưới của cửa sổ. Kho có 20.515 video, cũ nhất 11/02/2022 — bỏ chặn này thì lần chạy đầu
 * tiên coi TOÀN BỘ kho là "đã tròn 7 ngày và chưa gửi" rồi bắn ngược hai chục nghìn video.
 *
 * 14 ngày là gấp đôi mốc 7 ngày: cron hỏng liên tiếp cả tuần vẫn bù kịp, mà không với tay tới
 * dữ liệu cũ.
 */
export const WINDOW_BOUNDARY_DAYS = 14;

/** Số lượt thử tối đa với bản ghi lỗi. Lỗi lặp 3 lần thì không còn là lỗi mạng. */
export const MAX_ATTEMPTS = 3;

/**
 * Chỉ báo video ĐÃ BÙNG NỔ: đạt mốc view này trong vòng 7 ngày đầu.
 *
 * Đo trên 60 ngày thật: 8.431 video tròn 7 ngày, trong đó 9 video đạt 1 triệu view — tức
 * khoảng 1 video/tuần, phần lớn các ngày sẽ không có message nào. Ngưỡng thấp hơn cho tần suất
 * dày hơn: 500K → ~3/tuần · 200K → ~1/ngày · 100K → ~2/ngày.
 *
 * Đọc đè bằng WEEKLY_REPORT_VIEW_THRESHOLD để đổi ngưỡng mà không phải sửa code.
 */
export const DEFAULT_VIEW_THRESHOLD = 1_000_000;

/**
 * Lọc video đạt ngưỡng. Phải chạy SAU khi làm mới chỉ số — lọc trên số cũ thì một video vừa
 * chạm mốc trong đêm sẽ bị bỏ sót, mà hôm sau nó đã bị chốt nên không bao giờ được báo nữa.
 */
export function filterByThreshold<T extends { view_count: number }>(videos: T[], threshold: number) {
  const aboveThreshold: T[] = [];
  const belowThreshold: T[] = [];
  for (const v of videos) (v.view_count >= threshold ? aboveThreshold : belowThreshold).push(v);
  return { aboveThreshold, belowThreshold };
}

const NGAY_MS = 86_400_000;

export interface PostingWindow {
  /** Bao gồm mốc này. */
  tuNgay: Date;
  /** KHÔNG bao gồm mốc này — video vừa đúng 7 ngày mới được vào. */
  denNgay: Date;
}

export function computeWindow(bayGio: Date): PostingWindow {
  return {
    tuNgay: new Date(bayGio.getTime() - WINDOW_BOUNDARY_DAYS * NGAY_MS),
    denNgay: new Date(bayGio.getTime() - FULL_WEEK_DAYS * NGAY_MS),
  };
}

export interface LogRecord {
  post_id: string;
  trang_thai: string;
  so_lan_thu: number;
}

/**
 * Bản ghi đã xong hẳn, không đưa video vào lô nữa.
 *
 * `loi` chưa đủ lượt thì CHƯA chốt: một cú rớt mạng không đáng để mất hẳn video khỏi báo cáo.
 */
export function isFinalRecord(log: Pick<LogRecord, 'trang_thai' | 'so_lan_thu'>): boolean {
  if (
    log.trang_thai === 'da_gui' ||
    log.trang_thai === 'khong_co_nguoi_nhan' ||
    // Không đạt ngưỡng ở mốc 7 ngày là XONG, không xét lại: yêu cầu là "trong 1 tuần đạt 1
    // triệu view". Video lên 1 triệu ở ngày thứ 10 không thoả điều kiện đó, nên chốt luôn để
    // hôm sau không đưa vào lô lần nữa.
    log.trang_thai === 'duoi_nguong'
  ) {
    return true;
  }
  return log.trang_thai === 'loi' && log.so_lan_thu >= MAX_ATTEMPTS;
}

export function filterUnfinalizedVideos<T extends { post_id: string }>(
  videos: T[],
  log: Pick<LogRecord, 'post_id' | 'trang_thai' | 'so_lan_thu'>[],
): T[] {
  const finalized = new Set(log.filter(isFinalRecord).map((l) => l.post_id));
  return videos.filter((v) => !finalized.has(v.post_id));
}
