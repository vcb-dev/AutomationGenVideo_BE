/**
 * BR-22: phiếu cần những chữ ký nào.
 *
 * Cố ý KHÔNG chạm Prisma, giống `availability.ts` và `return-rules.ts`.
 *
 * Bản trước trả về SỐ CẤP — một hoặc hai. Không đủ nữa: cấp hai không phải "một người nữa bất
 * kỳ" mà đích danh admin, vì admin đứng ngoài luồng thường ngày và chỉ ký khi tài sản rời khỏi
 * công ty. Trả về số cấp thì hai leader ký nhau cũng qua, mà đó là bỏ mất chính người cần biết.
 */

export type ApproverRole = 'LEADER' | 'ADMIN';

export interface ApprovalStep {
  level: 1 | 2;
  role: ApproverRole;
  reason: string;
}

export interface ApprovalPlan {
  steps: ApprovalStep[];
  /**
   * Điều kiện đáng chú ý nhưng KHÔNG thêm chữ ký — hiện cho người duyệt thấy trước khi ký.
   * Giá trị lớn hay mượn dài là chuyện điều độ nội bộ, máy vẫn trong tầm kiểm soát.
   */
  warnings: string[];
}

const VALUE_THRESHOLD = 50_000_000;
const HOURS_THRESHOLD = 168; // 7 ngày

/** Địa điểm coi là trong công ty — so sau khi chuẩn hoá chữ thường và bỏ khoảng trắng thừa. */
const INTERNAL_PLACES = ['hà nội', 'văn phòng', 'công ty', 'studio'];

export interface ApprovalPlanInput {
  totalValue: number;
  fromTime: Date;
  toTime: Date;
  place: string;
}

export function planApprovals(input: ApprovalPlanInput): ApprovalPlan {
  const hours = (input.toTime.getTime() - input.fromTime.getTime()) / 3_600_000;
  const place = input.place.trim().toLowerCase();

  const steps: ApprovalStep[] = [
    { level: 1, role: 'LEADER', reason: 'phiếu nào cũng cần một chữ ký của leader' },
  ];
  const warnings: string[] = [];

  // Địa điểm bỏ trống chưa phải là ngoài công ty — người dùng mới chỉ chưa điền.
  if (place !== '' && !INTERNAL_PLACES.includes(place)) {
    steps.push({ level: 2, role: 'ADMIN', reason: 'thiết bị mang ra ngoài công ty' });
  }

  if (input.totalValue > VALUE_THRESHOLD) warnings.push('giá trị vượt 50 triệu');
  if (hours > HOURS_THRESHOLD) warnings.push('mượn dài hơn 7 ngày');

  return { steps, warnings };
}

/** Cấp kế tiếp đang chờ ai ký. Trả null nghĩa là đã đủ chữ ký. */
export function nextStep(plan: ApprovalPlan, approvedCount: number): ApprovalStep | null {
  return plan.steps[approvedCount] ?? null;
}

/**
 * Người này có quyền ký cấp đang tới lượt không.
 *
 * Admin ký thay được cấp của leader — dùng cho đúng một trường hợp: bộ phận chỉ có một leader
 * và chính họ là người đứng tên phiếu, không còn ai khác ký. Chiều ngược lại thì không:
 * leader KHÔNG ký thay được cấp của admin, nếu không thì cửa canh tài sản ra khỏi công ty
 * trở thành hình thức.
 */
export function canSign(step: ApprovalStep, roles: string[]): boolean {
  if (roles.includes('ADMIN')) return true;
  return step.role === 'LEADER' && (roles.includes('LEADER') || roles.includes('MANAGER'));
}
