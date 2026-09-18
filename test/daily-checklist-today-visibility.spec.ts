import { LarkService } from '../src/modules/lark-sync/lark.service';

/**
 * Chức năng: Báo cáo công việc hôm nay (checklist) phải hiển thị đúng trên tab Checklist hôm nay.
 *
 * Nghiệp vụ:
 * - Khi nhân sự nộp "Công việc hôm nay" (reportDate = D, ví dụ 18/09), `submitChecklistReport`
 *   lưu bản ghi vào DB với `date = D-1` (17/09) theo quy ước báo cáo về hôm qua.
 * - Khi Leader/Admin/Member mở tab "Checklist" (mặc định chọn ngày D = Hôm nay), query phải
 *   tìm kiếm các báo cáo có `date = D-1` (hoặc date/created_at trong ngày D).
 * - Nếu query chỉ tìm `date = D`, toàn bộ báo cáo vừa nộp hôm nay sẽ biến mất, gây ra lỗi
 *   "CHƯA NỘP / Chưa gửi báo cáo hôm nay" dù nhân sự vừa gửi thành công.
 */
describe('Hiển thị báo cáo Checklist nộp hôm nay', () => {
  const svc = LarkService.prototype as any;

  describe('Tính toán cửa sổ ngày đọc in-app reports', () => {
    it('khi xem ngày D thì cửa sổ ngày nghiệp vụ lùi đúng 1 ngày (D-1)', () => {
      const uiDay = '2026-09-18';
      const inAppDay = svc.previousVietnamDateKey.call({ toVietnamDateKey: svc.toVietnamDateKey }, uiDay);
      expect(inAppDay).toBe('2026-09-17');
    });

    it('báo cáo nộp ngày D (date lưu D-1) khớp với cửa sổ in-app filter', () => {
      const uiDay = '2026-09-18';
      const inAppDay = svc.previousVietnamDateKey.call({ toVietnamDateKey: svc.toVietnamDateKey }, uiDay);

      const getVietnamBounds = (dStr: string) => {
        const parts = dStr.split('-');
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const d = parseInt(parts[2], 10);
        return {
          start: new Date(Date.UTC(y, m, d - 1, 17, 0, 0, 0)),
          end: new Date(Date.UTC(y, m, d, 16, 59, 59, 999)),
        };
      };

      const inAppReportBounds = getVietnamBounds(inAppDay);

      // Record được submitChecklistReport lưu vào DB
      const recordSavedDate = new Date('2026-09-17T05:00:00.000Z');

      expect(recordSavedDate.getTime()).toBeGreaterThanOrEqual(inAppReportBounds.start.getTime());
      expect(recordSavedDate.getTime()).toBeLessThanOrEqual(inAppReportBounds.end.getTime());
    });
  });

  describe('Phục hồi dữ liệu checklist khi xem ngày hôm nay', () => {
    it('getUserActivityReports tìm thấy báo cáo nộp hôm nay với câu trả lời và số video', async () => {
      const mockChecklistReport = {
        id: 'local_chk_123',
        name: 'Tester-member',
        email: 'testmember@gmail.com',
        team: 'Khác',
        date: new Date('2026-09-17T05:00:00.000Z'), // Lưu lùi 1 ngày
        created_at: new Date('2026-09-18T02:30:00.000Z'), // Nộp sáng 18/09
        answers: {
          'Bạn đã đăng video lên FB chưa?': true,
          'Số video edit sử dụng >50% source tự quay?': '12345678',
        },
      };

      const mockPrisma = {
        checklistReport: {
          findMany: jest.fn().mockResolvedValue([mockChecklistReport]),
          count: jest.fn().mockResolvedValue(1),
        },
        trafficReport: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        revenueReport: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        kpi: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        user: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'user_1',
              email: 'testmember@gmail.com',
              full_name: 'Tester-member',
              team: 'Khác',
              is_active: true,
              employee_status: 'ON',
              roles: ['MEMBER'],
            },
          ]),
          findFirst: jest.fn().mockResolvedValue({
            id: 'user_1',
            email: 'testmember@gmail.com',
            full_name: 'Tester-member',
            team: 'Khác',
            is_active: true,
            employee_status: 'ON',
            roles: ['MEMBER'],
          }),
        },
        kpiDoDaEditor: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        kpiGlobalIndo: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        reportKpi: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        channel: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
        task: {
          findMany: jest.fn().mockResolvedValue([]),
          groupBy: jest.fn().mockResolvedValue([]),
        },
        editorKpi: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        editorDailyKpi: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        teamMember: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      };

      const mockCache = {
        get: async (_k: string, _ttl: number, fn: () => any) => fn(),
        set: jest.fn(),
        del: jest.fn(),
        invalidate: jest.fn(),
        invalidatePrefix: jest.fn(),
      };

      const larkService = new LarkService(
        null as any,
        { get: () => '' } as any,
        mockPrisma as any,
        mockCache as any,
      );

      const result = await larkService.getUserActivityReports({
        startDate: '2026-09-18',
        endDate: '2026-09-18',
        requesterEmail: 'testmember@gmail.com',
      });

      const member = result.reports?.find((r: any) => r.email === 'testmember@gmail.com');

      expect(member).toBeDefined();
      expect(member.name).toBe('Tester-member');
      // Đã nộp checklist, câu hỏi và số video edit được giữ nguyên
      expect(member.checklist?.fb).toBe(true);
      expect(member.answers?.['Số video edit sử dụng >50% source tự quay?']).toBe('12345678');
      expect(member.videoCount).toBe(12345678);
      // Status không phải là "CHƯA BÁO CÁO"
      expect(member.status).not.toBe('CHƯA BÁO CÁO');
    });
  });
});
