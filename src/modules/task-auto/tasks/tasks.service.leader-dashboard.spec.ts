import { TaskAutoTasksService } from './tasks.service';

/**
 * getLeaderDashboard (qua getDashboard) — bug gốc: dùng `team.findFirst({leader_id})` để tìm team
 * của leader, nhưng trên DB thật có leader lead CÙNG LÚC nhiều team (vd 1 người lead cả "Scale Data",
 * "Team K1", "MEDIA" — 15 thành viên thô, 12 người thật sau khi bỏ trùng vì có người ở ≥2 team).
 * findFirst chỉ trả 1/N team, làm mất dữ liệu các team còn lại. Đã sửa sang findMany + gộp/dedupe —
 * test này khoá lại hành vi đúng để tránh regression về findFirst.
 */
describe('TaskAutoTasksService.getDashboard — leader lead nhiều team', () => {
  function build(teamsLed: any[]) {
    const push: any = {};
    const videoService: any = {};
    const prisma: any = {
      team: { findMany: jest.fn(async () => teamsLed) },
      task: {
        groupBy: jest.fn(async () => []),
        count: jest.fn(async () => 0),
      },
      editorKpi: { findMany: jest.fn(async () => []) },
      trafficReport: { groupBy: jest.fn(async () => []) },
      revenueReport: { groupBy: jest.fn(async () => []) },
      contentLine: { findMany: jest.fn(async () => []) },
    };
    const service = new TaskAutoTasksService(prisma, videoService, push);
    return { service, prisma };
  }

  function fakeMember(userId: string, name: string) {
    return { user_id: userId, user: { id: userId, full_name: name, email: `${name}@x.com` } };
  }

  it('gộp đúng 3 team của cùng 1 leader — KHÔNG chỉ lấy 1 team đầu tiên', async () => {
    const shared = fakeMember('u-shared', 'Người dùng chung'); // ở cả "Scale Data" và "Team K1"
    const teamsLed = [
      { id: 't-scale', name: 'Scale Data', members: [shared, fakeMember('u1', 'A')] },
      { id: 't-k1', name: 'Team K1', members: [shared, fakeMember('u2', 'B'), fakeMember('u3', 'C')] },
      { id: 't-media', name: 'MEDIA', members: [fakeMember('u4', 'D')] },
    ];
    const { service, prisma } = build(teamsLed);

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);

    expect(prisma.team.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leader_id: 'leader-1' } }),
    );
    expect(result.scope).toBe('team');
    // Cả 3 tên team phải xuất hiện, không được chỉ có 1
    expect(result.team.name).toBe('Scale Data, Team K1, MEDIA');
    // 2+3+1 = 6 dòng thô nhưng "u-shared" xuất hiện ở 2 team → dedupe còn 5 người thật
    expect(result.team.member_count).toBe(5);
    expect(result.members).toHaveLength(5);
    expect(result.members.map((m: any) => m.user_id).sort()).toEqual(
      ['u-shared', 'u1', 'u2', 'u3', 'u4'].sort(),
    );

    // task.groupBy/task.count phải lọc theo TẤT CẢ team_id của leader, không chỉ team đầu
    const teamIdFilters = prisma.task.groupBy.mock.calls.map((c: any[]) => c[0]?.where?.team_id).filter(Boolean);
    for (const f of teamIdFilters) {
      expect(f).toEqual({ in: ['t-scale', 't-k1', 't-media'] });
    }
  });

  it('leader không lead team nào → trả về rỗng, không throw', async () => {
    const { service } = build([]);

    const result: any = await service.getDashboard('leader-no-team', ['LEADER'], undefined, undefined);

    expect(result).toEqual({
      scope: 'team',
      team: null,
      tasks: { total: 0 },
      members: [],
      kpi: null,
      video_by_line: [],
    });
  });

  it('leader lead đúng 1 team (trường hợp phổ biến nhất) vẫn hoạt động bình thường', async () => {
    const teamsLed = [{ id: 't-jp1', name: 'Global - JP1', members: [fakeMember('u1', 'A'), fakeMember('u2', 'B')] }];
    const { service } = build(teamsLed);

    const result: any = await service.getDashboard('leader-single', ['LEADER'], undefined, undefined);

    expect(result.team).toEqual({ id: 't-jp1', name: 'Global - JP1', member_count: 2 });
    expect(result.members).toHaveLength(2);
  });
});
