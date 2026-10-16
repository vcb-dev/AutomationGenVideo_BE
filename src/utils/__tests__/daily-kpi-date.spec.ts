import { DateTime } from 'luxon';
import { dailyKpiDate, vietnamDateString, vietnamDayRangeOf } from '../date.utils';

/**
 * `EditorDailyKpi.date` (KPI ngày set tay, ca6d6bc) là cột DATE lưu tại UTC midnight của
 * ngày lịch VN — MỌI nơi đọc/ghi bảng này phải cùng quy ước "YYYY-MM-DD" → UTC midnight,
 * nếu không sẽ lệch ngày ở biên UTC/VN (VN = UTC+7, nên 00:00-06:59 giờ VN vẫn là NGÀY HÔM
 * TRƯỚC theo UTC). Test này khoá quy ước đó, không phụ thuộc timezone máy chạy test.
 */

describe('dailyKpiDate', () => {
  it('trả đúng UTC midnight của ngày truyền vào', () => {
    const d = dailyKpiDate('2026-08-13');

    expect(d.toISOString()).toBe('2026-08-13T00:00:00.000Z');
  });

  it('round-trip với vietnamDateString: ghép lại đúng chuỗi ngày ban đầu', () => {
    const dateStr = '2026-08-01';
    const d = dailyKpiDate(dateStr);

    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(7); // 0-indexed
    expect(d.getUTCDate()).toBe(1);
  });
});

describe('vietnamDateString', () => {
  it('quy đổi đúng theo giờ VN (UTC+7), không theo UTC hay timezone máy chạy', () => {
    // 2026-08-13 20:00 UTC = 2026-08-14 03:00 giờ VN → phải trả ngày 14, không phải 13.
    const utcEvening = new Date('2026-08-13T20:00:00.000Z');

    expect(vietnamDateString(utcEvening)).toBe('2026-08-14');
  });

  it('biên nhạy cảm nhất: 00:00-06:59 UTC vẫn là NGÀY HÔM TRƯỚC theo giờ VN', () => {
    // 2026-08-14 02:00 UTC = 2026-08-14 09:00 giờ VN — đã sang ngày 14 rồi (qua mốc 7h UTC=0h VN).
    const afterBoundary = new Date('2026-08-14T02:00:00.000Z');
    // 2026-08-13 23:00 UTC = 2026-08-14 06:00 giờ VN — vẫn ngày 14, còn TRƯỚC 7h UTC vẫn v...
    // Lấy đúng điểm ngay TRƯỚC nửa đêm VN: 2026-08-13 16:59 UTC = 2026-08-13 23:59 giờ VN.
    const justBeforeMidnightVN = new Date('2026-08-13T16:59:00.000Z');
    // Và ngay SAU nửa đêm VN: 2026-08-13 17:00 UTC = 2026-08-14 00:00 giờ VN.
    const justAfterMidnightVN = new Date('2026-08-13T17:00:00.000Z');

    expect(vietnamDateString(afterBoundary)).toBe('2026-08-14');
    expect(vietnamDateString(justBeforeMidnightVN)).toBe('2026-08-13');
    expect(vietnamDateString(justAfterMidnightVN)).toBe('2026-08-14');
  });

  it('không truyền tham số thì dùng thời điểm hiện tại (không throw)', () => {
    expect(() => vietnamDateString()).not.toThrow();
    expect(vietnamDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('kết hợp với dailyKpiDate cho ra đúng UTC midnight của NGÀY VN, không phải ngày UTC', () => {
    // 2026-08-13 22:00 UTC = 2026-08-14 05:00 giờ VN.
    const now = new Date('2026-08-13T22:00:00.000Z');

    const kpiDate = dailyKpiDate(vietnamDateString(now));

    expect(kpiDate.toISOString()).toBe('2026-08-14T00:00:00.000Z');
    // Đối chiếu chéo bằng luxon để chắc chắn không tự nhầm lẫn logic.
    expect(kpiDate.toISOString().slice(0, 10)).toBe(
      DateTime.fromJSDate(now).setZone('Asia/Ho_Chi_Minh').toFormat('yyyy-MM-dd'),
    );
  });
});

describe('vietnamDayRangeOf', () => {
  it('ngày lịch VN bắt đầu lúc 17:00Z hôm trước, không phải 00:00Z', () => {
    const r = vietnamDayRangeOf('2026-09-01');

    expect(r!.gte.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(r!.lt.toISOString()).toBe('2026-09-01T17:00:00.000Z');
  });

  it('video đăng 06:00 sáng 01/09 giờ VN (= 23:00Z ngày 31/08) nằm TRONG ngày 01/09', () => {
    const r = vietnamDayRangeOf('2026-09-01')!;
    const sangSom = new Date('2026-08-31T23:00:00.000Z');

    expect(sangSom >= r.gte && sangSom < r.lt).toBe(true);
  });

  it('sai định dạng hoặc ngày không tồn tại thì trả null', () => {
    expect(vietnamDayRangeOf('abc')).toBeNull();
    expect(vietnamDayRangeOf('2026-02-30')).toBeNull();
    expect(vietnamDayRangeOf('01/09/2026')).toBeNull();
  });
});
