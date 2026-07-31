import { Prisma } from '@prisma/client';
import {
  CONTENT_LINES,
  dieuKienThiTruong,
  dieuKienTuyenNoiDung,
  laThiTruongHopLe,
  laTuyenHopLe,
} from './content-filters';

/**
 * Số liệu trong test này lấy từ dữ liệu THẬT (19.971 video Facebook nội bộ), đã đối chiếu
 * giữa API và SQL chạy thẳng vào DB:
 *   A1=5.284  A2=2.227  A3=715  A4=9.462  A5=522   |   VN=14.745  Global=5.226
 */

const COT = Prisma.sql`v.caption`;

/** Prisma.Sql giữ phần chữ ở `strings`, phần giá trị được tham số hoá ở `values`. */
const chu = (s: Prisma.Sql) => s.strings.join('?');
const giaTri = (s: Prisma.Sql) => s.values;

describe('Bộ lọc thị trường VN / Global', () => {
  it('chỉ nhận đúng hai giá trị, sai thì trả null để coi như không lọc', () => {
    expect(laThiTruongHopLe('vn')).toBe(true);
    expect(laThiTruongHopLe('GLOBAL')).toBe(true);
    expect(dieuKienThiTruong(COT, 'xxx')).toBeNull();
    expect(dieuKienThiTruong(COT, '')).toBeNull();
  });

  it('VN và Global là hai vế đối nhau của CÙNG một mẫu chữ', () => {
    const vn = dieuKienThiTruong(COT, 'vn')!;
    const global = dieuKienThiTruong(COT, 'global')!;
    expect(chu(vn)).toContain('~*');
    expect(chu(global)).toContain('!~*');
    // Cùng một mẫu nhận diện tiếng Việt → cộng hai nhóm lại đúng bằng tổng.
    expect(giaTri(vn)).toEqual(giaTri(global));
  });

  it('bọc COALESCE quanh cột chữ — caption NULL mà không bọc thì video rơi khỏi CẢ HAI nhóm', () => {
    // Trong SQL, NULL ~* mẫu cho ra NULL (không phải false), nên WHERE loại nó ở cả nhánh
    // VN lẫn nhánh Global. Người dùng cộng hai con số lại thấy thiếu video mà không hiểu vì sao.
    expect(chu(dieuKienThiTruong(COT, 'vn')!)).toContain('COALESCE');
    expect(chu(dieuKienThiTruong(COT, 'global')!)).toContain('COALESCE');
  });

  it('mẫu nhận diện chỉ gồm chữ có dấu và đ, không có a-z trơn', () => {
    const [mau] = giaTri(dieuKienThiTruong(COT, 'vn')!) as string[];
    expect(mau).toContain('à');
    expect(mau).toContain('đ');
    // Có a-z trơn thì tiếng Anh, tiếng Thái, tiếng Nhật đều bị nhận nhầm là tiếng Việt.
    expect(mau).not.toMatch(/a-z/);
  });
});

describe('Bộ lọc tuyến nội dung A1–A5', () => {
  it('nhận A1 đến A5, không nhận thứ khác', () => {
    for (const ma of CONTENT_LINES) expect(laTuyenHopLe(ma)).toBe(true);
    expect(laTuyenHopLe('A6')).toBe(false);
    expect(laTuyenHopLe('B1')).toBe(false);
    expect(dieuKienTuyenNoiDung(COT, 'A9')).toBeNull();
    expect(dieuKienTuyenNoiDung(COT, '')).toBeNull();
  });

  it('chấp nhận chữ thường và tự chuẩn hoá về chữ hoa', () => {
    const [mau] = giaTri(dieuKienTuyenNoiDung(COT, 'a3')!) as string[];
    expect(mau).toBe('#A3([^[:alnum:]]|$)');
  });

  it('có ranh giới cuối nên lọc A5 KHÔNG vơ nhầm #A54', () => {
    // Dữ liệu thật có đúng một caption gắn #A54. Thiếu ranh giới là nó lọt vào tuyến A5.
    const [mau] = giaTri(dieuKienTuyenNoiDung(COT, 'A5')!) as string[];
    expect(mau).toBe('#A5([^[:alnum:]]|$)');

    // Kiểm bằng chính ngữ nghĩa của mẫu, dịch sang regex của JS để chạy thử được.
    const nhu = new RegExp(mau.replace('[^[:alnum:]]', '[^a-zA-Z0-9]'), 'i');
    expect(nhu.test('mau nhan #A54 khac')).toBe(false);
    expect(nhu.test('mau nhan #A5 dung')).toBe(true);
    expect(nhu.test('cuoi caption #A5')).toBe(true);
    expect(nhu.test('#a5, co dau phay')).toBe(true);
  });

  it('bảng có cột hashtag thì tìm cả trong mảng, so sánh không phân biệt hoa thường', () => {
    const coMang = dieuKienTuyenNoiDung(COT, 'A1', Prisma.sql`v.hashtags`)!;
    expect(chu(coMang)).toContain('unnest');
    expect(chu(coMang)).toContain('lower(t)');
    expect(giaTri(coMang)).toContain('a1');
  });

  it('bảng KHÔNG có cột hashtag thì chỉ tìm trong chữ, không sinh unnest', () => {
    // Video Facebook nội bộ (19.971 cái, gần như toàn bộ dữ liệu nội bộ) nằm ở bảng không
    // có cột hashtags — nên nhánh tìm theo chữ mới là nhánh chính.
    const chiChu = dieuKienTuyenNoiDung(COT, 'A1')!;
    expect(chu(chiChu)).not.toContain('unnest');
    expect(chu(chiChu)).toContain('~*');
  });

  it('mã tuyến đi vào truy vấn dưới dạng THAM SỐ, không nối thẳng vào chuỗi SQL', () => {
    const s = dieuKienTuyenNoiDung(COT, "A1'; DROP TABLE users;--");
    expect(s).toBeNull();                       // chặn ngay từ vòng kiểm giá trị hợp lệ
    const hopLe = dieuKienTuyenNoiDung(COT, 'A1')!;
    expect(chu(hopLe)).not.toContain('A1');     // mã nằm ở values, không nằm trong chữ SQL
  });
});
