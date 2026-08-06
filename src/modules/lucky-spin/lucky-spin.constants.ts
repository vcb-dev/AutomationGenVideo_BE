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

/**
 * Những người không bao giờ được bốc trúng ở vòng quay cá nhân — quyết định của ban tổ chức.
 *
 * Họ vẫn nằm trong danh sách nhân sự và vẫn hiện đủ trên bánh xe; chỉ có ô thắng là không bao
 * giờ rơi vào họ. Danh sách so theo TÊN nên nếu công ty có người thứ hai trùng tên thì người đó
 * cũng bị chặn oan — chưa có cách nào tránh vì file Excel nhập vào chỉ có cột Tên và Team.
 */
export const TEN_KHONG_DUOC_TRUNG = ['Trần Trung Hiếu', 'Nguyễn Văn Toán'];

/**
 * Chuẩn hoá tên để so khớp: gộp về NFC, thường hoá, gộp khoảng trắng thừa.
 *
 * CỐ Ý GIỮ DẤU. Bỏ dấu thì "Nguyễn Văn Toàn" — một cái tên khác, rất phổ biến — cũng thành
 * "nguyen van toan" và bị chặn oan. Đổi lại, file nhân sự viết không dấu sẽ lọt: gặp trường hợp
 * đó thì thêm thẳng cách viết không dấu vào `TEN_KHONG_DUOC_TRUNG`.
 *
 * NFC là bắt buộc: Excel xuất ra máy Mac hay để "ế" ở dạng tổ hợp (e + dấu rời), so chuỗi thô
 * với bản gõ sẵn trong code sẽ không khớp dù nhìn giống hệt nhau.
 */
function chuanHoaTen(ten: string): string {
  return ten.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

const TEN_CHAN = new Set(TEN_KHONG_DUOC_TRUNG.map(chuanHoaTen));

export function laTenKhongDuocTrung(ten: string): boolean {
  return TEN_CHAN.has(chuanHoaTen(ten));
}
