import {
  facebookDurationCoverage,
  shouldWarnDurationCoverage,
} from '../owned-duplicate.service';

/**
 * Khoá gom nhóm trùng lặp là (nền tảng, caption, độ dài). Riêng Facebook, độ dài không có
 * cột riêng mà phải moi từ tham số `efg` base64 nhúng trong `video_url`. Facebook đổi format
 * URL một cái là toàn bộ độ dài về NULL, khoá tụt xuống còn mỗi caption — số liệu trùng lặp
 * sai theo hướng BÁO THỪA, và không có gì trên trang hay trong log nói rằng đã hỏng.
 *
 * Nên đo tỷ lệ đọc được độ dài mỗi lần tính, và ghi log cảnh báo khi nó sụp.
 */
describe('Độ phủ độ dài video Facebook', () => {
  it('đọc được hết thì 100%', () => {
    expect(facebookDurationCoverage(200, 0)).toBe(100);
  });

  it('mất một nửa thì 50%', () => {
    expect(facebookDurationCoverage(200, 100)).toBe(50);
  });

  it('làm tròn một chữ số thập phân', () => {
    expect(facebookDurationCoverage(3, 1)).toBe(66.7);
  });

  it('chưa có video Facebook nào thì coi như đủ, không báo động', () => {
    expect(facebookDurationCoverage(0, 0)).toBe(100);
    expect(shouldWarnDurationCoverage(0, 100)).toBe(false);
  });

  it('cảnh báo khi độ phủ sụp và có đủ mẫu', () => {
    expect(shouldWarnDurationCoverage(200, facebookDurationCoverage(200, 180))).toBe(true);
  });

  it('không cảnh báo khi độ phủ còn tốt', () => {
    expect(shouldWarnDurationCoverage(200, facebookDurationCoverage(200, 10))).toBe(false);
  });

  it('mẫu quá nhỏ thì im lặng dù tỷ lệ xấu — 3 video hỏng không phải sự cố', () => {
    expect(shouldWarnDurationCoverage(3, facebookDurationCoverage(3, 3))).toBe(false);
  });

  it('đúng ngay tại ngưỡng 50% thì chưa báo, dưới mới báo', () => {
    expect(shouldWarnDurationCoverage(100, 50)).toBe(false);
    expect(shouldWarnDurationCoverage(100, 49.9)).toBe(true);
  });
});
