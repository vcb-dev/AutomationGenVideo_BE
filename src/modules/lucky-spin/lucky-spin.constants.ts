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
 *
 * TẠM TẮT (07/08/2026, theo yêu cầu người dùng) — danh sách để rỗng nên `laTenKhongDuocTrung`
 * luôn trả về false và mọi người đều có thể trúng. BẬT LẠI: bỏ comment hai dòng tên bên dưới,
 * đồng thời bỏ `.skip` ở hai `describe` trong __tests__/lucky-spin.service.draw.spec.ts.
 */
export const TEN_KHONG_DUOC_TRUNG: string[] = [
  // 'Trần Trung Hiếu',
  // 'Nguyễn Văn Toán',
];

/**
 * Chuẩn hoá tên để so khớp: bỏ dấu, thường hoá, gộp khoảng trắng thừa.
 *
 * Bỏ dấu là yêu cầu rõ ràng của ban tổ chức — file nhân sự mỗi nơi xuất một kiểu ("TRAN TRUNG
 * HIEU", "Tran Trung Hieu"), giữ dấu thì những bản không dấu lọt hết.
 *
 * ĐÁNH ĐỔI ĐÃ BIẾT VÀ ĐÃ CHẤP NHẬN: mọi cái tên bỏ dấu ra cùng chuỗi cũng bị chặn theo. Cụ thể
 * "Nguyễn Văn Toàn"/"Toản" và "Trần Trung Hiệu"/"Hiều" — những tên khác người — đều thành
 * "nguyen van toan"/"tran trung hieu". Có người như vậy trong danh sách thì phải phân biệt bằng
 * thứ khác chứ không sửa được ở đây; file Excel nhập vào chỉ có cột Tên và Team.
 *
 * NFD rồi cắt dải U+0300–U+036F là cách bỏ dấu: tách "ế" thành "e" + dấu rời rồi vứt dấu đi.
 * Riêng "đ" không phải chữ có dấu tổ hợp nên NFD không đụng tới, phải thay tay.
 */
function chuanHoaTen(ten: string): string {
  return ten
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

const TEN_CHAN = new Set(TEN_KHONG_DUOC_TRUNG.map(chuanHoaTen));

export function laTenKhongDuocTrung(ten: string): boolean {
  return TEN_CHAN.has(chuanHoaTen(ten));
}
