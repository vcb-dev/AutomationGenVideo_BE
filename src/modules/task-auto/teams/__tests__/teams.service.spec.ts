import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TaskAutoTeamsService } from '../teams.service';

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
