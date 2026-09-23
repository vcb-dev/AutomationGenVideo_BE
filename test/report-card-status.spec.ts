import { WorkReportService as LarkService } from '../src/modules/work-report/work-report.service';

/**
 * Chức năng: trạng thái hiển thị trên thẻ nhân sự ở bảng Hiệu suất.
 *
 * Ba trạng thái người dùng thấy: CHƯA BÁO CÁO (xám) → CHƯA BÁO CÁO TRAFFIC (vàng cam) →
 * ĐÃ BÁO CÁO ĐỦ (xanh lá). Đây là thứ duy nhất người nộp báo cáo nhìn vào để biết mình đã xong
 * hay chưa.
 *
 * Vì sao đáng một file riêng: `daily-checklist-today-visibility.spec.ts` có gọi
 * getUserActivityReports nhưng cho `trafficReport.findMany` trả RỖNG, nên nhánh traffic của
 * `inAppDateFilter` chưa từng được chạy trong test nào. Mà traffic mới là chỗ dễ hỏng nhất:
 * báo cáo nộp ngày D được lưu `date` = D-1, nếu phía đọc quên trừ ngày thì thẻ đứng nguyên ở
 * "CHƯA BÁO CÁO TRAFFIC" dù người ta vừa nộp xong — hỏng âm thầm, chỉ người nộp mới thấy.
 */
describe('Trạng thái thẻ nhân sự trên bảng Hiệu suất', () => {
    const NGAY_XEM = '2026-09-18';
    /** Nộp sáng 18/09 → submitTrafficReport lưu `date` = 17/09 12:00 VN (05:00 UTC). */
    const NGAY_LUU = new Date('2026-09-17T05:00:00.000Z');
    const NOP_LUC = new Date('2026-09-18T03:11:35.000Z');

    const NGUOI = {
        id: 'user_1',
        email: 'testmember@gmail.com',
        full_name: 'Tester-member',
        team: 'Khác',
        is_active: true,
        employee_status: 'ON',
        roles: ['MEMBER'],
    };

    const checklistRow = {
        id: 'local_chk_1',
        name: NGUOI.full_name,
        email: NGUOI.email,
        team: NGUOI.team,
        date: NGAY_LUU,
        created_at: NOP_LUC,
        answers: { 'Bạn đã đăng video lên FB chưa?': true },
    };

    /** Hai dòng traffic của cùng một người: TikTok 2500 + FB 800 = 3700. */
    const trafficRows = [
        {
            id: 'local_trf_tiktok_1',
            email: NGUOI.email,
            name: NGUOI.full_name,
            employee: NGUOI.full_name,
            team: NGUOI.team,
            date: NGAY_LUU,
            created_at: NOP_LUC,
            total_traffic: BigInt(2500),
            traffic_tiktok: BigInt(2500),
        },
        {
            id: 'local_trf_fb_1',
            email: NGUOI.email,
            name: NGUOI.full_name,
            employee: NGUOI.full_name,
            team: NGUOI.team,
            date: NGAY_LUU,
            created_at: NOP_LUC,
            total_traffic: BigInt(800),
            traffic_fb: BigInt(800),
        },
    ];

    /**
     * Áp `where` của Prisma lên dữ liệu giả — CHỈ hỗ trợ đúng hình dạng mà getUserActivityReports
     * dùng: `{ OR: [...] }` và `{ date | created_at: { gte, lte } }`.
     *
     * Bắt buộc phải có: nếu mock cứ trả về mọi dòng bất kể `where` thì bài test vẫn xanh kể cả khi
     * code hỏi sai cửa sổ ngày — tức là test không bảo vệ được gì, chỉ tạo cảm giác an toàn.
     */
    const khopWhere = (row: any, where: any): boolean => {
        if (!where) return true;
        if (Array.isArray(where.OR)) return where.OR.some((w: any) => khopWhere(row, w));
        for (const field of ['date', 'created_at']) {
            const cond = where[field];
            if (!cond) continue;
            const t = new Date(row[field]).getTime();
            if (cond.gte && t < new Date(cond.gte).getTime()) return false;
            if (cond.lte && t > new Date(cond.lte).getTime()) return false;
        }
        return true;
    };

    /**
     * @param coChecklist  đã nộp checklist hay chưa
     * @param traffics     các dòng traffic có trong DB
     * @param soKenh       số kênh người này đứng tên — >0 thì hệ thống BẮT BUỘC phải có traffic
     */
    function buildService(opts: {
        coChecklist: boolean;
        traffics: any[];
        soKenh: number;
    }) {
        const channels = Array.from({ length: opts.soKenh }, () => ({
            owner: NGUOI.full_name,
            team_traffic: NGUOI.team,
        }));

        const prisma: any = {
            checklistReport: {
                findMany: jest.fn(async (args: any) =>
                    (opts.coChecklist ? [checklistRow] : []).filter((r) => khopWhere(r, args?.where)),
                ),
                count: jest.fn(async () => (opts.coChecklist ? 1 : 0)),
            },
            trafficReport: {
                findMany: jest.fn(async (args: any) =>
                    opts.traffics.filter((r) => khopWhere(r, args?.where)),
                ),
            },
            revenueReport: { findMany: jest.fn(async () => []) },
            kpi: {
                findMany: jest.fn(async () => []),
                count: jest.fn(async () => 0),
                findFirst: jest.fn(async () => null),
            },
            user: {
                findMany: jest.fn(async () => [NGUOI]),
                findFirst: jest.fn(async () => NGUOI),
            },
            kpiDoDaEditor: { findMany: jest.fn(async () => []) },
            kpiGlobalIndo: { findMany: jest.fn(async () => []) },
            reportKpi: { findMany: jest.fn(async () => []) },
            channel: {
                findMany: jest.fn(async () => channels),
                count: jest.fn(async () => channels.length),
            },
            task: { findMany: jest.fn(async () => []), groupBy: jest.fn(async () => []) },
            editorKpi: { findMany: jest.fn(async () => []) },
            editorDailyKpi: { findMany: jest.fn(async () => []) },
            teamMember: { findMany: jest.fn(async () => []) },
            $queryRawUnsafe: jest.fn(async () => []),
        };

        const cache = {
            get: async (_k: string, _ttl: number, fn: () => any) => fn(),
            set: jest.fn(),
            del: jest.fn(),
            invalidate: jest.fn(),
            invalidatePrefix: jest.fn(),
        };

        return new LarkService(
            null as any,
            { get: () => '' } as any,
            prisma as any,
            cache as any,
        );
    }

    const laythe = async (service: LarkService) => {
        const result = await service.getUserActivityReports({
            startDate: NGAY_XEM,
            endDate: NGAY_XEM,
            requesterEmail: NGUOI.email,
        });
        return (result as any).reports?.find((r: any) => r.email === NGUOI.email);
    };

    it('Case 5 — chưa nộp gì thì thẻ ở trạng thái CHƯA BÁO CÁO', async () => {
        const service = buildService({ coChecklist: false, traffics: [], soKenh: 1 });

        const the = await laythe(service);

        expect(the).toBeDefined();
        expect(the.status).toBe('CHƯA BÁO CÁO');
    });

    it('Case 6 — có quản lý kênh, nộp checklist nhưng chưa nộp traffic thì báo CHƯA BÁO CÁO TRAFFIC', async () => {
        const service = buildService({ coChecklist: true, traffics: [], soKenh: 1 });

        const the = await laythe(service);

        expect(the.status).toBe('CHƯA BÁO CÁO TRAFFIC');
    });

    it('Case 7 — nộp tiếp traffic thì chuyển sang ĐÃ BÁO CÁO ĐỦ', async () => {
        const service = buildService({ coChecklist: true, traffics: trafficRows, soKenh: 1 });

        const the = await laythe(service);

        expect(the.status).toBe('ĐÃ BÁO CÁO ĐỦ');
    });

    it('Case 7 — traffic nộp SÁNG NAY (lưu ngày hôm qua) vẫn khớp bộ lọc ngày hôm nay', async () => {
        // Đây là bài test khoá `inAppDateFilter`. Trước bản vá, phía đọc tìm đúng ngày 18/09 trong
        // khi bản ghi nằm ở 17/09 → thẻ đứng nguyên ở CHƯA BÁO CÁO TRAFFIC dù vừa nộp xong.
        const service = buildService({ coChecklist: true, traffics: trafficRows, soKenh: 1 });

        const the = await laythe(service);

        expect(NGAY_LUU.toISOString()).toBe('2026-09-17T05:00:00.000Z');
        expect(the.status).not.toBe('CHƯA BÁO CÁO TRAFFIC');
        expect(the.status).toBe('ĐÃ BÁO CÁO ĐỦ');
    });

    it('không quản lý kênh nào thì nộp checklist là đủ, không đòi traffic', async () => {
        const service = buildService({ coChecklist: true, traffics: [], soKenh: 0 });

        const the = await laythe(service);

        expect(the.status).toBe('ĐÃ BÁO CÁO ĐỦ');
    });

    it('có traffic nhưng chưa nộp checklist thì phân biệt được, không gộp vào CHƯA BÁO CÁO', async () => {
        const service = buildService({ coChecklist: false, traffics: trafficRows, soKenh: 1 });

        const the = await laythe(service);

        expect(the.status).toBe('CHƯA BÁO CÁO MEMBER');
    });
});
