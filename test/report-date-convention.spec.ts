import { WorkReportService as LarkService } from '../src/modules/work-report/work-report.service';

/**
 * Chức năng: quy ước ngày của báo cáo hằng ngày.
 *
 * Nghiệp vụ: nộp sáng ngày S là báo cáo VỀ ngày S-1 (checklist hỏi "hôm qua bạn làm gì"). Cột
 * `date` vì thế lưu ngày S-1, và mọi chỗ ĐỌC lại phải trừ đúng 1 ngày. Lệch một ngày ở bất kỳ đầu
 * nào thì người dùng nộp xong mở lên thấy "chưa báo cáo" — đúng triệu chứng đã được báo.
 *
 * Vì sao đáng một file riêng: `previousVietnamDateKey` chỉ được gọi ở 5 nơi trong toàn bộ backend.
 * Thêm một màn hình đọc mới mà quên trừ ngày là lỗi im lặng, không có gì báo.
 *
 * Múi giờ là phần dễ sai nhất: mốc ngày phải tính theo Asia/Ho_Chi_Minh, không theo giờ máy chủ.
 */
describe('Quy ước ngày báo cáo (nộp hôm nay = báo cáo về hôm qua)', () => {
  const svc = LarkService.prototype as any;
  const prevKey = (input?: string | Date): string => svc.previousVietnamDateKey.call({ toVietnamDateKey: svc.toVietnamDateKey }, input);
  const vnKey = (d: Date): string => svc.toVietnamDateKey.call({}, d);
  const noonUtc = (key: string): Date => svc.vietnamNoonUtcFromKey.call({}, key);

  describe('previousVietnamDateKey', () => {
    it('lùi đúng một ngày', () => {
      expect(prevKey('2026-09-17')).toBe('2026-09-16');
    });

    it('lùi qua đầu tháng', () => {
      expect(prevKey('2026-09-01')).toBe('2026-08-31');
    });

    it('lùi qua đầu năm', () => {
      expect(prevKey('2026-01-01')).toBe('2025-12-31');
    });

    it('xử lý đúng năm nhuận', () => {
      expect(prevKey('2028-03-01')).toBe('2028-02-29');
      expect(prevKey('2027-03-01')).toBe('2027-02-28');
    });
  });

  describe('Mốc ngày tính theo giờ Việt Nam, không theo UTC', () => {
    it('23:30 giờ VN ngày 17 vẫn thuộc ngày 17 (UTC lúc đó đã là 16:30 ngày 17)', () => {
      // 2026-09-17T16:30:00Z = 2026-09-17 23:30 VN
      expect(vnKey(new Date('2026-09-17T16:30:00Z'))).toBe('2026-09-17');
    });

    it('00:30 giờ VN ngày 18 đã là ngày 18 (UTC vẫn đang 17:30 ngày 17)', () => {
      // 2026-09-17T17:30:00Z = 2026-09-18 00:30 VN
      expect(vnKey(new Date('2026-09-17T17:30:00Z'))).toBe('2026-09-18');
    });

    it('nộp lúc nửa đêm giờ VN vẫn quy về đúng ngày nghiệp vụ hôm trước', () => {
      // 00:30 VN ngày 18 → báo cáo về ngày 17
      expect(prevKey(new Date('2026-09-17T17:30:00Z'))).toBe('2026-09-17');
      // 23:30 VN ngày 17 → báo cáo về ngày 16
      expect(prevKey(new Date('2026-09-17T16:30:00Z'))).toBe('2026-09-16');
    });
  });

  describe('vietnamNoonUtcFromKey — mốc lưu vào cột date', () => {
    it('đúng 12:00 giờ VN, tức 05:00 UTC', () => {
      const d = noonUtc('2026-09-16');

      expect(d.toISOString()).toBe('2026-09-16T05:00:00.000Z');
      // Chọn giữa trưa để mọi phép quy đổi múi giờ (±14h) vẫn rơi trong cùng một ngày VN.
      expect(vnKey(d)).toBe('2026-09-16');
    });

    it('khớp với dữ liệu thật đang có trên production (date = 05:00:00)', () => {
      // Các dòng revenue_reports quan sát được đều có giờ 05:00:00 — cùng quy ước này.
      expect(noonUtc('2026-09-14').toISOString()).toBe('2026-09-14T05:00:00.000Z');
    });
  });

  describe('Vòng ghi → đọc phải khớp nhau', () => {
    it('nộp ngày S, lưu S-1, đọc lại bằng S cũng ra S-1', () => {
      const reportDateNguoiDungChon = '2026-09-17';

      // Phía ghi (submitChecklistReport / submitTrafficReport / submitRevenueReport)
      const keyLuu = prevKey(reportDateNguoiDungChon);
      const dateLuu = noonUtc(keyLuu);

      // Phía đọc (getUserReportDetails nhận đúng reportDate người dùng đang xem)
      const keyDoc = prevKey(reportDateNguoiDungChon);

      expect(keyLuu).toBe(keyDoc);
      expect(vnKey(dateLuu)).toBe(keyDoc);
    });

    it('đọc bằng ngày THÔ (quên trừ 1) sẽ trượt — đây chính là cái bẫy', () => {
      const reportDate = '2026-09-17';
      const keyLuu = prevKey(reportDate);

      // Màn hình nào đọc thẳng reportDate mà không trừ 1 ngày sẽ tìm nhầm ngày.
      expect(keyLuu).not.toBe(reportDate);
    });
  });
});
