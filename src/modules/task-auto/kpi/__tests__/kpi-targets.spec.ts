import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  UpsertContentCreatorDailyKpiDto,
  UpsertContentCreatorKpiDto,
  UpsertEditorDailyKpiDto,
} from '../dto/kpi.dto';
import { TaskAutoKpiService } from '../kpi.service';
import { dailyKpiDate } from '../../../../utils/date.utils';

// KPI "đặt tay" (target do LEADER/ADMIN nhập) — 4 biến thể cùng mô hình quyền/validate; báo cáo tự tính ở kpi-reports.spec.ts.

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
    const service = new TaskAutoKpiService(prisma, {} as any, {} as any);
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

    it('Editor/Member only views their own KPI, not teammates\' (Đồ Da cannot see K4\'s KPI either)', async () => {
      const { service, prisma } = build();
      await service.getEditorKpis('2026-08', undefined, { id: 'editor-1', roles: ['EDITOR'] });

      expect(prisma.teamMember.findMany).not.toHaveBeenCalled();
      expect(prisma.editorKpi.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            month: '2026-08',
            user_id: 'editor-1',
          },
        }),
      );
    });

    it('Editor/Member cannot see another user\'s KPI by passing a different user_id', async () => {
      const { service, prisma } = build();
      await service.getEditorKpis(
        '2026-08',
        'someone-else',
        { id: 'editor-1', roles: ['EDITOR'] },
      );

      expect(prisma.editorKpi.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            month: '2026-08',
            user_id: 'editor-1',
          },
        }),
      );
    });

    it('Editor/Member filtering by team still only returns their own KPI within that team', async () => {
      const { service, prisma } = build();
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
            user_id: 'editor-1',
            team_id: 'team-global',
          },
        }),
      );
    });

    it('Member role behaves the same as Editor: only their own KPI', async () => {
      const { service, prisma } = build();
      await service.getEditorKpis('2026-08', undefined, { id: 'member-1', roles: ['MEMBER'] });

      expect(prisma.editorKpi.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            month: '2026-08',
            user_id: 'member-1',
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

  // product_profit — chỉ số SP Profit, không tham gia validate allocations, fallback 0 khi FE không gửi.
  describe('upsertEditorKpi — product_profit', () => {
    function buildProductProfit() {
      const prisma: any = {
        editorKpi: {
          findUnique: jest.fn(async () => null),
          create: jest.fn(async (args: any) => ({ id: 'kpi-1', ...args.data })),
          update: jest.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
        },
        editorKpiAllocation: { deleteMany: jest.fn(async () => ({})) },
      };
      const service = new TaskAutoKpiService(prisma, {} as any, {} as any);
      return { service, prisma };
    }

    it('không truyền product_profit → mặc định 0 khi tạo mới', async () => {
      const { service, prisma } = buildProductProfit();

      await service.upsertEditorKpi(
        {
          user_id: 'user-1',
          team_id: 'team-1',
          month: '2026-08',
          total_target: 0,
          product_planned: 0,
          product_win_collect: 0,
          allocations: [],
        } as any,
        'admin-1',
        ['ADMIN'],
      );

      const createArgs = prisma.editorKpi.create.mock.calls[0][0];
      expect(createArgs.data.product_profit).toBe(0);
    });

    it('có truyền product_profit → giữ nguyên giá trị, ghi đúng xuống DB cùng lứa GMV/Traffic', async () => {
      const { service, prisma } = buildProductProfit();

      await service.upsertEditorKpi(
        {
          user_id: 'user-1',
          team_id: 'team-1',
          month: '2026-08',
          total_target: 0,
          product_planned: 10,
          product_win_collect: 4,
          product_profit: 6,
          allocations: [],
        } as any,
        'admin-1',
        ['ADMIN'],
      );

      const createArgs = prisma.editorKpi.create.mock.calls[0][0];
      expect(createArgs.data.product_planned).toBe(10);
      expect(createArgs.data.product_win_collect).toBe(4);
      expect(createArgs.data.product_profit).toBe(6);
    });
  });
});

// upsertEditorDailyKpis() — set KPI ngày theo lô; unique (user_id, team_id, date), target=0 vẫn hợp lệ ở tầng ghi.
describe('TaskAutoKpiService.upsertEditorDailyKpis', () => {
  function build(opts: {
    team?: any;
    members?: { user_id: string }[];
  } = {}) {
    const upsertCalls: any[] = [];
    const prisma: any = {
      team: {
        findFirst: jest.fn(async () =>
          opts.team === undefined ? { id: 'team-1', leader_id: 'leader-1' } : opts.team,
        ),
      },
      teamMember: {
        findMany: jest.fn(async () =>
          opts.members === undefined ? [{ user_id: 'editor-1' }, { user_id: 'editor-2' }] : opts.members,
        ),
      },
      editorDailyKpi: {
        upsert: jest.fn(async (args: any) => {
          upsertCalls.push(args);
          return { id: `daily-${upsertCalls.length}`, ...args.create };
        }),
      },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const service = new TaskAutoKpiService(prisma, {} as any, {} as any);
    return { service, prisma, upsertCalls };
  }

  const baseDto: UpsertEditorDailyKpiDto = {
    team_id: 'team-1',
    date: '2026-08-12',
    entries: [
      { user_id: 'editor-1', target: 3, note: undefined },
      { user_id: 'editor-2', target: 0 },
    ],
  } as any;

  afterEach(() => jest.clearAllMocks());

  it('LEADER lead đúng team → set thành công, upsert đúng số lượng entry', async () => {
    const { service, upsertCalls } = build();

    const result = await service.upsertEditorDailyKpis(baseDto, 'leader-1', ['LEADER']);

    expect(result).toHaveLength(2);
    expect(upsertCalls).toHaveLength(2);
  });

  it('LEADER không lead team này → ForbiddenException, không gọi upsert', async () => {
    const { service, prisma, upsertCalls } = build({ team: null });

    await expect(
      service.upsertEditorDailyKpis(baseDto, 'someone-else', ['LEADER']),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.teamMember.findMany).not.toHaveBeenCalled();
    expect(upsertCalls).toHaveLength(0);
  });

  it('ADMIN không cần là leader của team vẫn set được', async () => {
    const { service, prisma } = build();

    await service.upsertEditorDailyKpis(baseDto, 'admin-1', ['ADMIN']);

    // Không kiểm tra team.leader_id với role ADMIN/MANAGER.
    expect(prisma.team.findFirst).not.toHaveBeenCalled();
  });

  it('entry có user không thuộc team → BadRequestException, không upsert', async () => {
    const { service, upsertCalls } = build({ members: [{ user_id: 'editor-1' }] });

    await expect(
      service.upsertEditorDailyKpis(baseDto, 'leader-1', ['LEADER']),
    ).rejects.toThrow(BadRequestException);
    expect(upsertCalls).toHaveLength(0);
  });

  it('target = 0 vẫn được ghi bình thường (không bị lọc/chặn ở tầng service)', async () => {
    const { service, upsertCalls } = build();

    await service.upsertEditorDailyKpis(baseDto, 'leader-1', ['LEADER']);

    const zeroEntry = upsertCalls.find((c) => c.create.user_id === 'editor-2');
    expect(zeroEntry.create.target).toBe(0);
  });

  it('quy đổi date sang UTC midnight qua dailyKpiDate() và dùng đúng composite key cho where', async () => {
    const { service, upsertCalls } = build();

    await service.upsertEditorDailyKpis(baseDto, 'leader-1', ['LEADER']);

    const expectedDate = dailyKpiDate('2026-08-12');
    for (const call of upsertCalls) {
      expect(call.where.user_id_team_id_date.date).toEqual(expectedDate);
      expect(call.where.user_id_team_id_date.team_id).toBe('team-1');
      expect(call.create.set_by_id).toBe('leader-1');
      expect(call.update.set_by_id).toBe('leader-1');
    }
  });
});

// Content Creator KPI (target tháng) — mirror EditorKpi; LEADER chỉ set được cho thành viên trong team mình lead.
describe('TaskAutoKpiService — Content Creator KPI (tháng)', () => {
  function notFoundError() {
    return new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '5.22.0',
    });
  }

  function build(opts: { myTeam?: any; isMember?: any; existing?: any } = {}) {
    const createCalls: any[] = [];
    const updateCalls: any[] = [];
    const deleteCalls: any[] = [];
    const prisma: any = {
      team: {
        findFirst: jest.fn(async () =>
          opts.myTeam === undefined ? { id: 'team-1', leader_id: 'leader-1' } : opts.myTeam,
        ),
      },
      teamMember: {
        findFirst: jest.fn(async () =>
          opts.isMember === undefined ? { id: 'tm-1' } : opts.isMember,
        ),
      },
      contentCreatorKpi: {
        findUnique: jest.fn(async () => (opts.existing === undefined ? null : opts.existing)),
        create: jest.fn(async (args: any) => {
          createCalls.push(args);
          return { id: 'cck-new', ...args.data };
        }),
        update: jest.fn(async (args: any) => {
          updateCalls.push(args);
          return { id: args.where.id, ...args.data };
        }),
        delete: jest.fn(async (args: any) => {
          deleteCalls.push(args);
          return { id: args.where.id };
        }),
        findMany: jest.fn(async () => []),
      },
    };
    const service = new TaskAutoKpiService(prisma, {} as any, {} as any);
    return { service, prisma, createCalls, updateCalls, deleteCalls };
  }

  const baseDto: UpsertContentCreatorKpiDto = {
    user_id: 'creator-1',
    team_id: 'team-1',
    month: '2026-08',
    content_target: 20,
    translation_target: 5,
  } as any;

  afterEach(() => jest.clearAllMocks());

  describe('upsertContentCreatorKpi', () => {
    it('ADMIN đặt KPI cho user bất kỳ — không check leader/membership', async () => {
      const { service, prisma, createCalls } = build();

      await service.upsertContentCreatorKpi(baseDto, 'admin-1', ['ADMIN']);

      expect(prisma.team.findFirst).not.toHaveBeenCalled();
      expect(createCalls).toHaveLength(1);
    });

    it('LEADER lead đúng team + user thuộc team → tạo mới thành công', async () => {
      const { service, createCalls } = build();

      const result = await service.upsertContentCreatorKpi(baseDto, 'leader-1', ['LEADER']);

      expect(result.content_target).toBe(20);
      expect(createCalls[0].data.set_by_id).toBe('leader-1');
    });

    it('LEADER không lead team này → ForbiddenException', async () => {
      const { service } = build({ myTeam: null });

      await expect(
        service.upsertContentCreatorKpi(baseDto, 'someone-else', ['LEADER']),
      ).rejects.toThrow(ForbiddenException);
    });

    it('LEADER lead đúng team nhưng user KHÔNG thuộc team → ForbiddenException', async () => {
      const { service } = build({ isMember: null });

      await expect(
        service.upsertContentCreatorKpi(baseDto, 'leader-1', ['LEADER']),
      ).rejects.toThrow(ForbiddenException);
    });

    it('đã có bản ghi cho (user, team, month) → update thay vì tạo mới', async () => {
      const { service, updateCalls, createCalls } = build({
        existing: { id: 'cck-existing' },
      });

      await service.upsertContentCreatorKpi(baseDto, 'admin-1', ['ADMIN']);

      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].where).toEqual({ id: 'cck-existing' });
      expect(createCalls).toHaveLength(0);
    });

    it('content_target/translation_target = 0 vẫn ghi bình thường (0 = chưa set ở tầng ĐỌC, không chặn ở tầng ghi)', async () => {
      const { service, createCalls } = build();

      await service.upsertContentCreatorKpi(
        { ...baseDto, content_target: 0, translation_target: 0 },
        'admin-1',
        ['ADMIN'],
      );

      expect(createCalls[0].data.content_target).toBe(0);
      expect(createCalls[0].data.translation_target).toBe(0);
    });
  });

  describe('deleteContentCreatorKpi', () => {
    it('xoá thành công', async () => {
      const { service, deleteCalls } = build();

      const result = await service.deleteContentCreatorKpi('cck-1');

      expect(result).toEqual({ success: true });
      expect(deleteCalls[0].where).toEqual({ id: 'cck-1' });
    });

    it('id không tồn tại (P2025) → NotFoundException', async () => {
      const prisma: any = {
        contentCreatorKpi: {
          delete: jest.fn(async () => {
            throw notFoundError();
          }),
        },
      };
      const service = new TaskAutoKpiService(prisma, {} as any, {} as any);

      await expect(service.deleteContentCreatorKpi('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getContentCreatorKpis', () => {
    it('lọc theo month + user_id khi cả hai được truyền', async () => {
      const { service, prisma } = build();

      await service.getContentCreatorKpis('2026-08', 'creator-1');

      expect(prisma.contentCreatorKpi.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { month: '2026-08', user_id: 'creator-1' } }),
      );
    });

    it('không truyền filter nào → where rỗng, lấy tất cả', async () => {
      const { service, prisma } = build();

      await service.getContentCreatorKpis();

      expect(prisma.contentCreatorKpi.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });
  });
});

// Content Creator Daily KPI — mirror upsertEditorDailyKpis(); mọi user trong entries phải thuộc đúng team LEADER lead.
describe('TaskAutoKpiService — Content Creator Daily KPI', () => {
  function notFoundError() {
    return new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '5.22.0',
    });
  }

  function build(opts: { team?: any; members?: { user_id: string }[] } = {}) {
    const upsertCalls: any[] = [];
    const prisma: any = {
      team: {
        findFirst: jest.fn(async () =>
          opts.team === undefined ? { id: 'team-1', leader_id: 'leader-1' } : opts.team,
        ),
      },
      teamMember: {
        findMany: jest.fn(async () =>
          opts.members === undefined
            ? [{ user_id: 'creator-1' }, { user_id: 'creator-2' }]
            : opts.members,
        ),
      },
      contentCreatorDailyKpi: {
        upsert: jest.fn(async (args: any) => {
          upsertCalls.push(args);
          return { id: `daily-${upsertCalls.length}`, ...args.create };
        }),
        delete: jest.fn(async (args: any) => ({ id: args.where.id })),
        findMany: jest.fn(async () => []),
      },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const service = new TaskAutoKpiService(prisma, {} as any, {} as any);
    return { service, prisma, upsertCalls };
  }

  const baseDto: UpsertContentCreatorDailyKpiDto = {
    team_id: 'team-1',
    date: '2026-08-12',
    entries: [
      { user_id: 'creator-1', target: 3, note: undefined },
      { user_id: 'creator-2', target: 0 },
    ],
  } as any;

  afterEach(() => jest.clearAllMocks());

  it('LEADER lead đúng team → set thành công, upsert đúng số lượng entry', async () => {
    const { service, upsertCalls } = build();

    const result = await service.upsertContentCreatorDailyKpis(baseDto, 'leader-1', ['LEADER']);

    expect(result).toHaveLength(2);
    expect(upsertCalls).toHaveLength(2);
  });

  it('LEADER không lead team này → ForbiddenException, không đụng tới teamMember/upsert', async () => {
    const { service, prisma, upsertCalls } = build({ team: null });

    await expect(
      service.upsertContentCreatorDailyKpis(baseDto, 'someone-else', ['LEADER']),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.teamMember.findMany).not.toHaveBeenCalled();
    expect(upsertCalls).toHaveLength(0);
  });

  it('ADMIN không cần là leader của team vẫn set được', async () => {
    const { service, prisma } = build();

    await service.upsertContentCreatorDailyKpis(baseDto, 'admin-1', ['ADMIN']);

    expect(prisma.team.findFirst).not.toHaveBeenCalled();
  });

  it('entry có user không thuộc team → BadRequestException, không upsert gì', async () => {
    const { service, upsertCalls } = build({ members: [{ user_id: 'creator-1' }] });

    await expect(
      service.upsertContentCreatorDailyKpis(baseDto, 'leader-1', ['LEADER']),
    ).rejects.toThrow(BadRequestException);
    expect(upsertCalls).toHaveLength(0);
  });

  it('target = 0 vẫn được ghi bình thường', async () => {
    const { service, upsertCalls } = build();

    await service.upsertContentCreatorDailyKpis(baseDto, 'leader-1', ['LEADER']);

    const zeroEntry = upsertCalls.find((c) => c.create.user_id === 'creator-2');
    expect(zeroEntry.create.target).toBe(0);
  });

  it('quy đổi date qua dailyKpiDate() và dùng đúng composite key user_id_team_id_date', async () => {
    const { service, upsertCalls } = build();

    await service.upsertContentCreatorDailyKpis(baseDto, 'leader-1', ['LEADER']);

    const expectedDate = dailyKpiDate('2026-08-12');
    for (const call of upsertCalls) {
      expect(call.where.user_id_team_id_date.date).toEqual(expectedDate);
      expect(call.where.user_id_team_id_date.team_id).toBe('team-1');
      expect(call.create.set_by_id).toBe('leader-1');
      expect(call.update.set_by_id).toBe('leader-1');
    }
  });

  describe('deleteContentCreatorDailyKpi', () => {
    it('id không tồn tại (P2025) → NotFoundException', async () => {
      const prisma: any = {
        contentCreatorDailyKpi: {
          delete: jest.fn(async () => {
            throw notFoundError();
          }),
        },
      };
      const service = new TaskAutoKpiService(prisma, {} as any, {} as any);

      await expect(service.deleteContentCreatorDailyKpi('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getContentCreatorDailyKpis', () => {
    it('lọc theo đúng 1 ngày (date) → dùng dailyKpiDate(), không phải khoảng from/to', async () => {
      const { service, prisma } = build();

      await service.getContentCreatorDailyKpis({ date: '2026-08-12' });

      expect(prisma.contentCreatorDailyKpi.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { date: dailyKpiDate('2026-08-12') } }),
      );
    });

    it('lọc theo khoảng from/to khi không truyền date', async () => {
      const { service, prisma } = build();

      await service.getContentCreatorDailyKpis({ from: '2026-08-01', to: '2026-08-31' });

      expect(prisma.contentCreatorDailyKpi.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            date: { gte: dailyKpiDate('2026-08-01'), lte: dailyKpiDate('2026-08-31') },
          },
        }),
      );
    });
  });
});
