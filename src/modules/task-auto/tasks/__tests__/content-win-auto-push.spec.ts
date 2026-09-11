import { TaskAutoContentWinPushService } from '../content-win-auto-push.service';

// Luồng "content win → tự đẩy về kho tổng": task APPROVED có link >10.000 view thì thêm vào ContentWarehouse + gắn nhãn "Win".

function fbLink(views: number, status: 'success' | 'failed' | 'unsupported' = 'success', url = 'https://facebook.com/reel/1') {
  return [{ id: 'l1', platform: 'FACEBOOK', url, stats: { views, status } }];
}

function winTask(id: string, over: Partial<Record<string, any>> = {}) {
  return {
    id,
    assignee_id: 'assignee-1',
    reviewed_by_id: 'reviewer-1',
    brand_type: 'TRANG_SUC',
    content_id: null,
    team_content_id: null,
    editor_content_id: null,
    content_line_id: 'cl-A4',
    published_links: fbLink(12000),
    team: { market: 'VIETNAM', brand_type: 'TRANG_SUC' },
    content_line: { name: 'A4' },
    ...over,
  };
}

function build(opts: {
  tasks?: any[];
  classificationId?: string | null; // undefined → 'cls-win' (đã có); null → chưa có, phải tạo
  contentBySourceTeam?: Record<string, { id: string }>;
  contentBySourceEditor?: Record<string, { id: string }>;
  contentByWinUrl?: Record<string, { id: string }>;
  contentById?: Record<string, { classification_id: string | null; won_at: Date | null }>;
  teamContentById?: Record<string, any>;
  editorContentById?: Record<string, any>;
  contentUpdateImpl?: jest.Mock;
} = {}) {
  const clsResolved =
    opts.classificationId === undefined
      ? { id: 'cls-win' }
      : opts.classificationId === null
        ? null
        : { id: opts.classificationId };

  const created: Array<{ id: string; data: any }> = [];
  const prisma: any = {
    task: {
      findMany: jest.fn(async () => opts.tasks ?? []),
      update: jest.fn(async (a: any) => a),
    },
    content: {
      findUnique: jest.fn(async (a: any) => {
        if (a.where.source_team_content_id) return opts.contentBySourceTeam?.[a.where.source_team_content_id] ?? null;
        if (a.where.source_editor_content_id) return opts.contentBySourceEditor?.[a.where.source_editor_content_id] ?? null;
        if (a.where.id) return opts.contentById?.[a.where.id] ?? { classification_id: null, won_at: null };
        return null;
      }),
      findFirst: jest.fn(async (a: any) => opts.contentByWinUrl?.[a.where.win_video_url] ?? null),
      create: jest.fn(async (a: any) => {
        const id = `content-new-${created.length + 1}`;
        created.push({ id, data: a.data });
        return { id };
      }),
      update: opts.contentUpdateImpl ?? jest.fn(async (a: any) => a),
    },
    teamContent: { findUnique: jest.fn(async (a: any) => opts.teamContentById?.[a.where.id] ?? null) },
    editorContent: { findUnique: jest.fn(async (a: any) => opts.editorContentById?.[a.where.id] ?? null) },
    contentClassification: {
      findUnique: jest.fn(async () => clsResolved),
      create: jest.fn(async () => ({ id: 'cls-win-created' })),
    },
    contentWarehouse: { upsert: jest.fn(async (a: any) => a) },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };
  const service = new TaskAutoContentWinPushService(prisma);
  return { service, prisma, created };
}

describe('TaskAutoContentWinPushService.pushWinningTasks', () => {
  afterEach(() => jest.clearAllMocks());

  it('chỉ lấy task APPROVED + chưa từng đẩy, dedupe id đầu vào', async () => {
    const { service, prisma } = build({ tasks: [] });

    const res = await service.pushWinningTasks(['t1', 't1', 't1', '']);

    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['t1'] },
          status: 'APPROVED',
          content_win_pushed_at: null,
        }),
      }),
    );
    expect(res).toEqual({ pushed: 0, skipped: 1, failed: 0 });
  });

  it('mảng rỗng → không chạm DB', async () => {
    const { service, prisma } = build();
    const res = await service.pushWinningTasks([]);
    expect(prisma.task.findMany).not.toHaveBeenCalled();
    expect(res).toEqual({ pushed: 0, skipped: 0, failed: 0 });
  });

  it('task content-win có sẵn content_id: thêm vào ContentWarehouse tháng + ghi link win + đánh dấu task', async () => {
    const { service, prisma } = build({
      tasks: [winTask('t1', { content_id: 'c1' })],
    });

    const res = await service.pushWinningTasks(['t1']);

    expect(res.pushed).toBe(1);
    expect(prisma.content.create).not.toHaveBeenCalled();
    expect(prisma.contentWarehouse.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { content_id_month: { content_id: 'c1', month: expect.any(String) } },
        create: { content_id: 'c1', month: expect.any(String) },
      }),
    );
    const upd = prisma.content.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'c1' });
    expect(upd.data).toEqual({
      classification_id: 'cls-win',
      win_video_url: 'https://facebook.com/reel/1',
      win_video_views: BigInt(12000),
      win_video_platform: 'FACEBOOK',
      won_at: expect.any(Date),
    });
    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { content_win_pushed_at: expect.any(Date) },
    });
  });

  it('task KHÔNG phải content-win → bỏ qua, không ghi gì', async () => {
    const { service, prisma } = build({
      tasks: [winTask('t1', { content_id: 'c1', published_links: fbLink(9000) })],
    });

    const res = await service.pushWinningTasks(['t1']);

    expect(res).toEqual({ pushed: 0, skipped: 1, failed: 0 });
    expect(prisma.content.update).not.toHaveBeenCalled();
    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(prisma.contentWarehouse.upsert).not.toHaveBeenCalled();
  });

  it('task có team_content_id chưa lên kho tổng → tạo Content(source_team_content_id) gắn nhãn Win', async () => {
    const { service, prisma, created } = build({
      tasks: [winTask('t1', { team_content_id: 'tc1', assignee_id: 'assignee-1' })],
      teamContentById: { tc1: { brand_type: 'DO_DA', origin: 'COLLECTED', added_by_id: 'creator-9' } },
    });

    const res = await service.pushWinningTasks(['t1']);

    expect(res.pushed).toBe(1);
    expect(prisma.content.create).toHaveBeenCalledTimes(1);
    expect(created[0].data).toEqual({
      source_team_content_id: 'tc1',
      brand_type: 'DO_DA',
      classification_id: 'cls-win',
      origin: 'COLLECTED',
      added_by_id: 'assignee-1',
    });
  });

  it('task có team_content_id ĐÃ có bản kho tổng → tái dùng, không tạo Content mới', async () => {
    const { service, prisma } = build({
      tasks: [winTask('t1', { team_content_id: 'tc1' })],
      contentBySourceTeam: { tc1: { id: 'c-existing' } },
    });

    await service.pushWinningTasks(['t1']);

    expect(prisma.content.create).not.toHaveBeenCalled();
    expect(prisma.content.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c-existing' } }),
    );
  });

  it('task chỉ có editor_content_id → tạo Content mới copy title/body/script, KHÔNG copy code', async () => {
    const { service, created } = build({
      tasks: [winTask('t1', { editor_content_id: 'ec1', assignee_id: null, published_links: fbLink(15000) })],
      editorContentById: {
        ec1: {
          brand_type: 'TRANG_SUC', market: 'JAPAN',
          title: 'Tiêu đề', body: 'Body', script: 'Script', file_content_url: 'http://f',
          added_by_id: 'ec-owner', user_id: 'ec-user',
        },
      },
    });

    await service.pushWinningTasks(['t1']);

    expect(created[0].data).toEqual({
      source_editor_content_id: 'ec1',
      brand_type: 'TRANG_SUC',
      market: 'JAPAN',
      title: 'Tiêu đề',
      body: 'Body',
      script: 'Script',
      file_content_url: 'http://f',
      classification_id: 'cls-win',
      added_by_id: 'ec-owner',
    });
    expect(created[0].data).not.toHaveProperty('code');
  });

  it('task sáng tạo KHÔNG gắn content nào → tạo Content mới đại diện video thắng (không source_*), title theo tuyến', async () => {
    const { service, prisma, created } = build({
      tasks: [winTask('t1', { published_links: fbLink(47434, 'success', 'https://facebook.com/reel/win-1') })],
    });

    const res = await service.pushWinningTasks(['t1']);

    expect(res.pushed).toBe(1);
    expect(prisma.content.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { win_video_url: 'https://facebook.com/reel/win-1' } }),
    );
    expect(created[0].data).toEqual({
      brand_type: 'TRANG_SUC',
      market: 'VIETNAM',
      content_line_id: 'cl-A4',
      title: 'Content Win · A4',
      classification_id: 'cls-win',
      added_by_id: 'assignee-1',
    });
    expect(created[0].data).not.toHaveProperty('source_team_content_id');
    expect(created[0].data).not.toHaveProperty('source_editor_content_id');
    // Content vừa tạo được ghi link win + thêm vào kho tháng + task đánh dấu.
    expect(prisma.content.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'content-new-1' } }),
    );
    expect(prisma.contentWarehouse.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { content_id_month: { content_id: 'content-new-1', month: expect.any(String) } } }),
    );
    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { content_win_pushed_at: expect.any(Date) },
    });
  });

  it('task sáng tạo: URL video thắng đã có Content → tái dùng, không tạo mới', async () => {
    const { service, prisma } = build({
      tasks: [winTask('t1', { published_links: fbLink(30000, 'success', 'https://fb/reel/dup') })],
      contentByWinUrl: { 'https://fb/reel/dup': { id: 'c-dup' } },
    });

    await service.pushWinningTasks(['t1']);

    expect(prisma.content.create).not.toHaveBeenCalled();
    expect(prisma.content.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c-dup' } }),
    );
  });

  it('task sáng tạo không có cả assignee lẫn reviewer → không tạo Content, vẫn đánh dấu task', async () => {
    const { service, prisma } = build({
      tasks: [winTask('t1', { assignee_id: null, reviewed_by_id: null })],
    });

    const res = await service.pushWinningTasks(['t1']);

    expect(res.failed).toBe(0);
    expect(prisma.content.create).not.toHaveBeenCalled();
    expect(prisma.content.update).not.toHaveBeenCalled();
    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { content_win_pushed_at: expect.any(Date) },
    });
  });

  it('content đã won_at (thắng lần trước) → KHÔNG ghi đè link/nhãn, vẫn thêm vào kho tháng + đánh dấu task', async () => {
    const { service, prisma } = build({
      tasks: [winTask('t1', { content_id: 'c1' })],
      contentById: { c1: { classification_id: 'cls-thu-cong', won_at: new Date('2026-01-01') } },
    });

    await service.pushWinningTasks(['t1']);

    expect(prisma.content.update.mock.calls[0][0].data).toEqual({});
    expect(prisma.contentWarehouse.upsert).toHaveBeenCalled();
    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { content_win_pushed_at: expect.any(Date) },
    });
  });

  it('nhãn "Win" chưa tồn tại → tự tạo', async () => {
    const { service, prisma } = build({
      classificationId: null,
      tasks: [winTask('t1', { content_id: 'c1' })],
    });

    await service.pushWinningTasks(['t1']);

    expect(prisma.contentClassification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Win' } }),
    );
    expect(prisma.content.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ classification_id: 'cls-win-created' }),
    );
  });

  it('1 task lỗi khi ghi không chặn task còn lại', async () => {
    const contentUpdateImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error('db boom'))
      .mockResolvedValue({});
    const { service, prisma } = build({
      tasks: [winTask('t1', { content_id: 'c1' }), winTask('t2', { content_id: 'c2' })],
      contentUpdateImpl,
    });

    const res = await service.pushWinningTasks(['t1', 't2']);

    expect(res).toEqual({ pushed: 1, skipped: 0, failed: 1 });
    expect(prisma.task.update).toHaveBeenCalledTimes(1);
    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: 't2' },
      data: { content_win_pushed_at: expect.any(Date) },
    });
  });
});
