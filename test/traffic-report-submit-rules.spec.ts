import { LarkService } from '../src/modules/lark-sync/lark.service';

/**
 * Chức năng: luật nộp báo cáo traffic (`POST /lark/traffic-report`).
 *
 * Vì sao đáng một file riêng: bốn luật nghiệp vụ độc lập cùng nằm trong submitTrafficReport() và
 * chỉ được kiểm bằng tay trên UI — khoá nộp lần 2 trong ngày, ngoại lệ cho người nhiều team, chặn
 * ngày tương lai, và cách đọc ô số. Mỗi luật hỏng đều là hỏng ÂM THẦM: dữ liệu vẫn trả HTTP 200,
 * chỉ là số liệu sai hoặc mất.
 *
 * Gọi thẳng phương thức thật, chỉ thay Prisma bằng mock — để test đo đúng logic đang chạy trên
 * production chứ không phải một bản chép lại của logic đó.
 */
describe('Luật nộp báo cáo traffic', () => {
    const toVnKey = (d: Date) =>
        new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Ho_Chi_Minh',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(d);

    const todayVN = toVnKey(new Date());
    const tomorrowVN = toVnKey(new Date(Date.now() + 24 * 60 * 60 * 1000));

    function buildService(opts?: {
        userRoles?: string[];
        userTeam?: string | null;
        existingTraffic?: any;
    }) {
        const createMany = jest.fn(async () => ({ count: 0 }));
        const prisma: any = {
            user: {
                findFirst: jest.fn(async () => ({
                    email: 'nv@vcbi.vn',
                    full_name: 'Nhan Vien',
                    roles: opts?.userRoles ?? ['MEMBER'],
                    team: opts?.userTeam ?? 'Team K1',
                })),
            },
            trafficReport: {
                findFirst: jest.fn(async () => opts?.existingTraffic ?? null),
                createMany,
            },
        };
        const service = Object.create(LarkService.prototype) as any;
        service.prisma = prisma;
        service.cacheService = { invalidate: jest.fn() };
        service.logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
        return { service, prisma, createMany };
    }

    const basePayload = (over?: Record<string, any>) => ({
        email: 'nv@vcbi.vn',
        name: 'Nhan Vien',
        traffic: { fb: '', ig: '', tiktok: '', yt: '', thread: '', zalo: '' },
        channels: {},
        platformEvidences: {},
        reportDate: todayVN,
        team: 'Team K1',
        ...over,
    });

    /** Gom các dòng sắp ghi theo nền tảng để assert cho dễ đọc. */
    const rowsOf = (createMany: jest.Mock) =>
        (createMany.mock.calls[0]?.[0]?.data ?? []) as any[];

    describe('Case 11 — khoá nộp traffic lần 2 trong ngày', () => {
        it('đã nộp cùng team thì từ chối ghi đè, giữ nguyên số cũ', async () => {
            const { service, createMany } = buildService({
                existingTraffic: { team: 'Team K1', created_at: new Date(), date: new Date() },
            });

            const res = await service.submitTrafficReport(
                basePayload({ traffic: { fb: '999', ig: '', tiktok: '', yt: '', thread: '', zalo: '' } }),
            );

            expect(res.alreadySubmitted).toBe(true);
            expect(res.recordIds).toEqual([]);
            // Quan trọng nhất: KHÔNG được ghi thêm dòng nào.
            expect(createMany).not.toHaveBeenCalled();
        });
    });

    describe('Case 12 — người phụ trách nhiều team', () => {
        it('đã nộp cho team A thì vẫn nộp được cho team B trong cùng ngày', async () => {
            const { service, createMany } = buildService({
                existingTraffic: { team: 'Team K1', created_at: new Date(), date: new Date() },
            });

            const res = await service.submitTrafficReport(
                basePayload({
                    team: 'AFF 01',
                    traffic: { fb: '800', ig: '', tiktok: '', yt: '', thread: '', zalo: '' },
                }),
            );

            expect(res.alreadySubmitted).toBeUndefined();
            expect(createMany).toHaveBeenCalled();
            expect(rowsOf(createMany).every((r) => r.team === 'AFF 01')).toBe(true);
        });
    });

    describe('Case 15 — chặn báo cáo ngày tương lai', () => {
        it('MEMBER chọn ngày mai thì bị chặn', async () => {
            const { service } = buildService({ userRoles: ['MEMBER'] });

            await expect(
                service.submitTrafficReport(basePayload({ reportDate: tomorrowVN })),
            ).rejects.toThrow('Không thể gửi báo cáo cho ngày trong tương lai.');
        });

        it('ADMIN thì KHÔNG bị chặn — đây là ngoại lệ dễ bị bỏ sót khi test bằng tài khoản member', async () => {
            const { service, createMany } = buildService({ userRoles: ['ADMIN'] });

            const res = await service.submitTrafficReport(
                basePayload({
                    reportDate: tomorrowVN,
                    traffic: { fb: '100', ig: '', tiktok: '', yt: '', thread: '', zalo: '' },
                }),
            );

            expect(res.alreadySubmitted).toBeUndefined();
            expect(createMany).toHaveBeenCalled();
        });

        it('MANAGER cũng không bị chặn', async () => {
            const { service } = buildService({ userRoles: ['MANAGER'] });
            await expect(
                service.submitTrafficReport(
                    basePayload({
                        reportDate: tomorrowVN,
                        traffic: { fb: '1', ig: '', tiktok: '', yt: '', thread: '', zalo: '' },
                    }),
                ),
            ).resolves.toBeDefined();
        });
    });

    describe('Case 16 — cách đọc ô số traffic', () => {
        it('ô để TRỐNG không tạo dòng nào (không phải quy về 0)', async () => {
            const { service, createMany } = buildService();

            await service.submitTrafficReport(
                basePayload({ traffic: { fb: '', ig: '', tiktok: '500', yt: '', thread: '', zalo: '' } }),
            );

            const rows = rowsOf(createMany);
            expect(rows).toHaveLength(1);
            expect(rows[0].traffic_tiktok).toBe(BigInt(500));
            // Không có dòng nào cho fb: ô trống bị bỏ qua hoàn toàn.
            expect(rows.some((r) => r.traffic_fb !== undefined)).toBe(false);
        });

        it('số 0 thì CÓ tạo dòng — khác hẳn ô để trống', async () => {
            const { service, createMany } = buildService();

            await service.submitTrafficReport(
                basePayload({ traffic: { fb: '0', ig: '', tiktok: '', yt: '', thread: '', zalo: '' } }),
            );

            const rows = rowsOf(createMany);
            expect(rows).toHaveLength(1);
            expect(rows[0].traffic_fb).toBe(BigInt(0));
        });

        it('toàn bộ ô để trống thì KHÔNG ghi gì nhưng vẫn báo thành công', async () => {
            const { service, createMany } = buildService();

            const res = await service.submitTrafficReport(basePayload());

            expect(createMany).not.toHaveBeenCalled();
            expect(res.recordIds).toEqual([]);
            // Thông điệp vẫn là "successfully" dù không lưu gì — dễ làm người nộp tưởng đã xong.
            expect(res.message).toContain('Created 0 records');
        });

        it('dấu phân cách nghìn được hiểu đúng', async () => {
            const { service, createMany } = buildService();

            await service.submitTrafficReport(
                basePayload({ traffic: { fb: '2,500', ig: '', tiktok: '', yt: '', thread: '', zalo: '' } }),
            );

            expect(rowsOf(createMany)[0].traffic_fb).toBe(BigInt(2500));
        });

        it('số rất lớn không tràn, không thành NaN', async () => {
            const { service, createMany } = buildService();

            await service.submitTrafficReport(
                basePayload({ traffic: { fb: '999999999', ig: '', tiktok: '', yt: '', thread: '', zalo: '' } }),
            );

            expect(rowsOf(createMany)[0].traffic_fb).toBe(BigInt(999999999));
        });

        it('GIÁ TRỊ ÂM bị biến thành số dương — dấu trừ bị nuốt mất', async () => {
            const { service, createMany } = buildService();

            await service.submitTrafficReport(
                basePayload({ traffic: { fb: '-5', ig: '', tiktok: '', yt: '', thread: '', zalo: '' } }),
            );

            // Hành vi hiện tại: replace(/\D/g,'') bỏ dấu "-" → -5 thành 5.
            expect(rowsOf(createMany)[0].traffic_fb).toBe(BigInt(5));
        });

        it('SỐ THẬP PHÂN bị nối chuỗi chứ không làm tròn', async () => {
            const { service, createMany } = buildService();

            await service.submitTrafficReport(
                basePayload({ traffic: { fb: '1.5', ig: '', tiktok: '', yt: '', thread: '', zalo: '' } }),
            );

            // "1.5" → bỏ dấu chấm → "15". Với dấu phân cách nghìn kiểu VN ("2.500") thì đúng ý,
            // nhưng với số thập phân thật thì sai 10 lần.
            expect(rowsOf(createMany)[0].traffic_fb).toBe(BigInt(15));
        });

        it('chữ không phải số thì bỏ qua, không làm hỏng request', async () => {
            const { service, createMany } = buildService();

            await service.submitTrafficReport(
                basePayload({ traffic: { fb: 'abc', ig: '', tiktok: '', yt: '', thread: '', zalo: '' } }),
            );

            expect(createMany).not.toHaveBeenCalled();
        });
    });

    describe('Ngày lưu vào cột date', () => {
        it('nộp ngày S thì lưu ngày S-1 (12:00 VN = 05:00 UTC)', async () => {
            const { service, createMany } = buildService();

            await service.submitTrafficReport(
                basePayload({
                    reportDate: '2026-09-18',
                    traffic: { fb: '10', ig: '', tiktok: '', yt: '', thread: '', zalo: '' },
                }),
            );

            expect(rowsOf(createMany)[0].date.toISOString()).toBe('2026-09-17T05:00:00.000Z');
        });
    });
});
