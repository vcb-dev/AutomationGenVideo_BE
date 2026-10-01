import { WorkReportService as LarkService } from '../src/modules/work-report/work-report.service';

/**
 * Chức năng: bỏ hẳn nền tảng Zalo khỏi báo cáo traffic/doanh thu.
 *
 * Form không còn ô Zalo; backend phải bỏ qua số Zalo nếu client cũ vẫn gửi lên, và không trả trường
 * Zalo khi đọc lại báo cáo. Dữ liệu Zalo cũ trong DB giữ nguyên (cột traffic_zalo/revenue_zalo
 * không bị xoá) — chỉ là logic không đọc/ghi nữa.
 */
describe('Bỏ nền tảng Zalo khỏi báo cáo traffic/doanh thu', () => {
    const toVnKey = (d: Date) =>
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const todayVN = toVnKey(new Date());

    function buildService(extraPrisma: Record<string, any> = {}) {
        const trafficRows: any[] = [];
        const revenueRows: any[] = [];
        const prisma: any = {
            user: { findFirst: jest.fn(async () => ({ email: 'nv@vcbi.vn', full_name: 'Nhan Vien', roles: ['MEMBER'], team: 'Team K1' })) },
            trafficReport: {
                findFirst: jest.fn(async () => null),
                createMany: jest.fn(async ({ data }: any) => { trafficRows.push(...data); return { count: data.length }; }),
            },
            revenueReport: {
                findFirst: jest.fn(async () => null),
                createMany: jest.fn(async ({ data }: any) => { revenueRows.push(...data); return { count: data.length }; }),
            },
            ...extraPrisma,
        };
        const service = Object.create(LarkService.prototype) as any;
        service.prisma = prisma;
        service.logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
        service.invalidateActivityCache = jest.fn();
        return { service, trafficRows, revenueRows };
    }

    const entry = (value: string, channel: string) => ({ id: channel, value, channel, evidences: [] });

    describe('submitTrafficReport', () => {
        it('bỏ qua dòng Zalo trong breakdown, chỉ ghi nền tảng còn lại', async () => {
            const { service, trafficRows } = buildService();
            await service.submitTrafficReport({
                email: 'nv@vcbi.vn', name: 'Nhan Vien', team: 'Team K1', reportDate: todayVN,
                trafficDetails: { breakdown: { fb: [entry('100', 'Page A')], zalo: [entry('500', 'Zalo OA')] } },
            });
            expect(trafficRows).toHaveLength(1);
            expect(trafficRows[0].traffic_fb).toBe(BigInt(100));
            expect(trafficRows.some((r) => 'traffic_zalo' in r)).toBe(false);
        });

        it('chỉ có số Zalo (kể cả kiểu cũ không breakdown) → không lưu gì, báo savedNothing', async () => {
            const { service, trafficRows } = buildService();
            const res = await service.submitTrafficReport({
                email: 'nv@vcbi.vn', name: 'Nhan Vien', team: 'Team K1', reportDate: todayVN,
                traffic: { fb: '', ig: '', tiktok: '', yt: '', thread: '', zalo: '900' },
            });
            expect(trafficRows).toHaveLength(0);
            expect(res.savedNothing).toBe(true);
        });
    });

    describe('submitRevenueReport', () => {
        it('bỏ qua dòng Zalo trong breakdown, chỉ ghi nền tảng còn lại', async () => {
            const { service, revenueRows } = buildService();
            await service.submitRevenueReport({
                email: 'nv@vcbi.vn', name: 'Nhan Vien', team: 'Team K1', reportDate: todayVN,
                revenueDetails: { breakdown: { tiktok: [entry('750000', 'Shop A')], zalo: [entry('55625000', 'Zalo')] } },
            });
            expect(revenueRows).toHaveLength(1);
            expect(revenueRows[0].revenue_tiktok).toBe(BigInt(750000));
            expect(revenueRows.some((r) => 'revenue_zalo' in r)).toBe(false);
        });

        it('kiểu cũ (object revenue phẳng) có Zalo → không ghi revenue_zalo', async () => {
            const { service, revenueRows } = buildService();
            await service.submitRevenueReport({
                email: 'nv@vcbi.vn', name: 'Nhan Vien', team: 'Team K1', reportDate: todayVN,
                revenue: { fb: '200000', ig: '', tiktok: '', yt: '', thread: '', zalo: '300000' },
            });
            expect(revenueRows.map((r) => Object.keys(r).filter((k) => /^revenue_/.test(k))).flat()).toEqual(['revenue_fb']);
        });
    });

    describe('getUserReportDetails', () => {
        it('đọc lại báo cáo cũ có số Zalo → không trả chi tiết Zalo', async () => {
            const oldTraffic = { id: 't1', email: 'nv@vcbi.vn', name: 'Nhan Vien', team: 'Team K1', total_traffic: BigInt(150), traffic_fb: BigInt(100), traffic_zalo: BigInt(50), channel_fb: 'Page A', channel_zalo: 'Zalo OA' };
            const oldRevenue = { id: 'r1', email: 'nv@vcbi.vn', name: 'Nhan Vien', team: 'Team K1', total_revenue: BigInt(500), revenue_fb: BigInt(200), revenue_zalo: BigInt(300), channel_fb: 'Page A', channel_zalo: 'Zalo OA' };
            const { service } = buildService({
                checklistReport: { findMany: jest.fn(async () => []) },
                trafficReport: { findMany: jest.fn(async () => [oldTraffic]) },
                revenueReport: { findMany: jest.fn(async () => [oldRevenue]) },
            });

            const res = await service.getUserReportDetails('nv@vcbi.vn', todayVN);

            expect(res.traffic.details).toEqual([{ platform: 'fb', channel: 'Page A', value: 100, evidences: [] }]);
            expect(res.revenue.details).toEqual([{ platform: 'fb', channel: 'Page A', value: 200 }]);
        });
    });
});
