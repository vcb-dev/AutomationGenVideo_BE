import {
  DEFAULT_REFRESH_DAYS,
  InvalidRefreshDaysError,
  MAX_REFRESH_DAYS,
  parseRefreshDays,
} from '../parse-refresh-days';

/**
 * Endpoint kéo lại chỉ số nhận `days` để với tới video cũ mà cron 7 ngày không chạm được.
 *
 * Vì sao cần chặn trên: sự cố 27/07–09/08/2026 để lại 1.584 video có view = 0 nằm ngoài top-10
 * của page, nên cả delta sync lẫn cron 12:00 đều không cứu được. Endpoint này là đường duy nhất,
 * nhưng mỗi video là một lượt hỏi Graph API — gõ nhầm `days` một con số lớn là đốt hạn mức app và
 * kéo sập luôn cron cào hằng ngày.
 */
describe('parseRefreshDays', () => {
  it('không truyền gì thì giữ nguyên hành vi cron: 7 ngày', () => {
    expect(parseRefreshDays(undefined)).toBe(DEFAULT_REFRESH_DAYS);
    expect(parseRefreshDays(null)).toBe(DEFAULT_REFRESH_DAYS);
    expect(parseRefreshDays('')).toBe(DEFAULT_REFRESH_DAYS);
  });

  it('nhận số nguyên hợp lệ', () => {
    expect(parseRefreshDays(1)).toBe(1);
    expect(parseRefreshDays(20)).toBe(20);
    expect(parseRefreshDays(MAX_REFRESH_DAYS)).toBe(MAX_REFRESH_DAYS);
  });

  // Body JSON hay gửi "20" thay vì 20.
  it('nhận cả chuỗi số và khoảng trắng thừa', () => {
    expect(parseRefreshDays('20')).toBe(20);
    expect(parseRefreshDays('  16  ')).toBe(16);
  });

  it('chặn vượt trần — đây là lá chắn hạn mức Graph API', () => {
    expect(() => parseRefreshDays(MAX_REFRESH_DAYS + 1)).toThrow(InvalidRefreshDaysError);
    expect(() => parseRefreshDays(9999)).toThrow(/tối đa/);
  });

  it('chặn số 0 và số âm', () => {
    expect(() => parseRefreshDays(0)).toThrow(InvalidRefreshDaysError);
    expect(() => parseRefreshDays(-5)).toThrow(/>= 1/);
  });

  it('chặn số thập phân', () => {
    expect(() => parseRefreshDays(7.5)).toThrow(/nguyên/);
  });

  it('chặn thứ không phải số', () => {
    expect(() => parseRefreshDays('abc')).toThrow(InvalidRefreshDaysError);
    expect(() => parseRefreshDays({})).toThrow(InvalidRefreshDaysError);
    expect(() => parseRefreshDays(true)).toThrow(InvalidRefreshDaysError);
    expect(() => parseRefreshDays(NaN)).toThrow(/phải là số/);
    expect(() => parseRefreshDays(Infinity)).toThrow(/phải là số/);
  });
});
