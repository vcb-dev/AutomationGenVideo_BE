import { TaskAutoKpiService } from '../kpi.service';
import { UpsertEditorDailyKpiDto } from '../kpi.dto';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { dailyKpiDate } from '../../../../utils/date.utils';

/**
 * upsertEditorDailyKpis() — set KPI ngày theo lô (cả team cho 1 ngày).
 * Xem [[editor-daily-kpi-design]]: unique theo (user_id, team_id, date), LEADER chỉ
 * được set cho team mình lead, target=0 vẫn là giá trị hợp lệ (nghĩa là "chưa set"
 * ở tầng đọc, không bị chặn ở tầng ghi).
 */
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
    const service = new TaskAutoKpiService(prisma);
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
