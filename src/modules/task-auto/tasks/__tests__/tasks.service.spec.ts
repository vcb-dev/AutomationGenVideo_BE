import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TaskAutoTasksService } from '../tasks.service';
import { ContentApprovalService } from '../content-approval.service';

/**
 * Gói test cho TaskAutoTasksService — phần create()/update()/remove()/submit()/review()/
 * getHeaderCounts(). getDashboard() (khối lớn, độc lập) nằm ở tasks-dashboard.spec.ts.
 * ContentApprovalService.countPending() được test kèm ở đây vì cùng phục vụ 1 endpoint
 * (GET tasks/header-counts) và controller gộp 2 service bằng Promise.all.
 */

/**
 * create() — fallback content_line_id về bản ghi gốc (source_team_content/source_editor_content)
 * khi field thô trên chính record bị null. TeamContent/Content chỉ copy content_line_id tại thời
 * điểm push (copyEditorContentToTeam/pushTeamContentToGlobal), nên record cũ hoặc content được
 * gán tuyến SAU khi đã push vẫn có thể null dù nội dung thực sự thuộc 1 tuyến — thiếu fallback
 * này khiến task tạo thủ công từ content đó rơi khỏi "Số video theo tuyến nội dung".
 */
describe('TaskAutoTasksService.create — fallback content_line_id qua bản ghi gốc', () => {
  function build(opts: {
    content?: any;
    teamContent?: any;
  }) {
    let createArgs: any;
    const prisma: any = {
      team: { findUnique: jest.fn(async () => ({ id: 'team-1', brand_type: 'DO_DA' })) },
      content: { findUnique: jest.fn(async () => opts.content ?? null) },
      editorContent: { findUnique: jest.fn(async () => null) },
      teamContent: { findUnique: jest.fn(async () => opts.teamContent ?? null) },
      teamMember: { findFirst: jest.fn(async () => ({ team_id: 'team-1' })) },
      task: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (args: any) => {
          createArgs = args;
          return { id: 'task-1', ...args.data };
        }),
      },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { service, prisma, getCreateArgs: () => createArgs };
  }

  it('content_id: content.content_line_id có sẵn → dùng trực tiếp, không cần fallback', async () => {
    const { service, getCreateArgs } = build({
      content: { content_line_id: 'line-direct', source_team_content: null },
    });

    await service.create(
      { team_id: 'team-1', content_id: 'content-1' } as any,
      'admin-1',
      ['ADMIN'],
    );

    expect(getCreateArgs().data.content_line_id).toBe('line-direct');
  });

  it('content_id: content_line_id null, fallback 1 cấp qua source_team_content.content_line_id', async () => {
    const { service, getCreateArgs } = build({
      content: {
        content_line_id: null,
        source_team_content: { content_line_id: 'line-from-team-content', source_editor_content: null },
      },
    });

    await service.create(
      { team_id: 'team-1', content_id: 'content-1' } as any,
      'admin-1',
      ['ADMIN'],
    );

    expect(getCreateArgs().data.content_line_id).toBe('line-from-team-content');
  });

  it('content_id: cả content_line_id và source_team_content.content_line_id đều null → fallback 2 cấp qua source_editor_content', async () => {
    const { service, getCreateArgs } = build({
      content: {
        content_line_id: null,
        source_team_content: {
          content_line_id: null,
          source_editor_content: { content_line_id: 'line-from-editor-content' },
        },
      },
    });

    await service.create(
      { team_id: 'team-1', content_id: 'content-1' } as any,
      'admin-1',
      ['ADMIN'],
    );

    expect(getCreateArgs().data.content_line_id).toBe('line-from-editor-content');
  });

  it('content_id: không còn fallback nào → content_line_id null', async () => {
    const { service, getCreateArgs } = build({
      content: { content_line_id: null, source_team_content: null },
    });

    await service.create(
      { team_id: 'team-1', content_id: 'content-1' } as any,
      'admin-1',
      ['ADMIN'],
    );

    expect(getCreateArgs().data.content_line_id).toBeNull();
  });

  it('team_content_id: content_line_id null → fallback qua source_editor_content.content_line_id', async () => {
    const { service, getCreateArgs } = build({
      teamContent: {
        content_line_id: null,
        source_editor_content: { content_line_id: 'line-from-editor-content' },
      },
    });

    await service.create(
      { team_id: 'team-1', team_content_id: 'tc-1' } as any,
      'admin-1',
      ['ADMIN'],
    );

    expect(getCreateArgs().data.content_line_id).toBe('line-from-editor-content');
  });

  it('dto.content_line_id truyền tay → luôn ưu tiên, bỏ qua mọi fallback', async () => {
    const { service, getCreateArgs } = build({
      content: {
        content_line_id: null,
        source_team_content: { content_line_id: 'line-fallback', source_editor_content: null },
      },
    });

    await service.create(
      { team_id: 'team-1', content_id: 'content-1', content_line_id: 'line-explicit' } as any,
      'admin-1',
      ['ADMIN'],
    );

    expect(getCreateArgs().data.content_line_id).toBe('line-explicit');
  });
});

/**
 * create() với oms_variant_id (chọn sản phẩm trực tiếp từ kho tổng OMS, không qua Product local):
 * nếu đã biết assignee ngay lúc tạo thì materialize luôn thành 1 EditorProduct trong kho cá nhân
 * họ; nếu chưa (task PENDING) thì tạm giữ oms_product_id/oms_variant_id trên Task, materialize
 * sau ở update() khi assignee được set lần đầu (xem [[find-or-create-editor-product-from-oms]]).
 */
describe('TaskAutoTasksService.create — chọn sản phẩm từ OMS', () => {
  const sampleVariant = { id: 'var-1', sku: 'SKU-OMS-1', price: 90000, image_url: null }
  const sampleProduct = { id: 'prod-1', name: 'Vòng tay bạc', image_url: null, images: [] }

  function build(opts: { existingEditorProduct?: any; skuTaken?: any } = {}) {
    const prisma: any = {
      team: { findUnique: jest.fn(async () => ({ id: 'team-1', name: 'Team 1', brand_type: 'TRANG_SUC' })) },
      content: { findUnique: jest.fn(async () => ({ content_line_id: 'cl-1' })) },
      teamMember: { findFirst: jest.fn(async () => ({ team_id: 'team-1' })) },
      editorProduct: {
        findFirst: jest.fn(async (args: any) => {
          if (args.where.oms_variant_id !== undefined) return opts.existingEditorProduct ?? null
          if (args.where.sku !== undefined) return opts.skuTaken ?? null
          return null
        }),
        create: jest.fn(async (args: any) => ({ id: 'ep-new', ...args.data })),
      },
      task: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (args: any) => ({ id: 'task-new', ...args.data })),
      },
      notification: { create: jest.fn(async () => ({})) },
    }
    const oms: any = { getProductVariant: jest.fn(async () => ({ product: sampleProduct, variant: sampleVariant })) }
    const push: any = { sendToUser: jest.fn(async () => ({})) }
    const service = new TaskAutoTasksService(prisma, {} as any, push, {} as any, oms, {} as any)
    return { service, prisma, oms }
  }

  afterEach(() => jest.clearAllMocks())

  it('đã biết assignee ngay lúc tạo → materialize EditorProduct ngay, task trỏ editor_product_id', async () => {
    const { service, prisma, oms } = build()

    await service.create(
      { team_id: 'team-1', content_id: 'content-1', assignee_id: 'member-1', oms_product_id: 'prod-1', oms_variant_id: 'var-1' } as any,
      'leader-1',
      ['LEADER'],
    )

    expect(oms.getProductVariant).toHaveBeenCalledWith('prod-1', 'var-1')
    const createArgs = prisma.task.create.mock.calls[0][0]
    expect(createArgs.data.editor_product_id).toBe('ep-new')
    expect(createArgs.data.oms_product_id).toBeNull()
    expect(createArgs.data.oms_variant_id).toBeNull()
  })

  it('chưa có assignee (task PENDING) → KHÔNG gọi OMS, tạm giữ oms_product_id/oms_variant_id trên Task', async () => {
    const { service, prisma, oms } = build()

    await service.create(
      { team_id: 'team-1', content_id: 'content-1', oms_product_id: 'prod-1', oms_variant_id: 'var-1' } as any,
      'leader-1',
      ['LEADER'],
    )

    expect(oms.getProductVariant).not.toHaveBeenCalled()
    const createArgs = prisma.task.create.mock.calls[0][0]
    expect(createArgs.data.editor_product_id).toBeNull()
    expect(createArgs.data.oms_product_id).toBe('prod-1')
    expect(createArgs.data.oms_variant_id).toBe('var-1')
  })

  it('editor đã materialize SKU này từ OMS trước đó (upsert) → dùng lại EditorProduct cũ, không tạo trùng', async () => {
    const { service, prisma } = build({ existingEditorProduct: { id: 'ep-existing' } })

    await service.create(
      { team_id: 'team-1', content_id: 'content-1', assignee_id: 'member-1', oms_product_id: 'prod-1', oms_variant_id: 'var-1' } as any,
      'leader-1',
      ['LEADER'],
    )

    expect(prisma.editorProduct.create).not.toHaveBeenCalled()
    const createArgs = prisma.task.create.mock.calls[0][0]
    expect(createArgs.data.editor_product_id).toBe('ep-existing')
  })

  it('SKU của variant OMS trùng với 1 sản phẩm editor đã thêm thủ công (không liên kết OMS) → báo lỗi, không tạo task', async () => {
    const { service, prisma } = build({ skuTaken: { id: 'ep-manual' } })

    await expect(
      service.create(
        { team_id: 'team-1', content_id: 'content-1', assignee_id: 'member-1', oms_product_id: 'prod-1', oms_variant_id: 'var-1' } as any,
        'leader-1',
        ['LEADER'],
      ),
    ).rejects.toThrow(BadRequestException)
    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it('oms_variant_id có nhưng thiếu oms_product_id → BadRequestException ngay, không đụng DB', async () => {
    const { service, prisma } = build()

    await expect(
      service.create(
        { team_id: 'team-1', content_id: 'content-1', oms_variant_id: 'var-1' } as any,
        'leader-1',
        ['LEADER'],
      ),
    ).rejects.toThrow(BadRequestException)
    expect(prisma.team.findUnique).not.toHaveBeenCalled()
  })
})

/**
 * create()/update() ghi cột `assigned_by_id` (migration 20260819_add_task_assigned_by) — luôn set
 * bằng ID của người vừa thực hiện thao tác (creatorId ở create, userId/actor ở update), không phải
 * bằng assignee_id được truyền vào. Nhờ vậy remove() (xem describe "remove — xoá task ở mọi trạng
 * thái" bên dưới) so sánh assigned_by_id với assignee_id để phân biệt "tự nhận" (bằng nhau) với
 * "được người khác giao" (khác nhau — leader/admin/manager giao tay cho người khác).
 */
describe('TaskAutoTasksService — ghi nhận assigned_by_id ở create()/update()', () => {
  function buildService(opts: {
    task?: any;
    teamMember?: any;
  } = {}) {
    const prisma: any = {
      team: { findUnique: jest.fn(async () => ({ id: 'team-1', name: 'Team 1' })) },
      content: { findUnique: jest.fn(async () => ({ content_line_id: 'cl-1' })) },
      teamMember: {
        findFirst: jest.fn(async () =>
          opts.teamMember === undefined ? { team_id: 'team-1' } : opts.teamMember,
        ),
      },
      task: {
        findUnique: jest.fn(async () => opts.task),
        create: jest.fn(async (args: any) => ({ id: 'task-new', ...args.data })),
        update: jest.fn(async (args: any) => ({
          id: 'task-1',
          ...args.data,
          team: { leader_id: 'leader-1' },
        })),
      },
      notification: { create: jest.fn(async () => ({})) },
    };
    const push: any = { sendToUser: jest.fn(async () => ({})) };
    const service = new TaskAutoTasksService(prisma, {} as any, push, {} as any, {} as any, {} as any);
    return { service, prisma };
  }

  describe('create()', () => {
    it('LEADER tạo task và giao tay cho member khác → assigned_by_id = leader (creatorId), khác assignee_id', async () => {
      const { service, prisma } = buildService();

      await service.create(
        { team_id: 'team-1', content_id: 'content-1', assignee_id: 'member-2' } as any,
        'leader-1',
        ['LEADER'],
      );

      const createArgs = prisma.task.create.mock.calls[0][0];
      expect(createArgs.data.assignee_id).toBe('member-2');
      expect(createArgs.data.assigned_by_id).toBe('leader-1');
    });

    it('Member thường tự tạo task cho chính mình (self-claim) → assigned_by_id === assignee_id', async () => {
      const { service, prisma } = buildService();

      await service.create(
        { team_id: 'team-1', content_id: 'content-1' } as any,
        'member-1',
        ['MEMBER'],
      );

      const createArgs = prisma.task.create.mock.calls[0][0];
      expect(createArgs.data.assignee_id).toBe('member-1');
      expect(createArgs.data.assigned_by_id).toBe('member-1');
    });

    it('LEADER tạo task chưa giao ai (PENDING) → assigned_by_id không được set', async () => {
      const { service, prisma } = buildService();

      await service.create(
        { team_id: 'team-1', content_id: 'content-1' } as any,
        'leader-1',
        ['LEADER'],
      );

      const createArgs = prisma.task.create.mock.calls[0][0];
      expect(createArgs.data.assignee_id).toBeUndefined();
      expect(createArgs.data.assigned_by_id).toBeUndefined();
    });
  });

  describe('update()', () => {
    it('LEADER reassign task đang có người khác nhận sang member khác → assigned_by_id = leader (actor), khác assignee_id mới', async () => {
      const { service, prisma } = buildService({
        task: { task_type: 'MANUAL', assignee_id: 'member-1', status: 'ASSIGNED', team_id: 'team-1' },
      });

      await service.update('task-1', { assignee_id: 'member-2' } as any, 'leader-1', ['LEADER']);

      const updateArgs = prisma.task.update.mock.calls[0][0];
      expect(updateArgs.data.assignee_id).toBe('member-2');
      expect(updateArgs.data.assigned_by_id).toBe('leader-1');
    });

    it('Member tự nhận task đang PENDING (chưa ai nhận) → assigned_by_id === assignee_id (chính actor)', async () => {
      const { service, prisma } = buildService({
        task: { task_type: 'MANUAL', assignee_id: null, status: 'PENDING', team_id: 'team-1' },
        teamMember: { team_id: 'team-1' },
      });

      await service.update('task-1', { assignee_id: 'member-1' } as any, 'member-1', ['MEMBER']);

      const updateArgs = prisma.task.update.mock.calls[0][0];
      expect(updateArgs.data.assignee_id).toBe('member-1');
      expect(updateArgs.data.assigned_by_id).toBe('member-1');
    });

    it('LEADER bỏ giao task (assignee_id = null) → assigned_by_id bị xoá theo (null)', async () => {
      const { service, prisma } = buildService({
        task: { task_type: 'MANUAL', assignee_id: 'member-1', status: 'ASSIGNED', team_id: 'team-1' },
      });

      await service.update('task-1', { assignee_id: null } as any, 'leader-1', ['LEADER']);

      const updateArgs = prisma.task.update.mock.calls[0][0];
      expect(updateArgs.data.assignee_id).toBeNull();
      expect(updateArgs.data.assigned_by_id).toBeNull();
    });

    it('Update không đụng tới assignee_id (vd chỉ đổi deadline) → không ghi đè assigned_by_id đang có', async () => {
      const { service, prisma } = buildService({
        task: { task_type: 'MANUAL', assignee_id: 'member-1', status: 'ASSIGNED', team_id: 'team-1' },
      });

      await service.update('task-1', { deadline: '2026-09-01' } as any, 'leader-1', ['LEADER']);

      const updateArgs = prisma.task.update.mock.calls[0][0];
      expect('assigned_by_id' in updateArgs.data).toBe(false);
    });
  });
});

/**
 * remove() (xoá task) — trước đây chặn xoá task IN_PROGRESS. Giờ được xoá ở mọi trạng thái, kể cả
 * IN_PROGRESS. Luật phân quyền: ADMIN/MANAGER xoá được mọi task; LEADER xoá được task của team mình
 * quản lý; thành viên thường (không có role đặc quyền) chỉ xoá được task do chính mình đảm nhận
 * (assignee_id === requesterId) VÀ task đó do chính mình tự nhận — không phải được leader giao tay
 * (assigned_by_id khác assignee_id) hoặc hệ thống tự động chia (run_id != null).
 */
describe('TaskAutoTasksService.remove — xoá task ở mọi trạng thái, theo đúng phân quyền', () => {
  function build(opts: { task?: any; team?: any } = {}) {
    const deleteCalls: any[] = [];
    const prisma: any = {
      task: {
        findUnique: jest.fn(async () =>
          opts.task === undefined
            ? { status: 'APPROVED', team_id: 'team-1', assignee_id: 'member-1' }
            : opts.task,
        ),
        delete: jest.fn(async (args: any) => {
          deleteCalls.push(args);
          return { id: args.where.id };
        }),
      },
      team: {
        findUnique: jest.fn(async () =>
          opts.team === undefined ? { leader_id: 'leader-1' } : opts.team,
        ),
      },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { service, prisma, deleteCalls };
  }

  it('task APPROVED, LEADER quản lý team → cho phép xoá', async () => {
    const { service, prisma, deleteCalls } = build({
      task: { status: 'APPROVED', team_id: 'team-1', assignee_id: 'member-1' },
    });

    const result = await service.remove('task-1', 'leader-1', ['LEADER']);

    expect(result).toEqual({ success: true });
    expect(deleteCalls).toEqual([{ where: { id: 'task-1' } }]);
    expect(prisma.task.delete).toHaveBeenCalledTimes(1);
  });

  it('task IN_PROGRESS → nay cho phép xoá', async () => {
    const { service, prisma } = build({
      task: { status: 'IN_PROGRESS', team_id: 'team-1', assignee_id: 'member-1' },
    });

    const result = await service.remove('task-1', 'leader-1', ['LEADER']);

    expect(result).toEqual({ success: true });
    expect(prisma.task.delete).toHaveBeenCalledTimes(1);
  });

  it('task không tồn tại → NotFoundException', async () => {
    const { service } = build({ task: null });

    await expect(service.remove('task-x', 'leader-1', ['LEADER'])).rejects.toThrow(
      NotFoundException,
    );
  });

  it('LEADER không quản lý team của task, không phải assignee → ForbiddenException, không xoá', async () => {
    const { service, prisma } = build({
      task: { status: 'APPROVED', team_id: 'team-1', assignee_id: 'member-1' },
      team: { leader_id: 'leader-other' },
    });

    await expect(service.remove('task-1', 'leader-1', ['LEADER'])).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.task.delete).not.toHaveBeenCalled();
  });

  it('ADMIN xoá được task IN_PROGRESS của bất kỳ team nào, không cần kiểm tra leader_id', async () => {
    const { service, prisma } = build({
      task: { status: 'IN_PROGRESS', team_id: 'team-1', assignee_id: 'member-1' },
    });

    const result = await service.remove('task-1', 'admin-1', ['ADMIN']);

    expect(result).toEqual({ success: true });
    expect(prisma.team.findUnique).not.toHaveBeenCalled();
  });

  it('Thành viên thường tự xoá task của chính mình (assignee) → cho phép, kể cả IN_PROGRESS', async () => {
    const { service, prisma } = build({
      task: { status: 'IN_PROGRESS', team_id: 'team-1', assignee_id: 'member-1' },
    });

    const result = await service.remove('task-1', 'member-1', ['MEMBER']);

    expect(result).toEqual({ success: true });
    expect(prisma.team.findUnique).not.toHaveBeenCalled();
    expect(prisma.task.delete).toHaveBeenCalledTimes(1);
  });

  it('Thành viên thường xoá task KHÔNG phải của mình → ForbiddenException', async () => {
    const { service, prisma } = build({
      task: { status: 'PENDING', team_id: 'team-1', assignee_id: 'other-member' },
    });

    await expect(service.remove('task-1', 'member-1', ['MEMBER'])).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.task.delete).not.toHaveBeenCalled();
  });

  it('Thành viên thường xoá task của mình nhưng được hệ thống tự động chia (run_id != null) → ForbiddenException', async () => {
    const { service, prisma } = build({
      task: { status: 'ASSIGNED', team_id: 'team-1', assignee_id: 'member-1', run_id: 'run-1' },
    });

    await expect(service.remove('task-1', 'member-1', ['MEMBER'])).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.task.delete).not.toHaveBeenCalled();
  });

  it('Thành viên thường xoá task của mình nhưng được leader giao tay (assigned_by_id khác assignee_id) → ForbiddenException', async () => {
    const { service, prisma } = build({
      task: {
        status: 'ASSIGNED',
        team_id: 'team-1',
        assignee_id: 'member-1',
        assigned_by_id: 'leader-1',
      },
    });

    await expect(service.remove('task-1', 'member-1', ['MEMBER'])).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.task.delete).not.toHaveBeenCalled();
  });

  it('Thành viên thường tự nhận task (assigned_by_id === assignee_id) → vẫn cho phép xoá', async () => {
    const { service, prisma } = build({
      task: {
        status: 'ASSIGNED',
        team_id: 'team-1',
        assignee_id: 'member-1',
        assigned_by_id: 'member-1',
      },
    });

    const result = await service.remove('task-1', 'member-1', ['MEMBER']);

    expect(result).toEqual({ success: true });
    expect(prisma.task.delete).toHaveBeenCalledTimes(1);
  });

  it('LEADER quản lý team → vẫn xoá được task tự động chia/leader giao trong team mình', async () => {
    const { service, prisma } = build({
      task: {
        status: 'ASSIGNED',
        team_id: 'team-1',
        assignee_id: 'member-1',
        run_id: 'run-1',
      },
    });

    const result = await service.remove('task-1', 'leader-1', ['LEADER']);

    expect(result).toEqual({ success: true });
    expect(prisma.task.delete).toHaveBeenCalledTimes(1);
  });
});

/**
 * GET tasks/header-counts — gộp 3 lượt đếm (header "N task" + 2 badge "Video chờ duyệt"/"Content
 * chờ duyệt") vốn phải gọi 3 request limit:1 riêng thành 1 request duy nhất. TasksService.
 * getHeaderCounts() trả total/submittedTotal; ContentApprovalService.countPending() trả riêng số
 * content chờ duyệt (khác bảng nên tách service) — controller gộp cả 2 bằng Promise.all.
 */
describe('TaskAutoTasksService.getHeaderCounts', () => {
  function build() {
    const countCalls: any[] = [];
    const prisma: any = {
      task: {
        count: jest.fn(async (args: any) => {
          countCalls.push(args);
          return 0;
        }),
      },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { service, countCalls };
  }

  it('không truyền gì → total đếm toàn bộ, submittedTotal luôn khoá status SUBMITTED', async () => {
    const { service, countCalls } = build();

    await service.getHeaderCounts({} as any);

    expect(countCalls[0].where).toEqual({});
    expect(countCalls[1].where).toEqual({ status: 'SUBMITTED' });
  });

  it('team_id/assignee_id/search/task_type áp dụng cho cả 2 lượt đếm', async () => {
    const { service, countCalls } = build();

    await service.getHeaderCounts({
      team_id: 'team-1',
      assignee_id: 'user-1',
      search: 'abc',
      task_type: 'extra',
    } as any);

    expect(countCalls[0].where).toMatchObject({
      team_id: 'team-1',
      assignee_id: 'user-1',
      task_type: 'EXTRA',
      content: { title: { contains: 'abc', mode: 'insensitive' } },
    });
    expect(countCalls[1].where).toMatchObject({
      status: 'SUBMITTED',
      team_id: 'team-1',
      assignee_id: 'user-1',
      content: { title: { contains: 'abc', mode: 'insensitive' } },
    });
  });

  it('deadline_from/to chỉ áp dụng cho total, KHÔNG áp dụng cho submittedTotal', async () => {
    const { service, countCalls } = build();

    await service.getHeaderCounts({
      deadline_from: '2026-08-01',
      deadline_to: '2026-08-31',
    } as any);

    expect(countCalls[0].where.AND).toBeDefined();
    expect(countCalls[1].where).toEqual({ status: 'SUBMITTED' });
  });

  it('pending_from/to chỉ áp dụng cho submittedTotal, KHÔNG áp dụng cho total', async () => {
    const { service, countCalls } = build();

    await service.getHeaderCounts({
      pending_from: '2026-08-10',
      pending_to: '2026-08-20',
    } as any);

    expect(countCalls[0].where).toEqual({});
    expect(countCalls[1].where.AND).toBeDefined();
    expect(countCalls[1].where.status).toBe('SUBMITTED');
  });

  it('status truyền tay chỉ áp dụng cho total (submittedTotal luôn cố định SUBMITTED)', async () => {
    const { service, countCalls } = build();

    await service.getHeaderCounts({ status: 'APPROVED' } as any);

    expect(countCalls[0].where.status).toBe('APPROVED');
    expect(countCalls[1].where.status).toBe('SUBMITTED');
  });
});

describe('ContentApprovalService.countPending', () => {
  function build() {
    const countCalls: any[] = [];
    const prisma: any = {
      taskContentApproval: {
        count: jest.fn(async (args: any) => {
          countCalls.push(args);
          return 0;
        }),
      },
    };
    const service = new ContentApprovalService(prisma, {} as any);
    return { service, countCalls };
  }

  it('luôn khoá status PENDING, không truyền filter khác → where chỉ có status', async () => {
    const { service, countCalls } = build();

    await service.countPending({});

    expect(countCalls[0].where).toEqual({ status: 'PENDING' });
  });

  it('team_id/assignee_id/search lọc qua quan hệ task', async () => {
    const { service, countCalls } = build();

    await service.countPending({ team_id: 'team-1', assignee_id: 'user-1', search: 'abc' });

    expect(countCalls[0].where).toEqual({
      status: 'PENDING',
      task: {
        team_id: 'team-1',
        assignee_id: 'user-1',
        content: { title: { contains: 'abc', mode: 'insensitive' } },
      },
    });
  });
});

// Thiếu cả task.result_url (Drive) lẫn dto.result_url (link tay) → BadRequestException, không đụng DB.
describe('TaskAutoTasksService.submit — bắt buộc có video trước khi nộp', () => {
  function build(task: any) {
    const prisma: any = {
      task: {
        findUnique: jest.fn(async () => task),
        update: jest.fn(async () => ({ team: { leader_id: null } })),
      },
    };
    const service = new TaskAutoTasksService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, prisma };
  }

  it('không có task.result_url và dto.result_url trống → BadRequestException, không update', async () => {
    const { service, prisma } = build({
      assignee_id: 'user-1',
      status: 'ASSIGNED',
      result_url: null,
    });

    await expect(service.submit('task-1', {}, 'user-1')).rejects.toThrow(BadRequestException);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('nhập link video tay (dto.result_url) → cho nộp, update status SUBMITTED', async () => {
    const { service, prisma } = build({
      assignee_id: 'user-1',
      status: 'IN_PROGRESS',
      result_url: null,
    });

    await service.submit('task-1', { result_url: 'https://youtu.be/abc' }, 'user-1');

    expect(prisma.task.update).toHaveBeenCalledTimes(1);
    expect(prisma.task.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ status: 'SUBMITTED', result_url: 'https://youtu.be/abc' }),
    );
  });

  it('đã có video trên Drive (task.result_url) dù dto trống → vẫn cho nộp', async () => {
    const { service, prisma } = build({
      assignee_id: 'user-1',
      status: 'ASSIGNED',
      result_url: 'https://drive.google.com/file/d/xyz',
    });

    await service.submit('task-1', {}, 'user-1');

    expect(prisma.task.update).toHaveBeenCalledTimes(1);
  });
});

// REJECTED: result_url = null + huỷ SocialPost PENDING. APPROVED: không đụng cả hai.
describe('TaskAutoTasksService.review — dọn dẹp khi từ chối task', () => {
  function build() {
    const videoService: any = {
      uploadPendingToDrive: jest.fn(async () => undefined),
      deletePendingVideo: jest.fn(async () => undefined),
    };
    const prisma: any = {
      task: {
        findUnique: jest.fn(async () => ({ status: 'SUBMITTED', assignee_id: null })),
        update: jest.fn(async (args: any) => ({ id: 'task-1', ...args.data })),
      },
      socialPost: {
        updateMany: jest.fn(async () => ({ count: 2 })),
      },
    };
    const service = new TaskAutoTasksService(
      prisma,
      videoService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, prisma, videoService };
  }

  it('REJECTED → result_url = null + huỷ SocialPost PENDING của task', async () => {
    const { service, prisma } = build();

    await service.review('task-1', { action: 'REJECTED', reject_reason: 'mờ' }, 'reviewer-1');

    expect(prisma.task.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ status: 'REJECTED', result_url: null }),
    );
    expect(prisma.socialPost.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.socialPost.updateMany.mock.calls[0][0]).toEqual({
      where: { task_id: 'task-1', status: 'PENDING' },
      data: { status: 'CANCELLED', updated_at: expect.any(Date) },
    });
  });

  it('APPROVED → không đụng result_url, không huỷ SocialPost', async () => {
    const { service, prisma, videoService } = build();

    await service.review('task-1', { action: 'APPROVED' }, 'reviewer-1');

    expect(prisma.task.update.mock.calls[0][0].data).not.toHaveProperty('result_url');
    expect(prisma.socialPost.updateMany).not.toHaveBeenCalled();
    expect(videoService.uploadPendingToDrive).toHaveBeenCalledTimes(1);
  });
});
