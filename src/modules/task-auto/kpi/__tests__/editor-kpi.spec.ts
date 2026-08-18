import { TaskAutoKpiService } from '../kpi.service';

describe('TaskAutoKpiService — Editor KPI Permission & Filtering', () => {
  function build(opts: {
    leaderTeams?: any[];
    memberTeams?: any[];
    editorKpis?: any[];
  } = {}) {
    const prisma: any = {
      team: {
        findMany: jest.fn(async () => opts.leaderTeams ?? []),
      },
      teamMember: {
        findMany: jest.fn(async () => opts.memberTeams ?? []),
      },
      editorKpi: {
        findMany: jest.fn(async (args: any) => opts.editorKpis ?? []),
      },
    };
    const service = new TaskAutoKpiService(prisma);
    return { service, prisma };
  }

  it('Admin/Manager có thể xem toàn bộ KPI của tất cả team', async () => {
    const { service, prisma } = build();
    await service.getEditorKpis('2026-08', undefined, { id: 'admin-1', roles: ['ADMIN'] });

    expect(prisma.editorKpi.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { month: '2026-08' },
      }),
    );
  });

  it('Leader chỉ xem KPI của các team do mình quản lý', async () => {
    const { service, prisma } = build({
      leaderTeams: [{ id: 'team-k4' }],
    });
    await service.getEditorKpis('2026-08', undefined, { id: 'leader-1', roles: ['LEADER'] });

    expect(prisma.team.findMany).toHaveBeenCalledWith({
      where: { leader_id: 'leader-1' },
      select: { id: true },
    });
    expect(prisma.editorKpi.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          month: '2026-08',
          team_id: { in: ['team-k4'] },
        },
      }),
    );
  });

  it('Leader nếu chọn xem team ngoài quyền quản lý sẽ nhận mảng rỗng', async () => {
    const { service, prisma } = build({
      leaderTeams: [{ id: 'team-k4' }],
    });
    const result = await service.getEditorKpis(
      '2026-08',
      undefined,
      { id: 'leader-1', roles: ['LEADER'] },
      'team-doda',
    );

    expect(result).toEqual([]);
    expect(prisma.editorKpi.findMany).not.toHaveBeenCalled();
  });

  it('Editor/Member chỉ xem KPI của team mình tham gia (Đồ Da không thấy K4)', async () => {
    const { service, prisma } = build({
      memberTeams: [{ team_id: 'team-doda' }],
    });
    await service.getEditorKpis('2026-08', undefined, { id: 'editor-1', roles: ['EDITOR'] });

    expect(prisma.teamMember.findMany).toHaveBeenCalledWith({
      where: { user_id: 'editor-1' },
      select: { team_id: true },
    });
    expect(prisma.editorKpi.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          month: '2026-08',
          team_id: { in: ['team-doda'] },
        },
      }),
    );
  });
});
