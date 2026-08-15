import { TaskAutoKpiService } from '../kpi.service';
import { UpsertContentCreatorDailyKpiDto } from '../kpi.dto';
import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dailyKpiDate } from '../../../../utils/date.utils';

/**
 * Content Creator Daily KPI — set KPI ngày theo lô (cả team cho 1 ngày), mirror
 * upsertEditorDailyKpis(). Unique theo (user_id, team_id, date); LEADER chỉ set được
 * cho team mình lead; mọi user trong entries phải thuộc đúng team đó.
 */
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
    const service = new TaskAutoKpiService(prisma);
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
      const service = new TaskAutoKpiService(prisma);

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
