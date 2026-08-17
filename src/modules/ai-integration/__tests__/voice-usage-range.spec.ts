import { buildVoiceUsageDateRange } from '../voice-usage-range';

/** Mốc kỳ vọng: 00:00 và 23:59:59.999 giờ VN quy về UTC. */
const startOfVnDay = (iso: string) => new Date(`${iso}T00:00:00.000+07:00`);
const endOfVnDay = (iso: string) => new Date(`${iso}T23:59:59.999+07:00`);

describe('buildVoiceUsageDateRange', () => {
  it('neo mốc đầu/cuối ngày theo giờ VN, không theo timezone máy chủ', () => {
    const range = buildVoiceUsageDateRange('2026-08-01', '2026-08-16');
    expect(range?.gte?.toISOString()).toBe('2026-07-31T17:00:00.000Z');
    expect(range?.lte?.toISOString()).toBe('2026-08-16T16:59:59.999Z');
  });

  it('lọc một ngày duy nhất vẫn phủ trọn 24 tiếng của ngày đó', () => {
    const range = buildVoiceUsageDateRange('2026-08-16', '2026-08-16');
    expect(range?.gte).toEqual(startOfVnDay('2026-08-16'));
    expect(range?.lte).toEqual(endOfVnDay('2026-08-16'));
  });

  it('chỉ có date_from thì mở đầu, không chặn đuôi', () => {
    const range = buildVoiceUsageDateRange('2026-08-16', undefined);
    expect(range?.gte).toEqual(startOfVnDay('2026-08-16'));
    expect(range?.lte).toBeUndefined();
  });

  it('chỉ có date_to thì chặn đuôi, không chặn đầu', () => {
    const range = buildVoiceUsageDateRange(undefined, '2026-08-16');
    expect(range?.gte).toBeUndefined();
    expect(range?.lte).toEqual(endOfVnDay('2026-08-16'));
  });

  it('không truyền gì thì trả null để thống kê toàn bộ lịch sử', () => {
    expect(buildVoiceUsageDateRange(undefined, undefined)).toBeNull();
  });

  it('nhập ngược from/to thì đảo lại thay vì trả khoảng rỗng', () => {
    const range = buildVoiceUsageDateRange('2026-08-16', '2026-08-01');
    expect(range?.gte).toEqual(startOfVnDay('2026-08-01'));
    expect(range?.lte).toEqual(endOfVnDay('2026-08-16'));
  });

  it('bỏ qua ngày sai định dạng thay vì tạo Invalid Date', () => {
    expect(buildVoiceUsageDateRange('16-08-2026', undefined)).toBeNull();
    expect(buildVoiceUsageDateRange('hôm-qua', 'hôm-nay')).toBeNull();
  });

  it('bỏ qua ngày không tồn tại (31/02) thay vì trôi sang tháng sau', () => {
    expect(buildVoiceUsageDateRange('2026-02-31', undefined)).toBeNull();
  });

  it('vẫn nhận ngày 29/02 của năm nhuận', () => {
    const range = buildVoiceUsageDateRange('2028-02-29', undefined);
    expect(range?.gte).toEqual(startOfVnDay('2028-02-29'));
  });
});
