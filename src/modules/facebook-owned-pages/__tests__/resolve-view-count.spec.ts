import { resolveViewCount } from '../resolve-view-count';

/**
 * Sync hằng ngày KHÔNG được ghi 0 đè lên lượt xem thật khi không lấy được số.
 *
 * Đây là nửa còn lại của sự cố 27/07–09/08/2026. Nửa đầu (metric Reels bị khai tử) đã vá bên AI.
 * Nửa này ở BE: `upsertVideos` dùng chung một object `data` cho cả create lẫn update, với
 * `BigInt(v.view_count || 0)` — nên `null` (không lấy được) biến thành 0 rồi ghi đè lên video
 * đang có số thật. Cron 07:00 chạy mỗi sáng nên chỉ vài ngày là xoá sạch cả kho.
 */
describe('resolveViewCount', () => {
  it('lấy được số thì ghi đúng số đó', () => {
    expect(resolveViewCount(486, BigInt(100))).toBe(BigInt(486));
  });

  it('KHÔNG lấy được (null) thì giữ nguyên số cũ, không ghi 0 đè lên', () => {
    expect(resolveViewCount(null, BigInt(2_400_000))).toBe(BigInt(2_400_000));
  });

  it('KHÔNG lấy được (undefined) thì cũng giữ nguyên số cũ', () => {
    expect(resolveViewCount(undefined, BigInt(999))).toBe(BigInt(999));
  });

  // Phân biệt cốt lõi: 0 là câu trả lời THẬT (bài không phải video / chưa ai xem), phải ghi.
  it('lấy được số 0 thì vẫn ghi 0 — đó là câu trả lời thật', () => {
    expect(resolveViewCount(0, BigInt(500))).toBe(BigInt(0));
  });

  it('video mới mà không lấy được thì là 0 — không có số cũ để giữ', () => {
    expect(resolveViewCount(null, null)).toBe(BigInt(0));
    expect(resolveViewCount(null, undefined)).toBe(BigInt(0));
  });

  it('video mới lấy được số thì ghi số đó', () => {
    expect(resolveViewCount(902, undefined)).toBe(BigInt(902));
  });

  it('giữ được số lớn hơn ngưỡng Number an toàn', () => {
    const lon = BigInt('9007199254740993'); // 2^53 + 1
    expect(resolveViewCount(null, lon)).toBe(lon);
  });
});
