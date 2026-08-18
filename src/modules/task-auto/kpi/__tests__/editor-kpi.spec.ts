import { TaskAutoKpiService } from '../kpi.service';
import { ForbiddenException, BadRequestException } from '@nestjs/common';

describe('TaskAutoKpiService — Editor KPI Permission & Filtering', () => {
  function build(opts: {
    leaderTeams?: any[];
    memberTeams?: any[];
    editorKpis?: any[];
    teamFirst?: any;
    teamMemberFirst?: any;
  } = {}) {
    const prisma: any = {
      team: {
        findMany: jest.fn(async () => opts.leaderTeams ?? []),
        findFirst: jest.fn(async () => opts.teamFirst ?? null),
      },
      teamMember: {
        findMany: jest.fn(async () => opts.memberTeams ?? []),
        findFirst: jest.fn(async () => opts.teamMemberFirst ?? null),
      },
      editorKpi: {
        findMany: jest.fn(async (args: any) => opts.editorKpis ?? []),
        create: jest.fn(async (args: any) => ({ id: 'kpi-1', ...args.data })),
        update: jest.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
      },
    };
    const service = new TaskAutoKpiService(prisma);
    return { service, prisma };
  }

  describe('Read / Query Permission (getEditorKpis)', () => {
    it('Admin/Manager can view all KPIs across all teams without restrictions', async () => {
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

    it('Leader querying an unmanaged team returns an empty array immediately', async () => {
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

    it('Editor/Member only views KPIs of their own assigned team(s) (Đồ Da cannot see K4)', async () => {
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

    it('Editor belonging to multiple teams can filter by a valid team', async () => {
      const { service, prisma } = build({
        memberTeams: [{ team_id: 'team-doda' }, { team_id: 'team-global' }],
      });
      await service.getEditorKpis(
        '2026-08',
        undefined,
        { id: 'editor-1', roles: ['EDITOR'] },
        'team-global',
      );

      expect(prisma.editorKpi.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            month: '2026-08',
            team_id: 'team-global',
          },
        }),
      );
    });

    it('Editor querying an unauthorized team returns an empty array immediately', async () => {
      const { service, prisma } = build({
        memberTeams: [{ team_id: 'team-doda' }],
      });
      const result = await service.getEditorKpis(
        '2026-08',
        undefined,
        { id: 'editor-1', roles: ['EDITOR'] },
        'team-k4',
      );

      expect(result).toEqual([]);
      expect(prisma.editorKpi.findMany).not.toHaveBeenCalled();
    });

    it('User with no assigned teams returns an empty list', async () => {
      const { service, prisma } = build({
        memberTeams: [],
      });
      await service.getEditorKpis('2026-08', undefined, { id: 'unassigned-user', roles: ['MEMBER'] });

      expect(prisma.editorKpi.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            month: '2026-08',
            team_id: { in: [] },
          },
        }),
      );
    });
  });

  describe('Write / Upsert Permission (upsertEditorKpi)', () => {
    it('Leader cannot upsert KPI for a team they do not lead', async () => {
      const { service } = build({
        teamFirst: null, // Not a leader of this team
      });

      await expect(
        service.upsertEditorKpi(
          {
            user_id: 'user-1',
            team_id: 'unauthorized-team',
            month: '2026-08',
            total_target: 10,
            allocations: [{ type: 'CONTENT_LINE', content_line_id: 'cl-1', quantity: 10 }],
          } as any,
          'leader-1',
          ['LEADER'],
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Leader cannot upsert KPI for an editor who is not in their team', async () => {
      const { service } = build({
        teamFirst: { id: 'team-1', leader_id: 'leader-1' },
        teamMemberFirst: null, // Not a member of this team
      });

      await expect(
        service.upsertEditorKpi(
          {
            user_id: 'outsider-user',
            team_id: 'team-1',
            month: '2026-08',
            total_target: 10,
            allocations: [{ type: 'CONTENT_LINE', content_line_id: 'cl-1', quantity: 10 }],
          } as any,
          'leader-1',
          ['LEADER'],
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Fails validation if allocation sum does not match total_target', async () => {
      const { service } = build({
        teamFirst: { id: 'team-1', leader_id: 'leader-1' },
        teamMemberFirst: { id: 'tm-1' },
      });

      await expect(
        service.upsertEditorKpi(
          {
            user_id: 'user-1',
            team_id: 'team-1',
            month: '2026-08',
            total_target: 20,
            allocations: [{ type: 'CONTENT_LINE', content_line_id: 'cl-1', quantity: 10 }], // 10 != 20
          } as any,
          'leader-1',
          ['LEADER'],
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
