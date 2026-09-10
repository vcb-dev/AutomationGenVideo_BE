/**
 * "Người này có thuộc Team Media không" — nguồn DUY NHẤT trả lời câu hỏi đó.
 *
 * Trước đây câu trả lời nằm ở hai chỗ viết tay giống nhau (`mems-media-leader.guard.ts` và
 * `approval-rules.ts`) và hai chỗ đó bất đồng đúng ở ca khó nhất: `team === undefined`. Guard
 * coi là KHÔNG phải Media (chặn), còn `canSign` coi là Media (cho qua) — nghĩa là bất kỳ lời
 * gọi nào quên truyền `team` đều biến cửa canh thành hình thức.
 *
 * Cố ý KHÔNG chạm Prisma và không phụ thuộc Nest: cả guard lẫn tầng luật thuần đều nạp được.
 *
 * `team` là chuỗi tên team nối bằng dấu phẩy, đồng bộ từ bảng Team chứ không phải khoá ngoại —
 * một người thuộc nhiều team sẽ có giá trị kiểu "MEDIA,Scale Data,Team K1".
 *
 * So khớp CHÍNH XÁC từng tên, không dùng "có chứa". Bản trước dùng "có chứa" nên một team đặt
 * tên "Social Media" hay "Multimedia" là leo thẳng lên quyền quản lý kho: xoá thiết bị, duyệt
 * phiếu, đọc nhật ký mượn của cả công ty. Tên team do người dùng đặt được, nên đó là cửa mở sẵn
 * chứ không phải rủi ro lý thuyết.
 *
 * Danh sách tên tách thành hằng số vì bộ phận có thể đổi tên hoặc tách team; sửa ở đây là đủ.
 * Việc nên làm về sau: chuyển hẳn sang khoá ngoại, hoặc dùng bảng `MemsMember.role` — bảng đó
 * đã có trong schema nhưng hiện chưa có dòng nào, nên lấy nó làm nguồn quyền lúc này sẽ khoá
 * cửa mọi người trừ ADMIN toàn hệ thống.
 */
const MEDIA_TEAM_NAMES = ['media'];

export function isMediaTeam(team?: string | null): boolean {
  if (!team) return false;
  return team
    .split(',')
    .some((name) => MEDIA_TEAM_NAMES.includes(name.trim().toLowerCase()));
}
