import { isMediaTeam } from '../media-team';

/**
 * Chức năng: "người này có thuộc Team Media không" — câu hỏi chốt mọi quyền quản lý kho thiết bị.
 *
 * Vì sao đáng một file test riêng: hàm này là cửa duy nhất phân biệt Leader/Manager được điều
 * phối kho với Leader/Manager bộ phận khác. Nới một chút là mở quyền xoá máy và duyệt phiếu cho
 * người ngoài; siết quá tay là khoá đúng người đang giữ kho.
 *
 * `team` là chuỗi tên team nối bằng dấu phẩy, đồng bộ từ bảng Team chứ không phải khoá ngoại —
 * một người có thể thuộc nhiều team, ví dụ "MEDIA,Scale Data,Team K1".
 */
describe('isMediaTeam', () => {
  it('đúng tên team Media thì nhận', () => {
    expect(isMediaTeam('MEDIA')).toBe(true);
  });

  it('không phân biệt hoa thường và bỏ qua khoảng trắng thừa', () => {
    expect(isMediaTeam('media')).toBe(true);
    expect(isMediaTeam('  Media  ')).toBe(true);
  });

  it('nằm trong danh sách nhiều team vẫn nhận', () => {
    // Giá trị có thật trong dữ liệu hiện tại.
    expect(isMediaTeam('MEDIA,Scale Data,Team K1')).toBe(true);
    expect(isMediaTeam('Team K1, MEDIA')).toBe(true);
  });

  it('tên team chỉ CHỨA chữ media thì KHÔNG được tính là Team Media', () => {
    // Đây là chỗ luật cũ hở: so khớp bằng "có chứa" nên chỉ cần đặt tên team khéo là leo được
    // lên quyền quản lý kho — xoá thiết bị, duyệt phiếu, đọc nhật ký mượn của cả công ty.
    expect(isMediaTeam('Social Media')).toBe(false);
    expect(isMediaTeam('Multimedia')).toBe(false);
    expect(isMediaTeam('Media Buying')).toBe(false);
    expect(isMediaTeam('Team K1,Social Media')).toBe(false);
  });

  it('không khai team thì KHÔNG được coi là Media', () => {
    // Ca từng làm hai bản luật bất đồng nhau: guard coi là không, tầng ký lại coi là có.
    expect(isMediaTeam(null)).toBe(false);
    expect(isMediaTeam(undefined)).toBe(false);
    expect(isMediaTeam('')).toBe(false);
    expect(isMediaTeam('   ')).toBe(false);
  });
});
