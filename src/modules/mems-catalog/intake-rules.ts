/**
 * Tình trạng khai lúc nhập kho quyết định máy vào kệ ngay hay đi bàn kiểm tra.
 *
 * Tách khỏi service theo đúng nếp của `approval-rules.ts` và `return-rules.ts`: luật nghiệp vụ
 * là thứ dễ sửa nhầm nhất, nên nó phải test được mà không cần dựng cả service kèm Prisma giả.
 */

/** Khai là Tốt hoặc Đã dùng thì không có gì để kiểm — vào kệ luôn. */
const INTAKE_READY_CONDITIONS = ['GOOD', 'USED'];

/**
 * `status` là vị trí trong quy trình, `condition` là chất lượng vật lý — hai trục khác nhau.
 *
 * Máy khai hỏng mà vào thẳng Sẵn sàng thì phép đếm khả dụng hứa với người mượn một chiếc không
 * dùng được, và chỉ vỡ ra lúc bàn giao, khi người ta đã tới lấy.
 */
export function intakeStatusFor(condition: string): 'AVAILABLE' | 'PENDING_INSPECTION' {
  return INTAKE_READY_CONDITIONS.includes(condition) ? 'AVAILABLE' : 'PENDING_INSPECTION';
}
