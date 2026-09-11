import { BadRequestException } from '@nestjs/common';
import { TaskAutoKpiService } from '../kpi.service';

/**
 * Báo cáo KPI TỰ TÍNH từ dữ liệu thật (KHÔNG phải target đặt tay — cái đó ở kpi-targets.spec.ts):
 *  - getContentCreatorKpiReport()          — số content sưu tầm / bản dịch / video đã lên
 *  - getContentWinFailStats() + refresh    — win/fail/pending theo link bài đăng >10.000 view
 *  - getTopContentWinFailMembers() + refresh — bảng xếp hạng top N toàn hệ thống
 */

function fbLink(views: number, status: 'success' | 'failed' | 'unsupported' = 'success') {
  return [{ id: 'l1', platform: 'FACEBOOK', url: 'https://facebook.com/x', stats: { views, status } }];
}

/**
 * getContentCreatorKpiReport() — báo cáo TỰ TÍNH (không phải target đặt tay) từ dữ liệu thật:
 * số content sưu tầm (TeamContent.added_by), số bản dịch (ContentTranslation.translated_by),
 * và danh sách video đã lên (Task trỏ tới content do người này thêm, qua content_id hoặc
 * team_content_id). Khác ContentCreatorKpi (target tháng thủ công) — đây là báo cáo, không ghi DB.
 */
describe('TaskAutoKpiService.getContentCreatorKpiReport', () => {
  function build(opts: {
    users?: any[];
    collectedGroups?: any[];
    translationGroups?: any[];
    tasks?: any[];
    members?: { user_id: string }[];
  } = {}) {
    const prisma: any = {
      teamMember: {
        findMany: jest.fn(async () =>
          opts.members === undefined ? [{ user_id: 'creator-1' }] : opts.members,
        ),
      },
      user: {
        findMany: jest.fn(async () =>
          opts.users === undefined
            ? [{ id: 'creator-1', full_name: 'Người sưu tầm 1' }]
            : opts.users,
        ),
      },
      teamContent: {
        groupBy: jest.fn(async () =>
          opts.collectedGroups === undefined
            ? [{ added_by_id: 'creator-1', _count: { id: 4 } }]
            : opts.collectedGroups,
        ),
      },
      contentTranslation: {
        groupBy: jest.fn(async () =>
          opts.translationGroups === undefined
            ? [{ translated_by_id: 'creator-1', _count: { id: 2 } }]
            : opts.translationGroups,
        ),
      },
      task: {
        findMany: jest.fn(async () => (opts.tasks === undefined ? [] : opts.tasks)),
      },
    };
    const service = new TaskAutoKpiService(prisma, {} as any, {} as any);
    return { service, prisma };
  }

  afterEach(() => jest.clearAllMocks());

  it('không truyền cả user_id lẫn team_id → BadRequestException', async () => {
    const { service } = build();

    await expect(service.getContentCreatorKpiReport({})).rejects.toThrow(BadRequestException);
  });

  it('truyền team_id → lấy toàn bộ member của team làm userIds', async () => {
    const { service, prisma } = build({ members: [{ user_id: 'creator-1' }, { user_id: 'creator-2' }] });

    await service.getContentCreatorKpiReport({ team_id: 'team-1' });

    expect(prisma.teamMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { team_id: 'team-1' } }),
    );
  });

  it('team không có thành viên nào → trả mảng rỗng, không query tiếp', async () => {
    const { service, prisma } = build({ members: [] });

    const result = await service.getContentCreatorKpiReport({ team_id: 'team-empty' });

    expect(result).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('gộp đúng content_collected + translations_count + videos_made cho từng user', async () => {
    const { service } = build({
      tasks: [
        {
          id: 'task-1',
          status: 'PUBLISHED',
          published_links: [],
          assignee: { id: 'editor-1', full_name: 'Editor A' },
          team_content: { added_by_id: 'creator-1', code: 'TC1', title: 'Content 1' },
          content: null,
        },
      ],
    });

    const result = await service.getContentCreatorKpiReport({ user_id: 'creator-1' });

    expect(result).toEqual([
      expect.objectContaining({
        user_id: 'creator-1',
        content_collected: 4,
        translations_count: 2,
        videos_made: 1,
      }),
    ]);
    expect(result[0].videos[0]).toEqual(
      expect.objectContaining({ task_id: 'task-1', content_code: 'TC1', content_title: 'Content 1' }),
    );
  });

  it('lấy owner qua content.source_team_content.added_by_id khi task không gắn trực tiếp team_content', async () => {
    const { service } = build({
      tasks: [
        {
          id: 'task-2',
          status: 'PUBLISHED',
          published_links: [],
          assignee: null,
          team_content: null,
          content: { id: 'c-1', code: 'C1', title: 'Content pushed', source_team_content: { added_by_id: 'creator-1' } },
        },
      ],
    });

    const result = await service.getContentCreatorKpiReport({ user_id: 'creator-1' });

    expect(result[0].videos_made).toBe(1);
    expect(result[0].videos[0].content_id).toBe('c-1');
  });

  it('task không xác định được owner (thiếu cả team_content lẫn source_team_content) → bị bỏ qua', async () => {
    const { service } = build({
      tasks: [
        {
          id: 'task-orphan',
          status: 'PUBLISHED',
          published_links: [],
          assignee: null,
          team_content: null,
          content: { id: 'c-2', code: 'C2', title: 'X', source_team_content: null },
        },
      ],
    });

    const result = await service.getContentCreatorKpiReport({ user_id: 'creator-1' });

    expect(result[0].videos_made).toBe(0);
  });

  it('user chưa sưu tầm/dịch/lên video gì → tất cả field về 0, không lỗi', async () => {
    const { service } = build({ collectedGroups: [], translationGroups: [], tasks: [] });

    const result = await service.getContentCreatorKpiReport({ user_id: 'creator-1' });

    expect(result).toEqual([
      expect.objectContaining({ content_collected: 0, translations_count: 0, videos_made: 0, videos: [] }),
    ]);
  });

  it('truyền from/to → range được áp vào where của teamContent/contentTranslation/task', async () => {
    const { service, prisma } = build();

    await service.getContentCreatorKpiReport({ user_id: 'creator-1', from: '2026-08-01', to: '2026-08-31' });

    const groupByArgs = prisma.teamContent.groupBy.mock.calls[0][0];
    expect(groupByArgs.where.added_at.gte).toEqual(new Date(2026, 7, 1));
    // "to" là mốc lt của ngày kế tiếp (2026-09-01), không phải lte 2026-08-31 — bao trọn cả ngày cuối.
    expect(groupByArgs.where.added_at.lt).toEqual(new Date(2026, 8, 1));
  });
});

/**
 * getContentWinFailStats() — MỘT cơ chế duy nhất cho mọi thành viên (không phân biệt content
 * creator/editor): "content được gắn task trong kỳ" → win/fail/pending; win khi có ít nhất 1 link
 * bài đăng bất kỳ (Facebook/YouTube/Instagram) đạt > 10.000 view.
 * Kết quả gộp thành 1 danh sách theo user_id (by_member), dedupe theo task_id nếu 1 người vừa là
 * content creator vừa là editor CỦA CÙNG 1 task. Không đụng EditorKpi.video_win/fail (nhập tay).
 */
describe('TaskAutoKpiService.getContentWinFailStats', () => {
  function build(opts: {
    users?: any[];
    members?: { user_id: string }[];
    creatorTasks?: any[]; // tasks trả về cho query bên trong getContentCreatorKpiReport (có team_content/content, chọn qua "assignee")
    editorTasks?: any[]; // tasks trả về cho query editor side (select assignee_id dạng scalar)
    fetchStatsForLink?: jest.Mock;
  } = {}) {
    const users = opts.users ?? [
      { id: 'creator-1', full_name: 'Content Creator 1' },
      { id: 'editor-1', full_name: 'Editor 1' },
    ];
    const prisma: any = {
      teamMember: {
        findMany: jest.fn(async () =>
          opts.members === undefined ? [{ user_id: 'creator-1' }, { user_id: 'editor-1' }] : opts.members,
        ),
      },
      user: {
        findMany: jest.fn(async (args: any) => {
          const ids: string[] = args?.where?.id?.in ?? [];
          return users.filter((u) => ids.includes(u.id));
        }),
      },
      teamContent: { groupBy: jest.fn(async () => []) },
      contentTranslation: { groupBy: jest.fn(async () => []) },
      task: {
        // "Dấu vân tay": query editor side (viết trực tiếp trong getContentWinFailStats) select
        // assignee_id dạng SCALAR — query content-creator side (bên trong getContentCreatorKpiReport)
        // chỉ select quan hệ "assignee" (không có field assignee_id trong select).
        findMany: jest.fn(async (args: any) => {
          const isEditorSideQuery = !!args?.select?.assignee_id;
          if (isEditorSideQuery) return opts.editorTasks ?? [];
          return opts.creatorTasks ?? [];
        }),
        update: jest.fn(async (args: any) => args),
      },
    };
    const linkStats: any = {
      fetchStatsForLink: opts.fetchStatsForLink ?? jest.fn(async () => ({ status: 'success', views: 12000, likes: 0, comments: 0, shares: 0, fetched_at: 'x' })),
    };
    const contentWinPush: any = { pushWinningTasks: jest.fn(async () => ({ pushed: 0, skipped: 0, failed: 0 })) };
    const service = new TaskAutoKpiService(prisma, linkStats, contentWinPush);
    return { service, prisma, linkStats };
  }

  afterEach(() => jest.clearAllMocks());

  it('không truyền cả user_id lẫn team_id → BadRequestException', async () => {
    const { service } = build();
    await expect(service.getContentWinFailStats({})).rejects.toThrow(BadRequestException);
  });

  it('team không có thành viên nào → trả rỗng, không lỗi', async () => {
    const { service } = build({ members: [] });
    const result = await service.getContentWinFailStats({ team_id: 'team-empty' });
    expect(result).toEqual({ by_member: [], totals: { win: 0, fail: 0, pending: 0 } });
  });

  it('mọi thành viên team đều xuất hiện trong by_member kể cả khi chưa có hoạt động gì', async () => {
    const { service } = build({ members: [{ user_id: 'creator-1' }, { user_id: 'editor-1' }] });
    const result = await service.getContentWinFailStats({ team_id: 'team-1' });
    expect(result.by_member.map((m) => m.user_id).sort()).toEqual(['creator-1', 'editor-1']);
    expect(result.by_member.every((m) => m.win === 0 && m.fail === 0 && m.pending === 0)).toBe(true);
  });

  it('content creator: phân loại đúng win/fail/pending theo từng video được gắn content của họ', async () => {
    const { service } = build({
      members: [{ user_id: 'creator-1' }],
      creatorTasks: [
        { id: 't-win', status: 'APPROVED', published_links: fbLink(12000), assignee: null, team_content: { added_by_id: 'creator-1', code: 'C1', title: 'T1' }, content: null },
        { id: 't-fail', status: 'APPROVED', published_links: fbLink(1000), assignee: null, team_content: { added_by_id: 'creator-1', code: 'C2', title: 'T2' }, content: null },
        { id: 't-pending', status: 'APPROVED', published_links: [], assignee: null, team_content: { added_by_id: 'creator-1', code: 'C3', title: 'T3' }, content: null },
      ],
    });

    const result = await service.getContentWinFailStats({ team_id: 'team-1' });

    const creator1 = result.by_member.find((r) => r.user_id === 'creator-1')!;
    expect(creator1).toEqual(expect.objectContaining({ win: 1, fail: 1, pending: 1 }));
    expect(creator1.videos.find((v: any) => v.task_id === 't-win').win_status_auto).toBe('win');
    expect(creator1.videos.find((v: any) => v.task_id === 't-fail').win_status_auto).toBe('fail');
    expect(creator1.videos.find((v: any) => v.task_id === 't-pending').win_status_auto).toBe('pending');
  });

  it('editor: phân loại đúng win/fail/pending theo content gắn vào chính task họ được giao', async () => {
    const { service } = build({
      members: [{ user_id: 'editor-1' }],
      editorTasks: [
        { id: 'e-win', assignee_id: 'editor-1', published_links: fbLink(12000), content: null, team_content: { code: 'C1', title: 'Video A' }, editor_content: null },
        { id: 'e-fail', assignee_id: 'editor-1', published_links: fbLink(500), content: null, team_content: null, editor_content: null },
        { id: 'e-pending', assignee_id: 'editor-1', published_links: [], content: null, team_content: null, editor_content: null },
      ],
    });

    const result = await service.getContentWinFailStats({ team_id: 'team-1' });

    const editor1 = result.by_member.find((r) => r.user_id === 'editor-1')!;
    expect(editor1).toEqual(expect.objectContaining({ win: 1, fail: 1, pending: 1 }));
    expect(editor1.videos.find((v: any) => v.task_id === 'e-win').content_title).toBe('Video A');
  });

  it('1 người vừa là content creator vừa là editor CỦA CÙNG 1 task → chỉ tính 1 lần, không đếm trùng', async () => {
    const { service } = build({
      users: [{ id: 'both-1', full_name: 'Cả hai vai trò' }],
      members: [{ user_id: 'both-1' }],
      creatorTasks: [
        { id: 'shared-task', status: 'APPROVED', published_links: fbLink(12000), assignee: { id: 'both-1', full_name: 'Cả hai vai trò' }, team_content: { added_by_id: 'both-1', code: 'C1', title: 'T1' }, content: null },
      ],
      editorTasks: [
        { id: 'shared-task', assignee_id: 'both-1', published_links: fbLink(12000), content: null, team_content: { code: 'C1', title: 'T1' }, editor_content: null },
      ],
    });

    const result = await service.getContentWinFailStats({ team_id: 'team-1' });

    const both = result.by_member.find((r) => r.user_id === 'both-1')!;
    expect(both).toEqual(expect.objectContaining({ win: 1, fail: 0, pending: 0 }));
    expect(both.videos).toHaveLength(1);
  });

  it('1 người vừa là content creator vừa là editor nhưng ở 2 task KHÁC NHAU → cộng dồn đúng, không dedupe nhầm', async () => {
    const { service } = build({
      users: [{ id: 'both-1', full_name: 'Cả hai vai trò' }],
      members: [{ user_id: 'both-1' }],
      creatorTasks: [
        { id: 'task-a', status: 'APPROVED', published_links: fbLink(12000), assignee: null, team_content: { added_by_id: 'both-1', code: 'C1', title: 'T1' }, content: null },
      ],
      editorTasks: [
        { id: 'task-b', assignee_id: 'both-1', published_links: fbLink(1000), content: null, team_content: null, editor_content: null },
      ],
    });

    const result = await service.getContentWinFailStats({ team_id: 'team-1' });

    const both = result.by_member.find((r) => r.user_id === 'both-1')!;
    expect(both).toEqual(expect.objectContaining({ win: 1, fail: 1, pending: 0 }));
    expect(both.videos.map((v: any) => v.task_id).sort()).toEqual(['task-a', 'task-b']);
  });

  it('totals cộng dồn đúng qua tất cả thành viên trong scope', async () => {
    const { service } = build({
      members: [{ user_id: 'creator-1' }, { user_id: 'editor-1' }],
      creatorTasks: [
        { id: 't-1', status: 'APPROVED', published_links: fbLink(12000), assignee: null, team_content: { added_by_id: 'creator-1', code: 'C1', title: 'T1' }, content: null },
      ],
      editorTasks: [
        { id: 'e-1', assignee_id: 'editor-1', published_links: fbLink(12000), content: null, team_content: null, editor_content: null },
        { id: 'e-2', assignee_id: 'editor-1', published_links: fbLink(1000), content: null, team_content: null, editor_content: null },
      ],
    });

    const result = await service.getContentWinFailStats({ team_id: 'team-1' });

    expect(result.totals).toEqual({ win: 2, fail: 1, pending: 0 });
  });
});

/**
 * refreshContentWinFailStats() — bấm xem chi tiết 1 thành viên ở FE gọi route này trước để cào
 * lại traffic Facebook mới nhất (task-published-link-stats.service.ts), ghi lại published_links,
 * RỒI mới tính lại win/fail — không đợi cron 8:15 sáng hôm sau.
 */
describe('TaskAutoKpiService.refreshContentWinFailStats', () => {
  function build(opts: { editorTasks?: any[]; fetchStatsForLink?: jest.Mock } = {}) {
    // Store có state (Map theo task id) — mô phỏng DB thật: refresh ghi lại published_links rồi
    // getContentWinFailStats() gọi LẠI ngay sau đó phải đọc thấy đúng bản mới, không phải bản cũ.
    const store = new Map<string, any>((opts.editorTasks ?? []).map((t) => [t.id, { ...t }]));
    const prisma: any = {
      teamMember: { findMany: jest.fn(async () => [{ user_id: 'editor-1' }]) },
      user: { findMany: jest.fn(async () => [{ id: 'editor-1', full_name: 'Editor 1' }]) },
      teamContent: { groupBy: jest.fn(async () => []) },
      contentTranslation: { groupBy: jest.fn(async () => []) },
      task: {
        findMany: jest.fn(async (args: any) =>
          args?.select?.assignee_id ? Array.from(store.values()) : [],
        ),
        update: jest.fn(async (args: any) => {
          const current = store.get(args.where.id);
          if (current) store.set(args.where.id, { ...current, ...args.data });
          return args;
        }),
      },
    };
    const linkStats: any = { fetchStatsForLink: opts.fetchStatsForLink ?? jest.fn() };
    const contentWinPush: any = { pushWinningTasks: jest.fn(async () => ({ pushed: 0, skipped: 0, failed: 0 })) };
    const service = new TaskAutoKpiService(prisma, linkStats, contentWinPush);
    return { service, prisma, linkStats };
  }

  afterEach(() => jest.clearAllMocks());

  it('cào lại từng link Facebook rồi ghi lại published_links của đúng task', async () => {
    const fetchStatsForLink = jest.fn(async () => ({ status: 'success', views: 12000, likes: 1, comments: 1, shares: 1, fetched_at: 'now' }));
    const { service, prisma } = build({
      editorTasks: [{ id: 'e-1', assignee_id: 'editor-1', published_links: fbLink(100), content: null, team_content: null, editor_content: null }],
      fetchStatsForLink,
    });

    const result = await service.refreshContentWinFailStats({ user_id: 'editor-1' });

    expect(fetchStatsForLink).toHaveBeenCalledWith('FACEBOOK', 'https://facebook.com/x');
    expect(prisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'e-1' },
        data: { published_links: [expect.objectContaining({ stats: expect.objectContaining({ views: 12000, status: 'success' }) })] },
      }),
    );
    // Trả về số ĐÃ tính lại sau khi cào — 12000 > 10.000 nên win, không phải fail như trước khi cào.
    expect(result.by_member.find((m) => m.user_id === 'editor-1')).toEqual(expect.objectContaining({ win: 1, fail: 0, pending: 0 }));
  });

  it('1 link lỗi khi cào không chặn các task/link còn lại', async () => {
    const fetchStatsForLink = jest.fn(async () => {
      throw new Error('Facebook API lỗi');
    });
    const { service, prisma } = build({
      editorTasks: [{ id: 'e-1', assignee_id: 'editor-1', published_links: fbLink(100), content: null, team_content: null, editor_content: null }],
      fetchStatsForLink,
    });

    // Không throw ra ngoài — link lỗi giữ nguyên stats cũ.
    const result = await service.refreshContentWinFailStats({ user_id: 'editor-1' });
    expect(result.by_member.find((m) => m.user_id === 'editor-1')).toEqual(expect.objectContaining({ fail: 1 }));
  });

  it('không có link Facebook/YouTube nào cần cào → không gọi task.update', async () => {
    const { service, prisma, linkStats } = build({ editorTasks: [] });

    await service.refreshContentWinFailStats({ user_id: 'editor-1' });

    expect(linkStats.fetchStatsForLink).not.toHaveBeenCalled();
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('link YouTube được cào lại VÀ tính vào win/fail — win/fail xét mọi nền tảng, không chỉ Facebook', async () => {
    const fetchStatsForLink = jest.fn(async (platform: string) =>
      platform.toUpperCase() === 'YOUTUBE'
        ? { status: 'success', views: 999999, likes: 0, comments: 0, shares: 0, fetched_at: 'now' }
        : { status: 'success', views: 1000, likes: 0, comments: 0, shares: 0, fetched_at: 'now' },
    );
    const { service, prisma } = build({
      editorTasks: [
        {
          id: 'e-yt',
          assignee_id: 'editor-1',
          published_links: [
            { id: 'l-fb', platform: 'FACEBOOK', url: 'https://facebook.com/x', stats: { views: 1000, status: 'success' } },
            { id: 'l-yt', platform: 'YouTube', url: 'https://youtube.com/watch?v=x', stats: { views: 10, status: 'success' } },
          ],
          content: null,
          team_content: null,
          editor_content: null,
        },
      ],
      fetchStatsForLink,
    });

    const result = await service.refreshContentWinFailStats({ user_id: 'editor-1' });

    // Cả 2 link đều được gọi cào lại.
    expect(fetchStatsForLink).toHaveBeenCalledWith('FACEBOOK', 'https://facebook.com/x');
    expect(fetchStatsForLink).toHaveBeenCalledWith('YouTube', 'https://youtube.com/watch?v=x');
    // Ghi lại đúng cả 2 link với số mới.
    const updateCall = prisma.task.update.mock.calls.find((c: any[]) => c[0].where.id === 'e-yt');
    const savedLinks = updateCall[0].data.published_links;
    expect(savedLinks.find((l: any) => l.id === 'l-yt').stats.views).toBe(999999);
    expect(savedLinks.find((l: any) => l.id === 'l-fb').stats.views).toBe(1000);
    // Win/fail xét mọi nền tảng: link YouTube 999999 view > 10.000 → win (dù link Facebook chỉ 1000 view).
    expect(result.by_member.find((m) => m.user_id === 'editor-1')).toEqual(expect.objectContaining({ win: 1, fail: 0, pending: 0 }));
  });

  it('link vừa cào THÀNH CÔNG gần đây (còn mới) → bỏ qua, không gọi lại API và không ghi task.update', async () => {
    const fetchStatsForLink = jest.fn();
    const freshFetchedAt = new Date().toISOString(); // vừa cào xong ngay bây giờ → chắc chắn còn mới.
    const { service, prisma } = build({
      editorTasks: [{
        id: 'e-1',
        assignee_id: 'editor-1',
        published_links: [{ id: 'l1', platform: 'FACEBOOK', url: 'https://facebook.com/x', stats: { views: 12000, status: 'success', fetched_at: freshFetchedAt } }],
        content: null,
        team_content: null,
        editor_content: null,
      }],
      fetchStatsForLink,
    });

    const result = await service.refreshContentWinFailStats({ user_id: 'editor-1' });

    expect(fetchStatsForLink).not.toHaveBeenCalled();
    expect(prisma.task.update).not.toHaveBeenCalled();
    // Vẫn trả đúng số liệu hiện có (không đổi vì không cào lại).
    expect(result.by_member.find((m) => m.user_id === 'editor-1')).toEqual(expect.objectContaining({ win: 1, fail: 0, pending: 0 }));
  });

  it('2 task cùng cần cào lại → cả 2 vẫn được ghi đúng dù chạy song song qua semaphore', async () => {
    const fetchStatsForLink = jest.fn(async () => ({ status: 'success', views: 12000, likes: 0, comments: 0, shares: 0, fetched_at: 'now' }));
    const { service, prisma } = build({
      editorTasks: [
        { id: 'e-1', assignee_id: 'editor-1', published_links: fbLink(100), content: null, team_content: null, editor_content: null },
        { id: 'e-2', assignee_id: 'editor-1', published_links: fbLink(200), content: null, team_content: null, editor_content: null },
      ],
      fetchStatsForLink,
    });

    await service.refreshContentWinFailStats({ user_id: 'editor-1' });

    expect(prisma.task.update).toHaveBeenCalledTimes(2);
    expect(prisma.task.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'e-1' } }));
    expect(prisma.task.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'e-2' } }));
  });
});

/**
 * getTopContentWinFailMembers() — top N người có nhiều content win nhất TOÀN HỆ THỐNG, dùng làm
 * mặc định cho ADMIN/MANAGER khi chưa chọn team/thành viên cụ thể ở trang Tổng quan. Tái dùng
 * đúng cơ chế merge của getContentWinFailStats (mergeWinFailByMember) — chỉ khác tập userIds
 * (toàn hệ thống thay vì 1 team/1 người) và có thêm bước xếp hạng/cắt top N.
 */
describe('TaskAutoKpiService.getTopContentWinFailMembers', () => {
  function build(opts: {
    allUserIds?: string[];
    users?: any[];
    creatorTasks?: any[];
    editorTasks?: any[];
  } = {}) {
    const userIds = opts.allUserIds ?? ['u1', 'u2', 'u3'];
    const users = opts.users ?? userIds.map((id) => ({ id, full_name: `User ${id}` }));
    const prisma: any = {
      teamMember: {
        findMany: jest.fn(async () => userIds.map((user_id) => ({ user_id }))),
      },
      user: {
        findMany: jest.fn(async (args: any) => {
          const ids: string[] = args?.where?.id?.in ?? [];
          return users.filter((u) => ids.includes(u.id));
        }),
      },
      teamContent: { groupBy: jest.fn(async () => []) },
      contentTranslation: { groupBy: jest.fn(async () => []) },
      task: {
        findMany: jest.fn(async (args: any) =>
          args?.select?.assignee_id ? opts.editorTasks ?? [] : opts.creatorTasks ?? [],
        ),
        update: jest.fn(async (args: any) => args),
      },
    };
    const linkStats: any = { fetchStatsForLink: jest.fn() };
    const contentWinPush: any = { pushWinningTasks: jest.fn(async () => ({ pushed: 0, skipped: 0, failed: 0 })) };
    const service = new TaskAutoKpiService(prisma, linkStats, contentWinPush);
    return { service, prisma };
  }

  afterEach(() => jest.clearAllMocks());

  it('không có thành viên nào trong hệ thống → trả rỗng, không lỗi', async () => {
    const { service } = build({ allUserIds: [] });
    const result = await service.getTopContentWinFailMembers({});
    expect(result).toEqual({ by_member: [], totals: { win: 0, fail: 0, pending: 0 } });
  });

  it('xếp hạng theo win giảm dần, cắt đúng limit', async () => {
    const { service } = build({
      allUserIds: ['u1', 'u2', 'u3'],
      editorTasks: [
        { id: 't-u1-a', assignee_id: 'u1', published_links: fbLink(12000), content: null, team_content: null, editor_content: null },
        { id: 't-u1-b', assignee_id: 'u1', published_links: fbLink(12000), content: null, team_content: null, editor_content: null },
        { id: 't-u2-a', assignee_id: 'u2', published_links: fbLink(12000), content: null, team_content: null, editor_content: null },
        { id: 't-u3-a', assignee_id: 'u3', published_links: fbLink(1000), content: null, team_content: null, editor_content: null },
      ],
    });

    const result = await service.getTopContentWinFailMembers({ limit: 2 });

    expect(result.by_member).toHaveLength(2);
    expect(result.by_member[0]).toEqual(expect.objectContaining({ user_id: 'u1', win: 2 }));
    expect(result.by_member[1]).toEqual(expect.objectContaining({ user_id: 'u2', win: 1 }));
  });

  it('totals phản ánh TOÀN hệ thống, không chỉ top N đã cắt', async () => {
    const { service } = build({
      allUserIds: ['u1', 'u2', 'u3'],
      editorTasks: [
        { id: 't-u1', assignee_id: 'u1', published_links: fbLink(12000), content: null, team_content: null, editor_content: null },
        { id: 't-u2', assignee_id: 'u2', published_links: fbLink(12000), content: null, team_content: null, editor_content: null },
        { id: 't-u3', assignee_id: 'u3', published_links: fbLink(12000), content: null, team_content: null, editor_content: null },
      ],
    });

    const result = await service.getTopContentWinFailMembers({ limit: 1 });

    expect(result.by_member).toHaveLength(1);
    expect(result.totals).toEqual({ win: 3, fail: 0, pending: 0 });
  });

  it('lọc bỏ người chưa có hoạt động gì (toàn 0) khỏi bảng xếp hạng', async () => {
    const { service } = build({
      allUserIds: ['u1', 'u2'],
      editorTasks: [
        { id: 't-u1', assignee_id: 'u1', published_links: fbLink(12000), content: null, team_content: null, editor_content: null },
      ],
    });

    const result = await service.getTopContentWinFailMembers({});

    expect(result.by_member.map((m) => m.user_id)).toEqual(['u1']);
  });

  it('không truyền limit → mặc định 5', async () => {
    const tasks = Array.from({ length: 7 }, (_, i) => ({
      id: `t-u${i}`, assignee_id: `u${i}`, published_links: fbLink(12000), content: null, team_content: null, editor_content: null,
    }));
    const { service } = build({ allUserIds: tasks.map((_, i) => `u${i}`), editorTasks: tasks });

    const result = await service.getTopContentWinFailMembers({});

    expect(result.by_member).toHaveLength(5);
  });
});

/**
 * refreshTopContentWinFailMembers() — nút "Cập nhật" khi ADMIN/MANAGER đang xem bảng xếp hạng Top
 * N toàn hệ thống (không có team_id/user_id để gọi refreshContentWinFailStats). Chỉ cào lại
 * traffic cho các task thuộc top N ĐANG HIỂN THỊ, không phải toàn hệ thống.
 */
describe('TaskAutoKpiService.refreshTopContentWinFailMembers', () => {
  function build(opts: { allUserIds?: string[]; editorTasks?: any[]; fetchStatsForLink?: jest.Mock } = {}) {
    const userIds = opts.allUserIds ?? ['u1', 'u2', 'u3'];
    const users = userIds.map((id) => ({ id, full_name: `User ${id}` }));
    const store = new Map<string, any>((opts.editorTasks ?? []).map((t) => [t.id, { ...t }]));
    const prisma: any = {
      teamMember: { findMany: jest.fn(async () => userIds.map((user_id) => ({ user_id }))) },
      user: {
        findMany: jest.fn(async (args: any) => {
          const ids: string[] = args?.where?.id?.in ?? [];
          return users.filter((u) => ids.includes(u.id));
        }),
      },
      teamContent: { groupBy: jest.fn(async () => []) },
      contentTranslation: { groupBy: jest.fn(async () => []) },
      task: {
        findMany: jest.fn(async (args: any) => (args?.select?.assignee_id ? Array.from(store.values()) : [])),
        update: jest.fn(async (args: any) => {
          const current = store.get(args.where.id);
          if (current) store.set(args.where.id, { ...current, ...args.data });
          return args;
        }),
      },
    };
    const linkStats: any = { fetchStatsForLink: opts.fetchStatsForLink ?? jest.fn() };
    const contentWinPush: any = { pushWinningTasks: jest.fn(async () => ({ pushed: 0, skipped: 0, failed: 0 })) };
    const service = new TaskAutoKpiService(prisma, linkStats, contentWinPush);
    return { service, prisma };
  }

  afterEach(() => jest.clearAllMocks());

  it('chỉ cào lại traffic cho top N đang hiển thị, bỏ qua người bị cắt khỏi bảng xếp hạng', async () => {
    const fetchStatsForLink = jest.fn(async () => ({ status: 'success', views: 12000, likes: 0, comments: 0, shares: 0, fetched_at: 'now' }));
    const { service, prisma } = build({
      allUserIds: ['u1', 'u2', 'u3'],
      editorTasks: [
        { id: 't-u1', assignee_id: 'u1', published_links: fbLink(12000), content: null, team_content: null, editor_content: null },
        { id: 't-u2', assignee_id: 'u2', published_links: fbLink(12000), content: null, team_content: null, editor_content: null },
        { id: 't-u3', assignee_id: 'u3', published_links: fbLink(1000), content: null, team_content: null, editor_content: null },
      ],
      fetchStatsForLink,
    });

    // limit: 2 → u3 (win thấp nhất trong 3 người active) bị cắt khỏi top, không nên bị cào lại.
    const result = await service.refreshTopContentWinFailMembers({ limit: 2 });

    expect(prisma.task.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't-u1' } }));
    expect(prisma.task.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't-u2' } }));
    expect(prisma.task.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't-u3' } }));
    // Sau khi cào, view 12000 > 10.000 → cả u1/u2 đều thành win.
    expect(result.by_member.map((m: any) => m.user_id)).toEqual(['u1', 'u2']);
    expect(result.by_member.every((m: any) => m.win === 1)).toBe(true);
  });
});
