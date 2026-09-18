import { LarkService } from '../src/modules/lark-sync/lark.service';

/**
 * Chức năng: nộp / sửa checklist hằng ngày (`POST /lark/checklist-report`).
 *
 * Vì sao đáng một file riêng: checklist CHO PHÉP sửa trong ngày (khác traffic — khoá cứng), nên
 * cơ chế chống nhân bản nằm ở chỗ tái sử dụng đúng `existing.id`. Nếu chỗ này hỏng, mỗi lần người
 * dùng bấm nộp lại sẽ đẻ thêm một dòng rác, và bảng điều khiển đếm trùng — hỏng âm thầm, chỉ lộ ra
 * khi số liệu đã sai nhiều ngày.
 *
 * Gọi thẳng phương thức thật, chỉ thay Prisma bằng mock.
 */
describe('Nộp và sửa checklist trong ngày', () => {
    const toVnKey = (d: Date) =>
        new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Ho_Chi_Minh',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(d);

    const todayVN = toVnKey(new Date());
    const tomorrowVN = toVnKey(new Date(Date.now() + 24 * 60 * 60 * 1000));

    function buildService(opts?: { userRoles?: string[]; userTeam?: string | null; existing?: any }) {
        const upsert = jest.fn(async () => ({}));
        const prisma: any = {
            user: {
                findFirst: jest.fn(async () => ({
                    email: 'nv@vcbi.vn',
                    full_name: 'Nhan Vien',
                    roles: opts?.userRoles ?? ['MEMBER'],
                    team: opts?.userTeam ?? 'Team K1',
                })),
            },
            checklistReport: {
                findFirst: jest.fn(async () => opts?.existing ?? null),
                upsert,
            },
        };
        const service = Object.create(LarkService.prototype) as any;
        service.prisma = prisma;
        service.cacheService = { invalidate: jest.fn() };
        service.logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
        return { service, prisma, upsert };
    }

    const basePayload = (over?: Record<string, any>) => ({
        email: 'nv@vcbi.vn',
        name: 'Nhan Vien',
        team: 'Team K1',
        reportDate: todayVN,
        'Số video tự quay': '10',
        ...over,
    });

    /** Đối số upsert của lần gọi đầu tiên. */
    const upsertArg = (upsert: jest.Mock) => upsert.mock.calls[0][0];

    describe('Case 8 — nộp đè để sửa, không nhân bản dòng', () => {
        it('lần đầu trong ngày thì tạo bản ghi mới', async () => {
            const { service, upsert } = buildService({ existing: null });

            const res = await service.submitChecklistReport(basePayload());

            expect(res.success).toBe(true);
            expect(res.alreadySubmitted).toBe(false);
            expect(res.message).toBe('Gửi báo cáo thành công');
            expect(upsert).toHaveBeenCalledTimes(1);
        });

        it('nộp lại trong ngày thì DÙNG LẠI đúng id cũ — không sinh dòng thứ hai', async () => {
            const idCu = 'local_chk_1758000000000_abcde';
            const { service, upsert } = buildService({
                existing: { id: idCu, answers: { 'Số video tự quay': '10' } },
            });

            const res = await service.submitChecklistReport(
                basePayload({ 'Số video tự quay': '15' }),
            );

            expect(res.alreadySubmitted).toBe(true);
            expect(res.message).toBe('Cập nhật báo cáo thành công');
            expect(res.id).toBe(idCu);

            const arg = upsertArg(upsert);
            // Chống nhân bản: where trỏ đúng id cũ, và nhánh create cũng mang id cũ.
            expect(arg.where).toEqual({ id: idCu });
            expect(arg.create.id).toBe(idCu);
            expect(arg.update.id).toBe(idCu);
        });

        it('số video sửa từ 10 thành 15 được ghi đè đúng', async () => {
            const { service, upsert } = buildService({
                existing: { id: 'local_chk_cu', answers: { 'Số video tự quay': '10' } },
            });

            await service.submitChecklistReport(basePayload({ 'Số video tự quay': '15' }));

            expect(upsertArg(upsert).update.answers['Số video tự quay']).toBe('15');
        });

        it('các trường metadata không bị lẫn vào answers', async () => {
            const { service, upsert } = buildService();

            await service.submitChecklistReport(basePayload());

            const answers = upsertArg(upsert).create.answers;
            for (const key of ['email', 'name', 'team', 'reportDate', 'userEmail', 'userName', 'userTeam']) {
                expect(answers).not.toHaveProperty(key);
            }
            expect(answers['Số video tự quay']).toBe('10');
        });
    });

    describe('Case 15 — chặn ngày tương lai', () => {
        it('MEMBER chọn ngày mai thì bị chặn', async () => {
            const { service } = buildService({ userRoles: ['MEMBER'] });

            await expect(
                service.submitChecklistReport(basePayload({ reportDate: tomorrowVN })),
            ).rejects.toThrow('Không thể gửi báo cáo cho ngày trong tương lai.');
        });

        // Ngoại lệ "admin bỏ qua ràng buộc" là dành cho rule khung giờ 17:00-18:00, KHÔNG dành cho
        // ngày tương lai — hai thứ từng nằm chung một khối `if (!isAdmin)`.
        it.each([['ADMIN'], ['MANAGER']])('%s cũng bị chặn, không có ngoại lệ cho ngày tương lai', async (role) => {
            const { service, upsert } = buildService({ userRoles: [role] });

            await expect(
                service.submitChecklistReport(basePayload({ reportDate: tomorrowVN })),
            ).rejects.toThrow('Không thể gửi báo cáo cho ngày trong tương lai.');

            expect(upsert).not.toHaveBeenCalled();
        });

        it('nộp bù ngày ĐÃ QUA vẫn mở cho mọi vai trò', async () => {
            const { service, upsert } = buildService({ userRoles: ['MEMBER'] });

            await service.submitChecklistReport(basePayload({ reportDate: '2026-09-01' }));

            expect(upsert).toHaveBeenCalled();
        });
    });

    describe('Ngày lưu vào cột date', () => {
        it('nộp ngày S thì lưu ngày S-1 (12:00 VN = 05:00 UTC)', async () => {
            const { service, upsert } = buildService();

            await service.submitChecklistReport(basePayload({ reportDate: '2026-09-18' }));

            expect(upsertArg(upsert).create.date.toISOString()).toBe('2026-09-17T05:00:00.000Z');
        });
    });

    describe('Team ghi vào bản ghi lấy từ đâu', () => {
        it('team do CLIENT gửi lên được ưu tiên hơn team trong DB', async () => {
            // Controller chỉ ghi đè email/name từ JWT; `team`/`userTeam` vẫn là dữ liệu client tự khai.
            const { service, upsert } = buildService({ userTeam: 'Team K1' });

            await service.submitChecklistReport(basePayload({ team: 'Team KHAC' }));

            expect(upsertArg(upsert).create.team).toBe('Team KHAC');
        });

        it('không gửi team thì mới lấy team trong DB', async () => {
            const { service, upsert } = buildService({ userTeam: 'Team K1' });

            await service.submitChecklistReport(basePayload({ team: undefined }));

            expect(upsertArg(upsert).create.team).toBe('Team K1');
        });
    });
});
