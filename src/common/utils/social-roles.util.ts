/**
 * Phân nhóm vai trò cho các màn hình mạng xã hội (tài khoản kết nối, lịch sử đăng bài).
 *
 * MANAGER xếp cùng nhóm ADMIN: cả hai đều nhìn toàn hệ thống. LEADER nhìn phạm vi team,
 * MEMBER chỉ nhìn phần của mình.
 *
 * Tách ra khỏi history.service.ts để hai màn hình không lệch nhau — trước đây mỗi nơi tự
 * khai một bản, sửa một chỗ quên chỗ kia là chuyện sớm muộn.
 */
const ADMIN_ROLES = ['ADMIN', 'MANAGER'];
const LEADER_ROLES = ['LEADER'];

/** ADMIN hoặc MANAGER — nhìn được toàn hệ thống. */
export function isAdminRole(roles: string[] | undefined | null): boolean {
  return (roles ?? []).some((r) => ADMIN_ROLES.includes(r));
}

/** LEADER thuần (không kèm quyền admin) — nhìn phạm vi team. */
export function isLeaderRole(roles: string[] | undefined | null): boolean {
  return !isAdminRole(roles) && (roles ?? []).some((r) => LEADER_ROLES.includes(r));
}

/**
 * Điều kiện lọc danh sách tài khoản mạng xã hội theo người gọi.
 *
 * ADMIN/MANAGER thấy toàn bộ; LEADER và MEMBER chỉ thấy tài khoản do chính mình liên kết.
 *
 * `is_shared` CỐ TÌNH không tham gia: nó là cờ cho phép người khác ĐĂNG BÀI lên tài khoản,
 * không phải cờ hiển thị. Trộn hai khái niệm này chính là thứ khiến 287/287 tài khoản của
 * 3 người hiện ra với tất cả mọi người — cộng thêm một câu UPDATE trong onModuleInit ép
 * `is_shared = true` mỗi lần backend khởi động, khiến nút tắt chia sẻ không bao giờ ăn.
 */
export function buildAccountVisibilityWhere(
  userId: string,
  callerRoles: string[] | undefined | null,
): { is_active: true; user_id?: string } {
  if (isAdminRole(callerRoles)) return { is_active: true };
  return { is_active: true, user_id: userId };
}
