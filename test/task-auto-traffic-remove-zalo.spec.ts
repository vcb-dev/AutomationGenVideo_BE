import { TaskAutoTasksService } from '../src/modules/task-auto/tasks/tasks.service';

/**
 * Chức năng: bảng traffic tự báo cáo theo nền tảng (GET /task-auto/teams/traffic-reports) không còn
 * nền tảng Zalo. Dữ liệu Zalo cũ trong traffic_reports giữ nguyên — chỉ là không đọc/trả nữa.
 */
describe('Traffic tự báo cáo theo nền tảng — bỏ Zalo', () => {
    function build(rows: any[]) {
        const findMany = jest.fn(async () => rows);
        const prisma: any = {
            trafficReport: { findMany },
            user: { findUnique: jest.fn(async () => null) },
            team: { findMany: jest.fn(async () => []) },
        };
        const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
        return { service, findMany };
    }

    it('không truy vấn cột traffic_zalo/channel_zalo', async () => {
        const { service, findMany } = build([]);
        await service.getTrafficReportsForRole('admin-1', ['ADMIN'], '2026-08-01', '2026-08-31');
        const select = (findMany.mock.calls[0] as any[])[0].select;
        expect(select).not.toHaveProperty('traffic_zalo');
        expect(select).not.toHaveProperty('channel_zalo');
        expect(select).toHaveProperty('traffic_fb', true);
    });

    it('dòng trả về không có trường zalo và chi tiết không có nền tảng zalo', async () => {
        const { service } = build([
            {
                date: new Date('2026-08-31T05:00:00Z'), email: 'a@x.com', name: 'A', team: 'Team A',
                traffic_fb: 100n, channel_fb: 'Page 1',
                // dữ liệu cũ còn trong DB (nếu có) cũng không được đọc ra
                traffic_zalo: 40n, channel_zalo: 'Zalo OA',
                total_traffic: 100n,
            },
        ]);

        const res: any = await service.getTrafficReportsForRole('admin-1', ['ADMIN'], '2026-08-01', '2026-08-31');

        expect(res.rows).toHaveLength(1);
        expect(res.rows[0]).not.toHaveProperty('zalo');
        expect(res.rows[0].details).toEqual([{ platform: 'fb', channel: 'Page 1', value: 100 }]);
    });
});
