import { WorkReportService as LarkService } from '../src/modules/work-report/work-report.service';

/**
 * Chức năng: sửa báo cáo traffic/doanh thu đã nộp (nút "Sửa báo cáo" ở trang checklist).
 *
 * Trước đây submitTrafficReport/submitRevenueReport chỉ có đường INSERT: nộp lại cùng ngày cùng
 * team thì trả HTTP 200 kèm `alreadySubmitted` và KHÔNG ghi gì, FE lại báo "thành công" — người
 * dùng sửa số xong tải lại trang vẫn thấy số cũ. Giờ FE gửi `replaceExisting: true` khi sửa; BE
 * xoá các dòng nhập tay cũ của đúng người/ngày/team rồi ghi dòng mới trong một transaction.
 *
 * Luật: chỉ sửa được trong NGÀY NỘP (reportDate = hôm nay giờ VN); ngày đã qua giữ nguyên.
 *
 * Gọi thẳng phương thức thật, chỉ thay Prisma bằng mock.
 */
const toVnKey = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);

const todayVN = toVnKey(new Date());
const yesterdayVN = toVnKey(new Date(Date.now() - 24 * 60 * 60 * 1000));

type Model = 'trafficReport' | 'revenueReport';

function buildService(model: Model, existing?: any) {
    const createMany = jest.fn(async ({ data }: any) => ({ count: data.length }));
    const deleteMany = jest.fn(async () => ({ count: 1 }));
    const findFirst = jest.fn(async () => existing ?? null);
    const prisma: any = {
        user: { findFirst: jest.fn(async () => ({ email: 'nv@vcbi.vn', team: 'Team K1' })) },
        [model]: { findFirst, createMany, deleteMany },
        $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const service = Object.create(LarkService.prototype) as any;
    service.prisma = prisma;
    service.cacheService = { invalidate: jest.fn() };
    service.invalidateActivityCache = jest.fn();
    service.logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    return { service, prisma, createMany, deleteMany, findFirst };
}

const existingRow = (team: string | null = 'Team K1') => ({
    id: 'local_trf_fb_old',
    team,
    created_at: new Date(),
    date: new Date(),
});

const trafficPayload = (over?: Record<string, any>) => ({
    email: 'nv@vcbi.vn',
    name: 'Nhan Vien',
    team: 'Team K1',
    reportDate: todayVN,
    trafficDetails: { breakdown: { fb: [{ value: '2000', channel: 'Page A', evidences: [] }] } },
    ...over,
});

const revenuePayload = (over?: Record<string, any>) => ({
    email: 'nv@vcbi.vn',
    name: 'Nhan Vien',
    team: 'Team K1',
    reportDate: todayVN,
    revenueDetails: { breakdown: { tiktok: [{ value: '3.500.000', channel: 'Shop A' }] } },
    ...over,
});

const cases: { label: string; model: Model; submit: string; payload: (over?: Record<string, any>) => Record<string, any>; valueKey: string }[] = [
    { label: 'traffic', model: 'trafficReport', submit: 'submitTrafficReport', payload: trafficPayload, valueKey: 'traffic_fb' },
    { label: 'doanh thu', model: 'revenueReport', submit: 'submitRevenueReport', payload: revenuePayload, valueKey: 'revenue_tiktok' },
];

describe.each(cases)('Sửa báo cáo $label đã nộp', ({ model, submit, payload, valueKey }) => {
    it('hôm nay + replaceExisting: xoá dòng cũ của đúng team rồi ghi dòng mới trong 1 transaction', async () => {
        const { service, prisma, createMany, deleteMany } = buildService(model, existingRow());

        const res = await service[submit](payload({ replaceExisting: true }));

        expect(res.alreadySubmitted).toBeUndefined();
        expect(res.updated).toBe(true);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(deleteMany).toHaveBeenCalledTimes(1);
        expect(createMany).toHaveBeenCalledTimes(1);
        const rows = createMany.mock.calls[0][0].data;
        expect(rows).toHaveLength(1);
        expect(rows[0].team).toBe('Team K1');
        expect(rows[0][valueKey]).toBeDefined();
    });

    it('chỉ xoá dòng NHẬP TAY (id local_*) của đúng người, đúng ngày, đúng team', async () => {
        const { service, deleteMany } = buildService(model, existingRow());

        await service[submit](payload({ replaceExisting: true }));

        const where = (deleteMany.mock.calls[0] as any[])[0].where;
        expect(where.id).toEqual({ startsWith: 'local_' });
        expect(where.team).toBe('Team K1');
        expect(where.email).toEqual({ equals: 'nv@vcbi.vn', mode: 'insensitive' });
        expect(where.date.gte).toBeInstanceOf(Date);
        expect(where.date.lte).toBeInstanceOf(Date);
    });

    it('bản cũ không có team: xoá theo team = null, không xoá lan sang team khác', async () => {
        const { service, deleteMany } = buildService(model, existingRow(null));

        await service[submit](payload({ team: '', replaceExisting: true }));

        expect((deleteMany.mock.calls[0] as any[])[0].where.team).toBeNull();
    });

    it('ngày ĐÃ QUA: từ chối sửa, giữ nguyên số cũ và nói rõ lý do', async () => {
        const { service, createMany, deleteMany } = buildService(model, existingRow());

        const res = await service[submit](payload({ reportDate: yesterdayVN, replaceExisting: true }));

        expect(res.alreadySubmitted).toBe(true);
        expect(res.message).toContain('Chỉ sửa được báo cáo trong ngày nộp');
        expect(deleteMany).not.toHaveBeenCalled();
        expect(createMany).not.toHaveBeenCalled();
    });

    it('không gửi replaceExisting: vẫn chặn nộp trùng như cũ (bấm Gửi 2 lần không tạo trùng)', async () => {
        const { service, createMany, deleteMany } = buildService(model, existingRow());

        const res = await service[submit](payload());

        expect(res.alreadySubmitted).toBe(true);
        expect(deleteMany).not.toHaveBeenCalled();
        expect(createMany).not.toHaveBeenCalled();
    });

    it('replaceExisting nhưng chưa từng nộp: ghi mới bình thường, không xoá gì', async () => {
        const { service, prisma, createMany, deleteMany } = buildService(model, null);

        const res = await service[submit](payload({ replaceExisting: true }));

        expect(res.updated).toBeUndefined();
        expect(deleteMany).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(createMany).toHaveBeenCalledTimes(1);
    });

    it('người nhiều team: tra bản đã nộp theo ĐÚNG team đang gửi, không theo dòng mới nhất', async () => {
        const { service, findFirst } = buildService(model, null);

        await service[submit](payload({ team: 'AFF 01' }));

        expect((findFirst.mock.calls[0] as any[])[0].where.team).toBe('AFF 01');
    });
});

describe('Sửa báo cáo traffic — gửi lại toàn ô trống', () => {
    it('không có dòng hợp lệ thì KHÔNG xoá bản cũ (không để ngày đó trống)', async () => {
        const { service, createMany, deleteMany } = buildService('trafficReport', existingRow());

        const res = await service.submitTrafficReport(
            trafficPayload({ replaceExisting: true, trafficDetails: { breakdown: { fb: [{ value: '' }] } } }),
        );

        expect(res.savedNothing).toBe(true);
        expect(deleteMany).not.toHaveBeenCalled();
        expect(createMany).not.toHaveBeenCalled();
    });
});

describe('Đọc lại báo cáo để sửa (getUserReportDetails)', () => {
    function buildReader(trafficRows: any[], revenueRows: any[]) {
        const prisma: any = {
            user: { findFirst: jest.fn(async () => ({ email: 'nv@vcbi.vn', full_name: 'Nhan Vien' })) },
            checklistReport: { findMany: jest.fn(async () => []) },
            trafficReport: { findMany: jest.fn(async () => trafficRows) },
            revenueReport: { findMany: jest.fn(async () => revenueRows) },
        };
        const service = Object.create(LarkService.prototype) as any;
        service.prisma = prisma;
        service.logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
        return service;
    }

    const blank = { traffic_fb: null, traffic_ig: null, traffic_tiktok: null, traffic_yt: null, traffic_thread: null, traffic_zalo: null };
    const blankRev = { revenue_fb: null, revenue_ig: null, revenue_tiktok: null, revenue_yt: null, revenue_thread: null, revenue_zalo: null };

    it('giữ dòng người dùng nhập số 0, bỏ cột null — để form sửa không làm mất nền tảng báo cáo 0', async () => {
        const service = buildReader(
            [
                { ...blank, id: 'local_trf_fb_1', email: 'nv@vcbi.vn', team: 'Team K1', traffic_fb: BigInt(0), channel_fb: 'Page A' },
                { ...blank, id: 'local_trf_ig_1', email: 'nv@vcbi.vn', team: 'Team K1', traffic_ig: BigInt(500), channel_ig: 'IG A' },
            ],
            [{ ...blankRev, id: 'local_rev_yt_1', email: 'nv@vcbi.vn', team: 'Team K1', revenue_yt: BigInt(0), channel_yt: 'YT A' }],
        );

        const res = await service.getUserReportDetails('nv@vcbi.vn', todayVN);

        expect(res.traffic.details).toEqual([
            expect.objectContaining({ platform: 'fb', value: 0, channel: 'Page A' }),
            expect.objectContaining({ platform: 'ig', value: 500, channel: 'IG A' }),
        ]);
        expect(res.revenue.details).toEqual([{ platform: 'yt', channel: 'YT A', value: 0 }]);
    });
});
