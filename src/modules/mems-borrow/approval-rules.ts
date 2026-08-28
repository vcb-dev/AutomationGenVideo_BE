/**
 * BR-22: phiếu cần những chữ ký nào.
 *
 * Cố ý KHÔNG chạm Prisma, giống `availability.ts` và `return-rules.ts`.
 *
 * Cấp hai không phải "một người nữa bất kỳ" mà đích danh admin, vì admin đứng ngoài luồng
 * thường ngày. Trả về số cấp thì hai leader ký nhau cũng qua, mà đó là bỏ mất chính người cần
 * biết — nên hàm trả về VAI TRÒ của từng cấp.
 *
 * Thứ quyết định số cấp là MỤC ĐÍCH mượn, không phải địa điểm hay giá trị. Trước đây cứ mang
 * máy ra khỏi công ty là phải qua admin, nhưng đi quay ngoại cảnh và đi sự kiện là việc thường
 * ngày của cả kho — bắt qua admin thì nghẽn. Còn mượn cho việc RIÊNG thì admin phải biết, dù
 * chỉ mượn một buổi và dù máy rẻ.
 */

export type ApproverRole = 'LEADER' | 'ADMIN';

/**
 * Mục đích mượn. `PERSONAL` là mượn phục vụ việc riêng của người mượn, không phải việc của
 * công ty — đây là thứ quyết định phiếu cần một hay hai chữ ký.
 */
export type BorrowPurpose = 'WORK' | 'PERSONAL';

export interface ApprovalStep {
  level: 1 | 2;
  role: ApproverRole;
  reason: string;
  /**
   * Admin có được ký thay cấp này không.
   *
   * Bật trên phiếu công việc: bộ phận chỉ có một leader mà chính họ đứng tên phiếu thì không
   * còn ai khác ký, admin phải gỡ được thế bí. Tắt trên phiếu cá nhân: ở đó admin đã là cấp
   * hai rồi, cho ký thay cấp một nữa thì một người bấm hai lần là xong cả phiếu.
   */
  adminProxyAllowed: boolean;
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

export interface ApprovalPlanInput {
  totalValue: number;
  fromTime: Date;
  toTime: Date;
  place: string;
  /** Bỏ trống thì coi là việc công ty — phiếu cũ trong DB không có cột này. */
  purpose?: BorrowPurpose;
}

export function planApprovals(input: ApprovalPlanInput): ApprovalPlan {
  const hours = (input.toTime.getTime() - input.fromTime.getTime()) / 3_600_000;
  const isPersonal = input.purpose === 'PERSONAL';

  // Phiếu công việc chỉ cần 1 chữ ký: Admin, Manager hoặc Leader duyệt là hoàn tất.
  const steps: ApprovalStep[] = [
    {
      level: 1,
      role: 'LEADER',
      reason: isPersonal
        ? 'phiếu mượn cá nhân cần leader ký trước'
        : 'Cần một chữ ký phê duyệt của Leader hoặc Admin',
      adminProxyAllowed: !isPersonal,
    },
  ];
  const warnings: string[] = [];

  // Máy rời khỏi việc của công ty thì admin phải biết, dù mượn ngắn và dù máy rẻ.
  if (isPersonal) {
    steps.push({
      level: 2,
      role: 'ADMIN',
      reason: 'thiết bị mượn cho việc cá nhân',
      adminProxyAllowed: false,
    });
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
 * Cấp của admin thì chỉ admin ký — leader ký thay được thì cửa canh tài sản chỉ còn là hình
 * thức. Cấp của leader thì leader và manager luôn ký được, còn admin chỉ ký thay khi cấp đó
 * cho phép (phiếu công việc), xem `adminProxyAllowed`.
 */
export function canSign(step: ApprovalStep, roles: string[]): boolean {
  if (step.role === 'ADMIN') return roles.includes('ADMIN');
  if (roles.includes('LEADER') || roles.includes('MANAGER')) return true;
  return step.adminProxyAllowed && roles.includes('ADMIN');
}
