import { TaskAutoTasksService } from '../tasks.service';

/**
 * traffic_month (getLeaderDashboard/getTeamReport) — bug gốc: TrafficReport là "điểm cuối kỳ" (mỗi
 * lần nộp báo cáo tạo NHIỀU dòng cùng 1 `date`, 1 dòng/nền tảng), nhưng code cũ SUM `total_traffic`
 * qua TẤT CẢ các ngày trong tháng (groupBy + _sum), làm traffic tháng bị cộng dồn sai — càng nhiều
 * ngày báo cáo thì số càng phồng lên. Traffic đúng của cả kỳ phải là tổng traffic đúng NGÀY BÁO CÁO
 * GẦN NHẤT của từng người (vd traffic tháng 8 = tổng traffic ngày 31/8), không phải sum cả tháng.
 */
describe('TaskAutoTasksService — traffic_month lấy đúng ngày báo cáo gần nhất, không cộng dồn cả tháng', () => {
  function build(trafficRows: any[]) {
    const teamsLed = [
      {
        id: 't-1',
        name: 'Team A',
        members: [
          { user_id: 'u1', user: { id: 'u1', full_name: 'A', email: 'a@x.com' } },
        ],
      },
    ];
    const prisma: any = {
      team: { findMany: jest.fn(async () => teamsLed) },
      task: {
        groupBy: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => []),
      },
      editorKpi: { findMany: jest.fn(async () => []) },
      trafficReport: { findMany: jest.fn(async () => trafficRows) },
      revenueReport: { groupBy: jest.fn(async () => []) },
      contentLine: { findMany: jest.fn(async () => []) },
      editorDailyKpi: { findMany: jest.fn(async () => []) },
      productLine: { findMany: jest.fn(async () => []) },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any);
    return { service, prisma };
  }

  it('nhiều ngày báo cáo trong tháng → chỉ lấy ngày gần nhất, không cộng dồn cả tháng', async () => {
    const { service } = build([
      { email: 'a@x.com', date: new Date('2026-08-01T05:00:00Z'), total_traffic: 100n },
      { email: 'a@x.com', date: new Date('2026-08-15T05:00:00Z'), total_traffic: 200n },
      { email: 'a@x.com', date: new Date('2026-08-31T05:00:00Z'), total_traffic: 300n },
    ]);

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, '2026-08');
    const member = result.members.find((m: any) => m.user_id === 'u1');

    // Sai (cộng dồn cả tháng) sẽ ra 600 (100+200+300) — đúng phải là 300 (chỉ ngày 31/8).
    expect(member.traffic_month).toBe(300);
  });

  it('ngày báo cáo gần nhất có nhiều dòng (1 dòng/nền tảng) → SUM đúng các dòng CÙNG ngày đó', async () => {
    const { service } = build([
      { email: 'a@x.com', date: new Date('2026-08-01T05:00:00Z'), total_traffic: 999n },
      // Ngày báo cáo gần nhất (31/8) có 3 dòng — mỗi dòng là 1 nền tảng (fb/ig/tiktok...).
      { email: 'a@x.com', date: new Date('2026-08-31T05:00:00Z'), total_traffic: 100n },
      { email: 'a@x.com', date: new Date('2026-08-31T05:00:00Z'), total_traffic: 200n },
      { email: 'a@x.com', date: new Date('2026-08-31T05:00:00Z'), total_traffic: 300n },
    ]);

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, '2026-08');
    const member = result.members.find((m: any) => m.user_id === 'u1');

    expect(member.traffic_month).toBe(600);
  });

  it('không có báo cáo nào trong kỳ → traffic_month = 0', async () => {
    const { service } = build([]);

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, '2026-08');
    const member = result.members.find((m: any) => m.user_id === 'u1');

    expect(member.traffic_month).toBe(0);
  });
});
