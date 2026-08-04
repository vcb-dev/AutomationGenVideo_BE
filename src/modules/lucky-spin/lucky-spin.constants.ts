/**
 * Danh sách vòng quay cố định trong code thay vì bắt admin tự tạo.
 *
 * Service tự tạo bản ghi khi lần đầu có người mở, nên môi trường mới (staging, máy đồng nghiệp)
 * chạy được ngay mà không cần seed tay.
 */
export const SPIN_WORKSPACES = [
  { slug: 'seci', name: 'SECI', orderIndex: 0 },
  { slug: 'tridao', name: 'Đào tạo cán bộ nguồn', orderIndex: 1 },
] as const;

export type SpinWorkspaceSlug = (typeof SPIN_WORKSPACES)[number]['slug'];

/** Người/team không thuộc team nào — hiển thị trong lịch sử thay vì để trống. */
export const NO_TEAM_LABEL = '—';

/**
 * Thời gian khóa điều khiển còn hiệu lực sau nhịp heartbeat cuối.
 *
 * Đủ dài để MC nói chuyện vài phút giữa hai lượt quay mà không mất quyền, đủ ngắn để nếu MC
 * đóng máy giữa chừng thì người khác tiếp quản được mà không phải chờ lâu.
 */
export const CONTROL_TTL_MS = 3 * 60 * 1000;

/**
 * Số dòng lịch sử trả về trong mỗi lần poll.
 *
 * Mọi người đang mở trang đều gọi getState 5 giây một lần. Trả toàn bộ lịch sử của một buổi sự
 * kiện lớn cho hàng chục người xem là lãng phí vô ích — màn hình chỉ hiển thị được vài chục
 * dòng đầu. Xuất Excel/PDF dùng endpoint riêng để lấy đủ.
 */
export const HISTORY_POLL_LIMIT = 100;

/**
 * Thời gian bánh xe chuyển động. Phải khớp với SPIN_DURATION_MS bên FE
 * (src/lib/lucky-spin/spin-rotation.ts) để màn hình người xem đồng bộ với màn hình điều khiển.
 */
export const SPIN_DURATION_MS = 5000;

/** Tối đa số người bốc trong một lượt, chặn người dùng gõ nhầm 1000. */
export const MAX_DRAW_COUNT = 20;
