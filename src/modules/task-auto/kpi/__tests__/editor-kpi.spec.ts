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

  it('Admin/Manager can view all KPIs across all teams', async () => {
    const { service, prisma } = build();
    await service.getEditorKpis('2026-08', undefined, { id: 'admin-1', roles: ['ADMIN'] });

    expect(prisma.editorKpi.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { month: '2026-08' },
      }),
    );
  });

  it('Leader only views KPIs of teams managed by them', async () => {
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

  it('Leader querying an unmanaged team returns an empty array', async () => {
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

  it('Editor/Member only views KPIs of their own assigned team(s)', async () => {
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
