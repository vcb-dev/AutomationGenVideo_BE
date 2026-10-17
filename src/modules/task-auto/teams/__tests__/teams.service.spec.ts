import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TaskAutoTeamsService } from '../teams.service';
import { taskProductSkuWhere } from '../../../../common/utils/content-product-link.util';
import {
  buildHrmSyncPlan, hrmMemberKind, HrmEmployee, HrmSyncInput, HrmTeamSyncService, SyncTeam, SyncUser,
} from '../hrm-team-sync.service';
import { recomputeUserTeamFieldsBatch } from '../../../../common/utils/team-membership.util';

// create()/update() gọi seedEditorKpiForMembers + recomputeUserTeamFieldsBatch (qua
// syncAffectedUsers) bằng chính transaction client — không liên quan gì tới việc lưu đúng
// field của Team, mock hẳn ra để test create()/update() không phải dựng lại toàn bộ prisma
// mock của 2 helper đó.
jest.mock('../../../../common/utils/team-membership.util', () => ({
  ...jest.requireActual('../../../../common/utils/team-membership.util'),
  seedEditorKpiForMembers: jest.fn(async () => undefined),
  recomputeUserTeamFieldsBatch: jest.fn(async () => undefined),
}));

describe('TaskAutoTeamsService.remove', () => {
  const ALL_ZERO = {
    task: 0, contentVideo: 0, caseStudy: 0, editorPerformance: 0,
    cloneVideo: 0, actionItem: 0, teamKpiSnapshot: 0, meetingSession: 0,
  };

  function build(opts: { team?: any; counts?: Record<string, number> } = {}) {
    const counts = { ...ALL_ZERO, ...(opts.counts || {}) };
    const deletedIds: string[] = [];
    const tx: any = {
      task: { count: jest.fn(async () => counts.task) },
      contentVideo: { count: jest.fn(async () => counts.contentVideo) },
      caseStudy: { count: jest.fn(async () => counts.caseStudy) },
      editorPerformance: { count: jest.fn(async () => counts.editorPerformance) },
      cloneVideo: { count: jest.fn(async () => counts.cloneVideo) },
      actionItem: { count: jest.fn(async () => counts.actionItem) },
      teamKpiSnapshot: { count: jest.fn(async () => counts.teamKpiSnapshot) },
      meetingSession: { count: jest.fn(async () => counts.meetingSession) },
      team: { delete: jest.fn(async ({ where }: any) => { deletedIds.push(where.id); return {}; }) },
    };
    const prisma: any = {
      team: {
        findUnique: jest.fn(async () => (opts.team === undefined
          ? { id: 'team-1', leader_id: 'leader-1', members: [] }
          : opts.team)),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const service = new TaskAutoTeamsService(prisma, {} as any);
    return { service, prisma, tx, deletedIds };
  }

  afterEach(() => jest.clearAllMocks());

  it('xóa được khi không còn dữ liệu ràng buộc nào', async () => {
    const { service, deletedIds } = build();
    const result = await service.remove('team-1');

    expect(result).toEqual({ success: true });
    expect(deletedIds).toEqual(['team-1']);
  });

  it('chặn xóa khi team còn task, báo lỗi kèm số lượng cụ thể', async () => {
    const { service, deletedIds } = build({ counts: { task: 2 } });

    await expect(service.remove('team-1')).rejects.toThrow(ConflictException);
    await expect(service.remove('team-1')).rejects.toThrow(/2 task/);
    expect(deletedIds).toHaveLength(0);
  });

  it('liệt kê đủ nhiều loại dữ liệu ràng buộc cùng lúc trong message', async () => {
    const { service } = build({ counts: { task: 1, caseStudy: 3 } });

    await expect(service.remove('team-1')).rejects.toThrow(/1 task/);
    await expect(service.remove('team-1')).rejects.toThrow(/3 case study/);
  });

  it('báo lỗi NotFoundException nếu team không tồn tại', async () => {
    const { service } = build({ team: null });

    await expect(service.remove('missing-id')).rejects.toThrow(NotFoundException);
  });
});

describe('TaskAutoTeamsService — OMS product sync', () => {
  const team = { id: 'team-1', leader_id: 'leader-1', members: [{ user_id: 'leader-1' }] }
  const sampleVariant = { id: 'var-1', sku: 'SKU-NEW', price: 150000, image_url: null }
  const sampleProduct = { id: 'prod-1', name: 'Áo thun basic', image_url: null, images: [] }

  function build(opts: { dupOmsVariant?: any; existingSku?: any } = {}) {
    const created: any[] = []
    const prisma: any = {
      team: { findUnique: jest.fn(async () => team) },
      teamProduct: {
        findFirst: jest.fn(async (args: any) => {
          if (args.where.oms_variant_id !== undefined) return opts.dupOmsVariant ?? null
          if (args.where.sku !== undefined) return opts.existingSku ?? null
          return null
        }),
        create: jest.fn(async (args: any) => { created.push(args); return { id: 'tp-new', ...args.data } }),
        update: jest.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
      },
      teamSource: { updateMany: jest.fn(async () => ({ count: 0 })) },
    }
    const oms: any = { getProductVariant: jest.fn(async () => ({ product: sampleProduct, variant: sampleVariant })) }
    const service = new TaskAutoTeamsService(prisma, oms)
    return { service, prisma, oms, created }
  }

  afterEach(() => jest.clearAllMocks())

  it('kéo sản phẩm OMS mới về kho team thành công', async () => {
    const { service, oms, created } = build()

    const result = await service.addTeamProduct(
      'team-1',
      { oms_product_id: 'prod-1', oms_variant_id: 'var-1', brand_type: 'DO_DA' } as any,
      'leader-1',
      ['LEADER'],
    )

    expect(oms.getProductVariant).toHaveBeenCalledWith('prod-1', 'var-1')
    expect(created[0].data).toEqual(
      expect.objectContaining({ team_id: 'team-1', oms_product_id: 'prod-1', oms_variant_id: 'var-1', sku: 'SKU-NEW' }),
    )
    expect(result).toEqual(expect.objectContaining({ id: 'tp-new' }))
  })

  it('thiếu oms_product_id kèm oms_variant_id → báo lỗi rõ ràng, không gọi OMS', async () => {
    const { service, oms } = build()

    await expect(
      service.addTeamProduct('team-1', { oms_variant_id: 'var-1', brand_type: 'DO_DA' } as any, 'leader-1', ['LEADER']),
    ).rejects.toThrow(BadRequestException)
    expect(oms.getProductVariant).not.toHaveBeenCalled()
  })

  it('variant OMS đã được kéo vào team này rồi → ConflictException, không tạo trùng', async () => {
    const { service, oms } = build({ dupOmsVariant: { id: 'tp-existing' } })

    await expect(
      service.addTeamProduct('team-1', { oms_product_id: 'prod-1', oms_variant_id: 'var-1', brand_type: 'DO_DA' } as any, 'leader-1', ['LEADER']),
    ).rejects.toThrow(ConflictException)
    expect(oms.getProductVariant).not.toHaveBeenCalled()
  })

  it('thiếu brand_type khi kéo từ OMS → BadRequestException', async () => {
    const { service } = build()

    await expect(
      service.addTeamProduct('team-1', { oms_product_id: 'prod-1', oms_variant_id: 'var-1' } as any, 'leader-1', ['LEADER']),
    ).rejects.toThrow(BadRequestException)
  })

  it('SKU của variant OMS đã tồn tại trong kho team (thêm thủ công trước đó) → Conflict', async () => {
    const { service } = build({ existingSku: { id: 'tp-other' } })

    await expect(
      service.addTeamProduct('team-1', { oms_product_id: 'prod-1', oms_variant_id: 'var-1', brand_type: 'DO_DA' } as any, 'leader-1', ['LEADER']),
    ).rejects.toThrow(ConflictException)
  })

  describe('refreshTeamProductFromOms', () => {
    it('làm mới sku/tên/giá/ảnh theo dữ liệu OMS mới nhất, giữ nguyên field nghiệp vụ', async () => {
      const { service, prisma } = build()
      const entry = { id: 'tp-1', team_id: 'team-1', sku: 'SKU-OLD', oms_product_id: 'prod-1', oms_variant_id: 'var-1' }
      prisma.teamProduct.findFirst = jest.fn(async (args: any) =>
        args.where.id !== undefined ? entry : null,
      )

      const result = await service.refreshTeamProductFromOms('team-1', 'tp-1', 'leader-1', ['LEADER'])

      expect(prisma.teamProduct.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tp-1' },
          data: expect.objectContaining({ sku: 'SKU-NEW', name: 'Áo thun basic', price: 150000 }),
        }),
      )
      expect(result).toEqual(expect.objectContaining({ sku: 'SKU-NEW' }))
    })

    it('sản phẩm không có nguồn gốc OMS (thêm thủ công) → không cho làm mới', async () => {
      const { service, prisma } = build()
      prisma.teamProduct.findFirst = jest.fn(async () => ({ id: 'tp-1', team_id: 'team-1', sku: 'SKU-X', oms_product_id: null, oms_variant_id: null }))

      await expect(service.refreshTeamProductFromOms('team-1', 'tp-1', 'leader-1', ['LEADER'])).rejects.toThrow(
        BadRequestException,
      )
    })

    it('sản phẩm không tồn tại trong kho team → NotFoundException', async () => {
      const { service, prisma } = build()
      prisma.teamProduct.findFirst = jest.fn(async () => null)

      await expect(service.refreshTeamProductFromOms('team-1', 'tp-missing', 'leader-1', ['LEADER'])).rejects.toThrow(
        NotFoundException,
      )
    })
  })
})

describe('TaskAutoTeamsService — lọc content theo tuyến + chi tiết TeamContent', () => {
  function build() {
    const findManyCalls: any[] = [];
    const prisma: any = {
      team: { findUnique: jest.fn(async () => ({ id: 'team-1' })) },
      teamContent: {
        findMany: jest.fn(async (args: any) => {
          findManyCalls.push(args);
          return [];
        }),
        findUnique: jest.fn(async () => null),
      },
    };
    const service = new TaskAutoTeamsService(prisma, {} as any);
    return { service, prisma, getWhere: () => findManyCalls[0]?.where };
  }

  describe('listTeamContents — sentinel __unassigned__', () => {
    it('content_line_id="__unassigned__" → lọc content_line_id null của chính record VÀ (chưa có bản gốc HOẶC bản gốc cũng chưa gán tuyến)', async () => {
      const { service, getWhere } = build();

      await service.listTeamContents('team-1', undefined, undefined, undefined, {
        content_line_id: '__unassigned__',
      });

      expect(getWhere().AND).toEqual([
        { content_line_id: null },
        {
          OR: [
            { source_editor_content_id: null },
            { source_editor_content: { content_line_id: null } },
          ],
        },
      ]);
    });

    it('content_line_id thường → lọc theo tuyến của chính record HOẶC (record null nhưng bản gốc thuộc đúng tuyến đó)', async () => {
      const { service, getWhere } = build();

      await service.listTeamContents('team-1', undefined, undefined, undefined, {
        content_line_id: 'line-a1',
      });

      expect(getWhere().AND).toEqual([
        {
          OR: [
            { content_line_id: 'line-a1' },
            {
              AND: [
                { content_line_id: null },
                { source_editor_content: { content_line_id: 'line-a1' } },
              ],
            },
          ],
        },
      ]);
    });

    it('không truyền content_line_id → không lọc theo tuyến (không có AND)', async () => {
      const { service, getWhere } = build();

      await service.listTeamContents('team-1');

      expect(getWhere().AND).toBeUndefined();
    });
  });

  describe('findOneTeamContent', () => {
    it('trả về đầy đủ bản ghi (có body/script) khi tồn tại', async () => {
      const { service, prisma } = build();
      prisma.teamContent.findUnique.mockResolvedValueOnce({
        id: 'tc-1',
        body: 'nội dung đầy đủ',
        script: 'kịch bản đầy đủ',
      });

      const result = await service.findOneTeamContent('tc-1');

      expect(result).toEqual({ id: 'tc-1', body: 'nội dung đầy đủ', script: 'kịch bản đầy đủ' });
      expect(prisma.teamContent.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'tc-1' } }),
      );
    });

    it('không tồn tại → NotFoundException', async () => {
      const { service } = build();

      await expect(service.findOneTeamContent('tc-x')).rejects.toThrow(NotFoundException);
    });
  });
});

describe('TaskAutoTeamsService.setMemberContentCreator', () => {
  function notFoundError() {
    return new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '5.22.0',
    });
  }

  function build(opts: { team?: any; updateImpl?: () => Promise<any> } = {}) {
    const updateCalls: any[] = [];
    const prisma: any = {
      team: {
        findUnique: jest.fn(async () =>
          opts.team === undefined ? { id: 'team-1', leader_id: 'leader-1' } : opts.team,
        ),
      },
      teamMember: {
        update: jest.fn(async (args: any) => {
          updateCalls.push(args);
          if (opts.updateImpl) return opts.updateImpl();
          return { id: 'tm-1', is_content_creator: args.data.is_content_creator };
        }),
      },
    };
    const service = new TaskAutoTeamsService(prisma, {} as any);
    return { service, prisma, updateCalls };
  }

  afterEach(() => jest.clearAllMocks());

  it('ADMIN đặt content creator cho team bất kỳ — không cần check leader_id', async () => {
    const { service, prisma, updateCalls } = build();

    const result = await service.setMemberContentCreator('team-1', 'user-1', true, 'admin-1', ['ADMIN']);

    expect(result.is_content_creator).toBe(true);
    expect(prisma.team.findUnique).not.toHaveBeenCalled();
    expect(updateCalls[0].where).toEqual({ team_id_user_id: { team_id: 'team-1', user_id: 'user-1' } });
    expect(updateCalls[0].data).toEqual({ is_content_creator: true });
  });

  it('MANAGER cũng set được cho team bất kỳ', async () => {
    const { service, prisma } = build();

    await service.setMemberContentCreator('team-1', 'user-1', true, 'manager-1', ['MANAGER']);

    expect(prisma.team.findUnique).not.toHaveBeenCalled();
  });

  it('LEADER lead đúng team → set thành công', async () => {
    const { service, updateCalls } = build();

    await service.setMemberContentCreator('team-1', 'user-1', true, 'leader-1', ['LEADER']);

    expect(updateCalls).toHaveLength(1);
  });

  it('LEADER KHÔNG lead team này → ForbiddenException, không gọi update', async () => {
    const { service, updateCalls } = build({ team: { id: 'team-1', leader_id: 'someone-else' } });

    await expect(
      service.setMemberContentCreator('team-1', 'user-1', true, 'leader-1', ['LEADER']),
    ).rejects.toThrow(ForbiddenException);
    expect(updateCalls).toHaveLength(0);
  });

  it('bỏ đánh dấu (is_content_creator=false) cũng đi qua đúng luồng quyền', async () => {
    const { service, updateCalls } = build();

    const result = await service.setMemberContentCreator('team-1', 'user-1', false, 'leader-1', ['LEADER']);

    expect(result.is_content_creator).toBe(false);
    expect(updateCalls[0].data).toEqual({ is_content_creator: false });
  });

  it('user không thuộc team (P2025) → NotFoundException với thông báo rõ ràng', async () => {
    const { service } = build({
      updateImpl: async () => {
        throw notFoundError();
      },
    });

    await expect(
      service.setMemberContentCreator('team-1', 'ghost-user', true, 'admin-1', ['ADMIN']),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.setMemberContentCreator('team-1', 'ghost-user', true, 'admin-1', ['ADMIN']),
    ).rejects.toThrow(/không trong team/);
  });
});

describe('TaskAutoTeamsService.getMyEditorApproval', () => {
  function build(opts: { approval?: any } = {}) {
    const prisma: any = {
      editorApproval: {
        findFirst: jest.fn(async () => (opts.approval === undefined ? null : opts.approval)),
      },
    };
    const service = new TaskAutoTeamsService(prisma, {} as any);
    return { service, prisma };
  }

  it('user chưa từng yêu cầu duyệt → status null', async () => {
    const { service, prisma } = build();

    const result = await service.getMyEditorApproval('user-1');

    expect(result).toEqual({ status: null });
    expect(prisma.editorApproval.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: 'user-1' } }),
    );
  });

  it('user đã được duyệt → status APPROVED', async () => {
    const { service } = build({ approval: { status: 'APPROVED' } });

    const result = await service.getMyEditorApproval('user-1');

    expect(result).toEqual({ status: 'APPROVED' });
  });

  it('user đang chờ duyệt → status PENDING', async () => {
    const { service } = build({ approval: { status: 'PENDING' } });

    const result = await service.getMyEditorApproval('user-1');

    expect(result).toEqual({ status: 'PENDING' });
  });

  it('chỉ trả về bản ghi mới nhất của chính user đó, không lộ dữ liệu người khác', async () => {
    const { service, prisma } = build({ approval: { status: 'REJECTED' } });

    await service.getMyEditorApproval('user-2');

    expect(prisma.editorApproval.findFirst).toHaveBeenCalledWith({
      where: { user_id: 'user-2' },
      orderBy: { created_at: 'desc' },
      select: { status: true },
    });
  });
});

describe('TaskAutoTeamsService.getMemberSourceStats', () => {
  function build(opts: { team?: any; globalCounts?: any[]; teamCounts?: any[] } = {}) {
    const groupByCalls: { source?: any; teamSource?: any } = {};
    const prisma: any = {
      team: {
        findUnique: jest.fn(async () =>
          opts.team === undefined
            ? {
                id: 'team-1',
                members: [
                  { user_id: 'collector', user: { id: 'collector', full_name: 'Người sưu tầm', email: 'c@x.vn', image_url: null } },
                  { user_id: 'leader-1', user: { id: 'leader-1', full_name: 'Leader', email: 'l@x.vn', image_url: null } },
                ],
              }
            : opts.team,
        ),
      },
      source: {
        groupBy: jest.fn(async (args: any) => {
          groupByCalls.source = args;
          return opts.globalCounts ?? [];
        }),
      },
      teamSource: {
        groupBy: jest.fn(async (args: any) => {
          groupByCalls.teamSource = args;
          return opts.teamCounts ?? [];
        }),
      },
    };
    const service = new TaskAutoTeamsService(prisma, {} as any);
    return { service, prisma, groupByCalls };
  }

  afterEach(() => jest.clearAllMocks());

  it('nhánh "kho chung" chỉ đếm source tạo thẳng (source_team_source_id: null), loại source đẩy từ kho team', async () => {
    const { service, groupByCalls } = build();

    await service.getMemberSourceStats('team-1', '2026-08');

    expect(groupByCalls.source.where).toEqual(
      expect.objectContaining({ source_team_source_id: null }),
    );
    expect(groupByCalls.teamSource.where).not.toHaveProperty('source_team_source_id');
  });

  it('lọc theo memberIds của team và khoảng thời gian của tháng được chọn', async () => {
    const { service, groupByCalls } = build();

    await service.getMemberSourceStats('team-1', '2026-08');

    expect(groupByCalls.source.where.added_by_id).toEqual({ in: ['collector', 'leader-1'] });
    expect(groupByCalls.source.where.created_at.gte).toEqual(new Date(2026, 7, 1));
    expect(groupByCalls.source.where.created_at.lte).toEqual(new Date(2026, 7, 31, 23, 59, 59, 999));
    expect(groupByCalls.teamSource.where.added_at.gte).toEqual(new Date(2026, 7, 1));
  });

  it('source đẩy kho team → kho tổng chỉ tính 1 lần cho người sưu tầm, không cộng cho leader', async () => {
    const { service } = build({
      globalCounts: [],
      teamCounts: [{ added_by_id: 'collector', _count: { id: 3 } }],
    });

    const result = await service.getMemberSourceStats('team-1', '2026-08');

    const collector = result.find(r => r.user_id === 'collector')!;
    const leader = result.find(r => r.user_id === 'leader-1')!;
    expect(collector).toEqual(expect.objectContaining({ team_sources: 3, global_sources: 0, total: 3 }));
    expect(leader).toEqual(expect.objectContaining({ team_sources: 0, global_sources: 0, total: 0 }));
  });

  it('cộng global + team cho từng người và sắp xếp giảm dần theo total', async () => {
    const { service } = build({
      globalCounts: [{ added_by_id: 'collector', _count: { id: 1 } }],
      teamCounts: [
        { added_by_id: 'collector', _count: { id: 2 } },
        { added_by_id: 'leader-1', _count: { id: 5 } },
      ],
    });

    const result = await service.getMemberSourceStats('team-1', '2026-08');

    expect(result.map(r => r.user_id)).toEqual(['leader-1', 'collector']);
    expect(result[0]).toEqual(expect.objectContaining({ user_id: 'leader-1', global_sources: 0, team_sources: 5, total: 5 }));
    expect(result[1]).toEqual(expect.objectContaining({ user_id: 'collector', global_sources: 1, team_sources: 2, total: 3 }));
  });

  it('team không tồn tại → NotFoundException', async () => {
    const { service } = build({ team: null });

    await expect(service.getMemberSourceStats('missing', '2026-08')).rejects.toThrow(NotFoundException);
  });
});

describe('TaskAutoTeamsService — select team content kèm _count.tasks', () => {
  const service = new TaskAutoTeamsService({} as any, {} as any) as any;

  it('teamContentInclude có _count.tasks', () => {
    expect(service.teamContentInclude._count).toEqual({ select: { tasks: true } });
  });

  it('teamContentListSelect có _count.tasks', () => {
    expect(service.teamContentListSelect._count).toEqual({ select: { tasks: true } });
  });
});

describe('TaskAutoTeamsService.create/update — webhook Lark riêng của team', () => {
  function build(opts: { existingTeam?: any } = {}) {
    const createCalls: any[] = [];
    const updateCalls: any[] = [];
    const tx: any = {
      team: {
        create: jest.fn(async (a: any) => {
          createCalls.push(a.data);
          return { id: 'team-new', ...a.data, lark_webhook_secret: a.data.lark_webhook_secret ?? null };
        }),
        update: jest.fn(async (a: any) => {
          updateCalls.push(a.data);
          return { id: 'team-1', leader_id: null, ...a.data };
        }),
      },
      teamMember: { createMany: jest.fn(async () => ({ count: 0 })), deleteMany: jest.fn(async () => ({ count: 0 })) },
    };
    const prisma: any = {
      team: { findUnique: jest.fn(async () => opts.existingTeam ?? null) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const service = new TaskAutoTeamsService(prisma, {} as any) as any;
    jest.spyOn(service, 'findOneForAuth').mockResolvedValue({ id: 'team-1', leader_id: null, members: [] });
    return { service, tx, createCalls, updateCalls };
  }

  it('create(): lưu đúng lark_webhook_url/secret truyền vào, không bị rớt mất', async () => {
    const { service, createCalls } = build();
    await service.create(
      { name: 'Team X', lark_webhook_url: 'https://open.larksuite.com/hook/abc', lark_webhook_secret: 'shh' },
      'creator-1',
    );
    expect(createCalls[0]).toMatchObject({
      lark_webhook_url: 'https://open.larksuite.com/hook/abc',
      lark_webhook_secret: 'shh',
    });
  });

  it('create(): không truyền webhook Lark → không set field (không lỗi, không rác undefined)', async () => {
    const { service, createCalls } = build();
    await service.create({ name: 'Team Y' }, 'creator-1');
    expect(createCalls[0].lark_webhook_url).toBeUndefined();
    expect(createCalls[0].lark_webhook_secret).toBeUndefined();
  });

  it('update(): lưu đúng lark_webhook_url/secret truyền vào', async () => {
    const { service, updateCalls } = build();
    await service.update(
      'team-1',
      { lark_webhook_url: 'https://open.larksuite.com/hook/xyz', lark_webhook_secret: 'new-secret' },
      'admin-1',
      ['ADMIN'],
    );
    expect(updateCalls[0]).toMatchObject({
      lark_webhook_url: 'https://open.larksuite.com/hook/xyz',
      lark_webhook_secret: 'new-secret',
    });
  });
});

describe('TaskAutoTeamsService.updateTeamContent — đồng bộ tuyến sang task', () => {
  function build(oldLine: string | null) {
    const taskUpdateMany = jest.fn(async () => ({ count: 2 }));
    const tx: any = {
      task: { updateMany: taskUpdateMany },
      teamContent: {
        update: jest.fn(async ({ data }: any) => ({
          id: 'tc-1',
          content_line_id: 'content_line_id' in data ? data.content_line_id : oldLine,
        })),
      },
    };
    const prisma: any = {
      teamContent: {
        findFirst: jest.fn(async () => ({ id: 'tc-1', team_id: 'team-1', content_line_id: oldLine })),
      },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const service = new TaskAutoTeamsService(prisma, {} as any) as any;
    jest.spyOn(service, 'findOneForAuth').mockResolvedValue({ id: 'team-1', leader_id: null, members: [] });
    jest.spyOn(service, 'assertCanManageContent').mockReturnValue(undefined);
    return { service, taskUpdateMany };
  }

  it('content chưa có tuyến → gán A4: task từ content đó đang null được gán A4', async () => {
    const { service, taskUpdateMany } = build(null);

    await service.updateTeamContent('team-1', 'tc-1', { content_line_id: 'line-a4' }, 'u-1', ['ADMIN']);

    expect(taskUpdateMany).toHaveBeenCalledWith({
      where: { team_content_id: 'tc-1', OR: [{ content_line_id: null }] },
      data: { content_line_id: 'line-a4' },
    });
  });

  it('đổi A1 → A2: task đang null hoặc A1 đi theo', async () => {
    const { service, taskUpdateMany } = build('line-a1');

    await service.updateTeamContent('team-1', 'tc-1', { content_line_id: 'line-a2' }, 'u-1', ['ADMIN']);

    expect(taskUpdateMany).toHaveBeenCalledWith({
      where: { team_content_id: 'tc-1', OR: [{ content_line_id: null }, { content_line_id: 'line-a1' }] },
      data: { content_line_id: 'line-a2' },
    });
  });

  it('bỏ tuyến (null) hoặc không gửi content_line_id → không đụng task', async () => {
    const cleared = build('line-a1');
    await cleared.service.updateTeamContent('team-1', 'tc-1', { content_line_id: null }, 'u-1', ['ADMIN']);
    expect(cleared.taskUpdateMany).not.toHaveBeenCalled();

    const titleOnly = build(null);
    await titleOnly.service.updateTeamContent('team-1', 'tc-1', { title: 'Mới' }, 'u-1', ['ADMIN']);
    expect(titleOnly.taskUpdateMany).not.toHaveBeenCalled();
  });
});

describe('TaskAutoTeamsService.listTeamSources — tìm theo tên sản phẩm', () => {
  function buildSources() {
    const findManyCalls: any[] = [];
    const queryRaw = jest.fn(async () => [{ id: 'ts-1' }]);
    const prisma: any = {
      team: { findUnique: jest.fn(async () => ({ id: 'team-1' })) },
      teamSource: {
        findMany: jest.fn(async (args: any) => {
          findManyCalls.push(args);
          return [];
        }),
      },
      $queryRaw: queryRaw,
    };
    const service = new TaskAutoTeamsService(prisma, {} as any);
    return { service, queryRaw, getWhere: () => findManyCalls[0]?.where };
  }

  it('search → lọc theo id khớp; SQL join team_products + products, giới hạn đúng team', async () => {
    const { service, queryRaw, getWhere } = buildSources();

    await service.listTeamSources('team-1', undefined, undefined, undefined, undefined, { search: 'ví da' });

    expect(getWhere().team_id).toBe('team-1');
    expect(getWhere().id).toEqual({ in: ['ts-1'] });
    const sql = (queryRaw.mock.calls[0] as any[])[0] as Prisma.Sql;
    expect(sql.sql).toContain('FROM team_sources s LEFT JOIN team_products tp');
    expect(sql.sql).toContain('tp.name');
    expect(sql.sql).toContain('s.team_id =');
    expect(sql.values).toEqual(['ví da', 'team-1']);
  });

  it('không truyền search → không query raw', async () => {
    const { service, queryRaw, getWhere } = buildSources();

    await service.listTeamSources('team-1');

    expect(queryRaw).not.toHaveBeenCalled();
    expect(getWhere().id).toBeUndefined();
  });

  it('teamId = "all" + search → không lọc team_id, SQL tìm kiếm không giới hạn team', async () => {
    const { service, queryRaw, getWhere } = buildSources();

    await service.listTeamSources('all', undefined, undefined, undefined, undefined, { search: 'ví da' }, ['MANAGER']);

    expect(getWhere()).not.toHaveProperty('team_id');
    expect(getWhere().id).toEqual({ in: ['ts-1'] });
    const sql = (queryRaw.mock.calls[0] as any[])[0] as Prisma.Sql;
    expect(sql.sql).not.toContain('s.team_id =');
    expect(sql.values).toEqual(['ví da']);
  });
});

describe('TaskAutoTeamsService — danh sách kho của tất cả team (teamId = "all")', () => {
  function buildAll() {
    const calls: Record<string, any[]> = { teamProduct: [], teamContent: [] };
    const recordFindMany = (key: string) => jest.fn(async (args: any) => {
      calls[key].push(args);
      return [];
    });
    const prisma: any = {
      team: { findUnique: jest.fn(async () => ({ id: 'team-1' })) },
      teamProduct: { findMany: recordFindMany('teamProduct'), count: jest.fn(async () => 0) },
      teamContent: { findMany: recordFindMany('teamContent'), count: jest.fn(async () => 0) },
    };
    const service = new TaskAutoTeamsService(prisma, {} as any);
    return { service, prisma, calls };
  }

  it('ADMIN xem sản phẩm mọi team → không lọc team_id, không tra team', async () => {
    const { service, prisma, calls } = buildAll();

    await service.listTeamProducts('all', undefined, undefined, undefined, { page: 1, limit: 24 }, ['ADMIN']);

    expect(prisma.team.findUnique).not.toHaveBeenCalled();
    expect(calls.teamProduct[0].where).not.toHaveProperty('team_id');
  });

  it('MANAGER xem content mọi team vẫn giữ các bộ lọc khác', async () => {
    const { service, calls } = buildAll();

    await service.listTeamContents('all', 'DO_DA', undefined, 'cls-1', undefined, ['MANAGER']);

    expect(calls.teamContent[0].where).toEqual({ brand_type: 'DO_DA', classification_id: 'cls-1' });
  });

  it('LEADER/MEMBER hoặc không có roles → ForbiddenException, không query', async () => {
    const { service, calls } = buildAll();

    await expect(service.listTeamProducts('all', undefined, undefined, undefined, undefined, ['LEADER']))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listTeamContents('all'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(calls.teamProduct).toHaveLength(0);
    expect(calls.teamContent).toHaveLength(0);
  });

  it('teamId thường vẫn lọc đúng team như cũ', async () => {
    const { service, prisma, calls } = buildAll();

    await service.listTeamProducts('team-1', undefined, undefined, undefined, undefined, ['ADMIN']);

    expect(prisma.team.findUnique).toHaveBeenCalled();
    expect(calls.teamProduct[0].where.team_id).toBe('team-1');
  });
});

describe('TaskAutoTeamsService — lọc content kho team theo sản phẩm', () => {
  function build() {
    const prisma: any = {
      team: { findUnique: jest.fn(async () => ({ id: 'team-1' })) },
      teamContent: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
      task: { findMany: jest.fn(async () => []) },
    };
    return { service: new TaskAutoTeamsService(prisma, {} as any), prisma };
  }

  it('product_sku → chỉ lấy content có task dùng SKU đó', async () => {
    const { service, prisma } = build();

    await service.listTeamContents('team-1', undefined, undefined, undefined, { page: 1, product_sku: 'N0017' });

    expect(prisma.teamContent.findMany.mock.calls[0][0].where.tasks).toEqual({ some: taskProductSkuWhere('N0017') });
  });

  it('không truyền product_sku → không lọc theo task', async () => {
    const { service, prisma } = build();

    await service.listTeamContents('team-1', undefined, undefined, undefined, { page: 1 });

    expect(prisma.teamContent.findMany.mock.calls[0][0].where).not.toHaveProperty('tasks');
  });

  it('danh sách sản phẩm gắn content chỉ lấy task của content trong team + nhóm hàng', async () => {
    const { service, prisma } = build();

    await service.listTeamContentLinkedProducts('team-1', 'DO_DA', ['LEADER']);

    expect(prisma.task.findMany.mock.calls[0][0].where.AND[0]).toEqual({
      team_content: { is: { team_id: 'team-1', brand_type: 'DO_DA' } },
    });
  });

  it('"all" với LEADER → ForbiddenException, không query task', async () => {
    const { service, prisma } = build();

    await expect(service.listTeamContentLinkedProducts('all', undefined, ['LEADER']))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });
});

describe('Đồng bộ team + thành viên từ HRM', () => {
  const P1 = '11111111-1111-4111-8111-111111111111';
  const P2 = '22222222-2222-4222-8222-222222222222';
  const TEAM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const TEAM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const emp = (id: string, o: Partial<HrmEmployee> = {}): HrmEmployee => ({
    id, email: `${id}@hrm.vn`, fullName: id, displayName: null, employeeCode: null, employeeIdentifier: null,
    jobTitle: 'Video Editor', avatarUrl: null, teams: [{ name: 'Editor' }], projects: [{ id: P1 }], ...o,
  });
  const user = (id: string, o: Partial<SyncUser> = {}): SyncUser => ({
    id, email: `${id}@agv.vn`, full_name: id, employee_id: null, hrm_employee_id: null,
    is_active: true, deleted: false, editor_approved: true, ...o,
  });
  const team = (id: string, o: Partial<SyncTeam> = {}): SyncTeam => ({
    id, name: id, is_active: true, hrm_project_id: null, leader_id: null, members: [], ...o,
  });
  const input = (o: Partial<HrmSyncInput>): HrmSyncInput => ({
    projects: [{ id: P1, name: 'ĐVKD 1 - Hồng Ngọc', status: 'ACTIVE' }],
    employees: [], teams: [], users: [], choices: {}, accountLinks: {}, suggestUnlinked: true, ...o,
  });

  it('nhận Content/Editor theo team HRM hoặc chức danh, bỏ sale/kho', () => {
    expect(hrmMemberKind({ jobTitle: 'SALE online', teams: [{ name: 'Content' }] })).toBe('CONTENT');
    expect(hrmMemberKind({ jobTitle: 'Content', teams: [{ name: 'Editor' }] })).toBe('CONTENT');
    expect(hrmMemberKind({ jobTitle: 'Media', teams: [{ name: 'Nghiên Cứu Và Phát Triển Sản Phẩm' }] })).toBe('EDITOR');
    expect(hrmMemberKind({ jobTitle: null, teams: [{ name: 'Editor' }] })).toBe('EDITOR');
    expect(hrmMemberKind({ jobTitle: 'SALE online', teams: [{ name: 'SALE ONLINE' }] })).toBeNull();
    expect(hrmMemberKind({ jobTitle: 'Logistic-Kho', teams: [] })).toBeNull();
  });

  it('team đã gắn: đổi tên theo dự án, thêm/bớt thành viên, giữ leader, cập nhật cờ content creator', () => {
    const plan = buildHrmSyncPlan(input({
      employees: [
        emp('e-keep', { email: 'keep@agv.vn', jobTitle: 'Content', teams: [{ name: 'Content' }] }),
        emp('e-add', { email: 'add@agv.vn' }),
        emp('e-sale', { email: 'sale@agv.vn', jobTitle: 'SALE online', teams: [{ name: 'SALE ONLINE' }] }),
      ],
      users: [
        user('u-keep', { email: 'keep@agv.vn' }), user('u-add', { email: 'add@agv.vn' }),
        user('u-sale', { email: 'sale@agv.vn' }), user('u-gone'), user('u-leader'),
      ],
      teams: [team(TEAM_A, {
        name: 'Team K3', hrm_project_id: P1, leader_id: 'u-leader',
        members: ['u-keep', 'u-sale', 'u-gone', 'u-leader'].map((user_id) => ({ user_id, is_content_creator: false })),
      })],
    }));

    const [p] = plan.projects;
    expect(p).toMatchObject({ status: 'LINKED', team_id: TEAM_A, rename: true, rename_conflict: false });
    expect(p.add.map((m) => m.user_id)).toEqual(['u-add']);
    expect(p.keep.map((m) => [m.user_id, m.kind])).toEqual([['u-keep', 'CONTENT']]);
    expect(p.remove.map((m) => m.user_id).sort()).toEqual(['u-gone', 'u-sale']);
    expect(p.flag_updates).toEqual([{ user_id: 'u-keep', is_content_creator: true }]);
    expect(plan.user_links).toEqual(expect.arrayContaining([
      { user_id: 'u-keep', hrm_employee_id: 'e-keep' }, { user_id: 'u-add', hrm_employee_id: 'e-add' },
    ]));
  });

  it('khớp tài khoản theo id HRM → email → mã NV → họ tên trùng duy nhất; tên trùng 2 người bên HRM thì tạo mới', () => {
    const plan = buildHrmSyncPlan(input({
      employees: [
        emp('e-1', { email: 'moi@hrm.vn' }),
        emp('e-2', { email: 'x@hrm.vn', employeeCode: 'A583' }),
        emp('e-3', { email: 'y@hrm.vn', fullName: 'NGUYỄN TRUNG VŨ' }),
        emp('e-4', { email: 'z@hrm.vn', fullName: 'Nguyễn Thùy Linh' }),
        emp('e-5', { email: 'w@hrm.vn', fullName: 'NGUYỄN THUỲ LINH', projects: [] }),
      ],
      users: [
        user('u-1', { hrm_employee_id: 'e-1' }),
        user('u-2', { employee_id: 'a583' }),
        user('u-3', { full_name: 'Nguyễn Trung Vũ' }),
        user('u-4', { full_name: 'Nguyễn Thùy Linh' }),
      ],
      teams: [team(TEAM_A, { hrm_project_id: P1 })],
    }));

    expect(plan.projects[0].add.map((m) => m.user_id ?? m.email).sort()).toEqual(['u-1', 'u-2', 'u-3', 'z@hrm.vn']);
    expect(plan.accounts_to_create).toEqual([expect.objectContaining({
      email: 'z@hrm.vn', hrm_employee_id: 'e-4', kind: 'EDITOR',
      possible_matches: [{ user_id: 'u-4', full_name: 'Nguyễn Thùy Linh', email: 'u-4@agv.vn' }],
    })]);
  });

  it('chọn dùng tài khoản có sẵn thay vì tạo mới thì gắn id HRM vào tài khoản đó', () => {
    const plan = buildHrmSyncPlan(input({
      employees: [emp('e-1', { email: 'buituandung647@gmail.com', fullName: 'Bùi Tuấn Dũng' })],
      users: [user('u-old', { full_name: 'Tuấn Dũng', editor_approved: false })],
      teams: [team(TEAM_A, { hrm_project_id: P1, members: [{ user_id: 'u-old', is_content_creator: false }] })],
      accountLinks: { 'e-1': 'u-old' },
    }));

    expect(plan.accounts_to_create).toEqual([]);
    expect(plan.projects[0].keep.map((m) => m.user_id)).toEqual(['u-old']);
    expect(plan.user_links).toEqual([{ user_id: 'u-old', hrm_employee_id: 'e-1' }]);
    expect(plan.editor_approvals).toEqual(['u-old']);
  });

  it('tài khoản mới: tên viết hoa đổi về dạng thường; email đã bị xoá ở AGV hoặc HRM thiếu email thì bỏ qua', () => {
    const plan = buildHrmSyncPlan(input({
      employees: [
        emp('e-1', { email: 'Moi@Gmail.com', fullName: 'BÙI ANH TÚ' }),
        emp('e-2', { email: 'xoa@gmail.com' }),
        emp('e-3', { email: null }),
      ],
      users: [user('u-del', { email: 'xoa@gmail.com', deleted: true })],
      teams: [team(TEAM_A, { hrm_project_id: P1 })],
    }));

    expect(plan.accounts_to_create.map((a) => [a.email, a.full_name])).toEqual([['moi@gmail.com', 'Bùi Anh Tú']]);
    expect(plan.skipped.map((s) => [s.hrm_employee_id, s.reason])).toEqual([
      ['e-2', 'Tài khoản dùng email này đã bị xoá ở AGV'],
      ['e-3', 'HRM chưa có email'],
    ]);
  });

  it('dự án chưa gắn: gợi ý team có ≥2 thành viên trùng, hoà nhau thì tạo team mới; cron (không gợi ý) thì bỏ qua', () => {
    const projects = [
      { id: P1, name: 'ĐVKD 1 - Hồng Ngọc', status: 'ACTIVE' },
      { id: P2, name: 'Tây Ban Nha', status: 'ACTIVE' },
    ];
    const employees = [
      emp('e-1', { email: 'u-1@agv.vn' }), emp('e-2', { email: 'u-2@agv.vn' }),
      emp('e-3', { email: 'u-3@agv.vn', projects: [{ id: P2 }] }), emp('e-4', { email: 'u-4@agv.vn', projects: [{ id: P2 }] }),
    ];
    const users = ['u-1', 'u-2', 'u-3', 'u-4'].map((id) => user(id));
    const teams = [
      team(TEAM_A, { name: 'Team K3', members: [{ user_id: 'u-1', is_content_creator: false }, { user_id: 'u-2', is_content_creator: false }, { user_id: 'u-3', is_content_creator: false }] }),
      team(TEAM_B, { name: 'Global Thái Lan', members: [{ user_id: 'u-4', is_content_creator: false }] }),
    ];

    const preview = buildHrmSyncPlan(input({ projects, employees, users, teams }));
    expect(preview.projects.map((p) => [p.project_name, p.status, p.team_id])).toEqual([
      ['ĐVKD 1 - Hồng Ngọc', 'SUGGESTED', TEAM_A],
      ['Tây Ban Nha', 'NEW', null],
    ]);

    const cron = buildHrmSyncPlan(input({ projects, employees, users, teams, suggestUnlinked: false }));
    expect(cron.projects.every((p) => p.status === 'SKIP' && !p.add.length && !p.remove.length)).toBe(true);
    expect(cron.accounts_to_create).toEqual([]);
  });

  it('báo lỗi khi chọn team đã gắn dự án khác hoặc tạo mới trùng tên team có sẵn', () => {
    const plan = buildHrmSyncPlan(input({
      projects: [
        { id: P1, name: 'ĐVKD 1 - Hồng Ngọc', status: 'ACTIVE' },
        { id: P2, name: 'Tây Ban Nha', status: 'ACTIVE' },
      ],
      teams: [team(TEAM_A, { hrm_project_id: P1 }), team(TEAM_B, { name: 'Tây Ban Nha' })],
      choices: { [P2]: TEAM_A },
      suggestUnlinked: false,
    }));
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]).toContain('đã gắn với dự án khác');

    const dup = buildHrmSyncPlan(input({
      projects: [{ id: P2, name: 'Tây Ban Nha', status: 'ACTIVE' }],
      teams: [team(TEAM_B, { name: 'Tây Ban Nha', hrm_project_id: P1 })],
      choices: { [P2]: 'NEW' },
      suggestUnlinked: false,
    }));
    expect(dup.errors[0]).toContain('Đã có team tên "Tây Ban Nha"');
  });

  it('apply: tạo tài khoản + team mới, gỡ/thêm thành viên, duyệt editor trong 1 transaction', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      const body = String(url).includes('/projects')
        ? { data: [{ id: P1, name: 'ĐVKD 1 - Hồng Ngọc', status: 'ACTIVE' }, { id: P2, name: 'Tây Ban Nha', status: 'ACTIVE' }] }
        : { data: [emp('e-new', { email: 'new@gmail.com' }), emp('e-2', { email: 'u-2@agv.vn', projects: [{ id: P2 }] })], total: 2 };
      return { ok: true, status: 200, json: async () => body } as any;
    });
    const tx: any = {
      user: { createMany: jest.fn(async () => ({ count: 1 })) },
      team: {
        create: jest.fn(async () => ({ id: TEAM_B })),
        update: jest.fn(async () => ({ leader_id: null })),
        findUnique: jest.fn(async () => ({ leader_id: null })),
      },
      teamMember: {
        deleteMany: jest.fn(), createMany: jest.fn(), updateMany: jest.fn(),
        findMany: jest.fn(async () => [{ user_id: 'u-leader' }]),
      },
      editorApproval: { findMany: jest.fn(async () => []), updateMany: jest.fn(), createMany: jest.fn() },
      $executeRaw: jest.fn(),
    };
    const prisma: any = {
      team: { findMany: jest.fn(async () => [team(TEAM_A, { name: 'Team K3', hrm_project_id: P1, members: [{ user_id: 'u-gone', is_content_creator: false }] })]) },
      user: {
        findMany: jest.fn(async () => [
          { ...user('u-2', { email: 'u-2@agv.vn' }), deleted_at: null, editor_approvals: [{ id: 'x' }] },
          { ...user('u-gone'), deleted_at: null, editor_approvals: [] },
        ].map(({ deleted, editor_approved, ...u }) => u)),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const config: any = { get: (k: string) => ({ VCB_HRM_BASE_URL: 'http://hrm/', VCB_HRM_API_KEY: 'tmk_x' } as any)[k] };
    const service = new HrmTeamSyncService(prisma, config);

    const result = await service.apply({ [P2]: 'NEW' }, {}, 'admin-1');

    expect(fetchMock).toHaveBeenCalledWith('http://hrm/public/v1/projects?status=ACTIVE', expect.objectContaining({ headers: { 'X-API-Key': 'tmk_x' } }));
    const newUserId = tx.user.createMany.mock.calls[0][0].data[0].id;
    expect(tx.user.createMany.mock.calls[0][0].data[0]).toMatchObject({ email: 'new@gmail.com', roles: ['MEMBER'], hrm_employee_id: 'e-new' });
    expect(tx.team.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: TEAM_A }, data: { name: 'ĐVKD 1 - Hồng Ngọc' } }));
    expect(tx.team.create).toHaveBeenCalledWith({ data: { name: 'Tây Ban Nha', hrm_project_id: P2 } });
    expect(tx.teamMember.deleteMany).toHaveBeenCalledWith({ where: { team_id: TEAM_A, user_id: { in: ['u-gone'] } } });
    expect(tx.teamMember.createMany).toHaveBeenCalledWith({ data: [{ team_id: TEAM_A, user_id: newUserId, is_content_creator: false }], skipDuplicates: true });
    expect(tx.teamMember.createMany).toHaveBeenCalledWith({ data: [{ team_id: TEAM_B, user_id: 'u-2', is_content_creator: false }], skipDuplicates: true });
    expect(tx.editorApproval.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ user_id: newUserId, status: 'APPROVED', approved_by_id: 'admin-1' })] });
    expect(result).toMatchObject({ teams_created: 1, teams_renamed: 1, members_added: 2, members_removed: 1, accounts_created: 1, editors_approved: 1 });
    expect(jest.mocked(recomputeUserTeamFieldsBatch).mock.calls.at(-1)![1]).toEqual(
      expect.arrayContaining(['u-leader', 'u-gone', 'u-2', newUserId]),
    );
    fetchMock.mockRestore();
  });
});
