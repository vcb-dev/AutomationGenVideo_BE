import { TaskAutoKpiService } from '../kpi.service';
import { UpsertContentCreatorKpiDto } from '../kpi.dto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Content Creator KPI (target THÁNG, đặt tay) — mirror EditorKpi. Unique theo
 * (user_id, team_id, month); LEADER chỉ set được cho thành viên TRONG team mình lead.
 */
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
    const service = new TaskAutoKpiService(prisma);
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
      const service = new TaskAutoKpiService(prisma);

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
