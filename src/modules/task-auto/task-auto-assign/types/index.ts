// ── Constants ─────────────────────────────────────────────────────────────────

export const DEADLINE_CALENDAR_DAYS = 1;
export const DEFAULT_TZ = "Asia/Ho_Chi_Minh";
/** Tuyến nội dung duy nhất hệ thống tự chia task — khớp content_lines.name, không phân biệt hoa thường. */
export const AUTO_ASSIGN_CONTENT_LINE_NAME = "A4";
/** Dòng sản phẩm duy nhất được lấy để chia task tự động — khớp product_lines.name, không phân biệt hoa thường. */
export const AUTO_ASSIGN_PRODUCT_LINE_NAME = "GMV";
/** Giãn cách giao lại cùng 1 SP cho cùng 1 editor khi team chưa có cấu hình. */
export const DEFAULT_COOLDOWN_DAYS = 5;
/** Tuyến lập Kế hoạch ngày khi settings chưa có giá trị (khớp default cột auto_assign_settings.daily_plan_line_names). */
export const DEFAULT_DAILY_PLAN_LINE_NAMES = ["A1", "A2", "A3", "A5"];

// ── Kho sản phẩm team ───────────────────────────────────────────────────────────

export type TeamProductCandidate = {
  id: string;
  name: string | null;
  product_line_id: string | null;
  priority_score: number;
  /** Quota video của team cho sản phẩm trong tháng; 0 = không đặt quota, chia đều ở lane sau. */
  target_quantity: number;
  // Product kho tổng tương ứng (tự có hoặc qua editor product gốc) — dùng tra outro source
  source_product_id: string | null;
  // Nhận diện cùng 1 SP ở kho cá nhân/kho tổng — để task tạo tay gắn SP đó vẫn tính cooldown
  sku: string | null;
  oms_variant_id: string | null;
  source_editor_product_id: string | null;
};

// ── Editor ────────────────────────────────────────────────────────────────────

export type A4EditorQuota = {
  userId: string;
  /** KPI tháng của tuyến A4 (EditorKpiAllocation CONTENT_LINE) */
  monthlyTarget: number;
  /** Task A4 (chưa huỷ) có hạn trong tháng KPI — gồm cả task tạo tay */
  assignedThisMonth: number;
  /** Số task A4 còn phải giao cho ngày hiệu lực (ngày mai) */
  remainingToday: number;
};

/** Chỉ tiêu ngày hiệu lực của 1 editor cho 1 tuyến nội dung (KPI tháng rải đều các ngày còn lại). */
export type LineQuota = A4EditorQuota & {
  contentLineId: string;
  /** Số task tuyến này cần có hạn vào ngày hiệu lực — gồm cả task đã có (onDay) */
  dailyTarget: number;
  /** Task tuyến này (chưa huỷ) đã có hạn vào ngày hiệu lực */
  onDay: number;
};

// ── Assignment ────────────────────────────────────────────────────────────────

export type ScheduledAssignment = {
  editorId: string;
  product: TeamProductCandidate;
};

export type TeamResult = { assigned: number; skipped: number };
