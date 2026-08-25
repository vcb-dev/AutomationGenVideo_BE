import { TaskAutoTasksService } from '../tasks.service';

/**
 * getContentFreshnessByAssignee() (private, gọi qua getDashboard/getTeamReport) — "content mới" vs
 * "content cũ" trong 1 kỳ lọc (tháng báo cáo của leader dashboard): content đã dùng trong task
 * (Content.created_at / EditorContent.added_at / TeamContent.added_at — đúng 1 trong 3 field được
 * set trên mỗi task) được thêm vào kho ĐÚNG TRONG kỳ đang xem → "mới". Mọi task còn lại trong kỳ —
 * content thêm từ trước kỳ, hoặc task không gắn content nào — đều tính là "cũ". Xem comment gốc tại
 * tasks.service.ts.
 */
describe('TaskAutoTasksService — content_new / content_old (qua getDashboard)', () => {
  // getDashboard không truyền `month` → BE mặc định về tháng thực tế hiện tại — nên mốc "trong kỳ"/
  // "trước kỳ" phải tính tương đối theo tháng thực tế lúc chạy test, không hard-code ngày cụ thể.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const IN_PERIOD_CONTENT = new Date(monthStart.getTime() + 2 * 86_400_000); // vài ngày sau đầu tháng
  const BEFORE_PERIOD_CONTENT = new Date(monthStart.getTime() - 86_400_000); // ngày cuối tháng trước
  const TASK_CREATED_AT = new Date(monthStart.getTime() + 3 * 86_400_000); // không còn ảnh hưởng tới mới/cũ

  function build(opts: {
    taskRows?: any[];
    contents?: any[];
    editorContents?: any[];
    teamContents?: any[];
  } = {}) {
    const teamsLed = [
      {
        id: 't-1',
        name: 'Content Team A',
        members: [
          { user_id: 'creator-1', user: { id: 'creator-1', full_name: 'A', email: 'a@x.com' } },
        ],
      },
    ];
    const prisma: any = {
      team: { findMany: jest.fn(async () => teamsLed) },
      task: {
        groupBy: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => (opts.taskRows === undefined ? [] : opts.taskRows)),
      },
      content: {
        findMany: jest.fn(async () => (opts.contents === undefined ? [] : opts.contents)),
      },
      editorContent: {
        findMany: jest.fn(async () => (opts.editorContents === undefined ? [] : opts.editorContents)),
      },
      teamContent: {
        findMany: jest.fn(async () => (opts.teamContents === undefined ? [] : opts.teamContents)),
      },
      editorKpi: { findMany: jest.fn(async () => []) },
      trafficReport: { findMany: jest.fn(async () => []) },
      revenueReport: { groupBy: jest.fn(async () => []) },
      contentLine: { findMany: jest.fn(async () => []) },
      editorDailyKpi: { findMany: jest.fn(async () => []) },
      productLine: { findMany: jest.fn(async () => []) },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any);
    return { service, prisma };
  }

  async function memberOf(result: any, userId: string) {
    return result.members.find((m: any) => m.user_id === userId);
  }

  afterEach(() => jest.clearAllMocks());

  it('content thêm vào kho trong đúng kỳ đang xem (qua content_id) → tính là "mới"', async () => {
    const { service } = build({
      taskRows: [
        {
          assignee_id: 'creator-1',
          created_at: TASK_CREATED_AT,
          content_id: 'c-1',
          editor_content_id: null,
          team_content_id: null,
        },
      ],
      contents: [{ id: 'c-1', created_at: IN_PERIOD_CONTENT }],
    });

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);
    const member = await memberOf(result, 'creator-1');

    expect(member.content_new).toBe(1);
    expect(member.content_old).toBe(0);
  });

  it('content được thêm từ TRƯỚC kỳ đang xem (qua team_content_id) → tính là "cũ"', async () => {
    const { service } = build({
      taskRows: [
        {
          assignee_id: 'creator-1',
          created_at: TASK_CREATED_AT,
          content_id: null,
          editor_content_id: null,
          team_content_id: 'tc-1',
        },
      ],
      teamContents: [{ id: 'tc-1', added_at: BEFORE_PERIOD_CONTENT }],
    });

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);
    const member = await memberOf(result, 'creator-1');

    expect(member.content_new).toBe(0);
    expect(member.content_old).toBe(1);
  });

  it('lấy ngày qua editor_content_id khi đó là field duy nhất được set', async () => {
    const { service } = build({
      taskRows: [
        {
          assignee_id: 'creator-1',
          created_at: TASK_CREATED_AT,
          content_id: null,
          editor_content_id: 'ec-1',
          team_content_id: null,
        },
      ],
      editorContents: [{ id: 'ec-1', added_at: IN_PERIOD_CONTENT }],
    });

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);
    const member = await memberOf(result, 'creator-1');

    expect(member.content_new).toBe(1);
  });

  it('task không có assignee → bị bỏ qua, không tính vào ai cả', async () => {
    const { service } = build({
      taskRows: [
        {
          assignee_id: null,
          created_at: TASK_CREATED_AT,
          content_id: 'c-1',
          editor_content_id: null,
          team_content_id: null,
        },
      ],
      contents: [{ id: 'c-1', created_at: IN_PERIOD_CONTENT }],
    });

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);
    const member = await memberOf(result, 'creator-1');

    expect(member.content_new).toBe(0);
    expect(member.content_old).toBe(0);
  });

  it('task không gắn content nào (hoặc content bị xoá/thiếu liên kết) → tính là "cũ", không bị loại khỏi mẫu số', async () => {
    const { service } = build({
      taskRows: [
        {
          assignee_id: 'creator-1',
          created_at: TASK_CREATED_AT,
          content_id: 'c-deleted',
          editor_content_id: null,
          team_content_id: null,
        },
      ],
      contents: [], // c-deleted không tồn tại trong bảng content nữa
    });

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);
    const member = await memberOf(result, 'creator-1');

    expect(member.content_new).toBe(0);
    expect(member.content_old).toBe(1);
  });

  it('gộp đúng nhiều task cho cùng 1 assignee, cả mới lẫn cũ (kể cả task không gắn content)', async () => {
    const { service } = build({
      taskRows: [
        { assignee_id: 'creator-1', created_at: TASK_CREATED_AT, content_id: 'c-1', editor_content_id: null, team_content_id: null },
        { assignee_id: 'creator-1', created_at: TASK_CREATED_AT, content_id: 'c-2', editor_content_id: null, team_content_id: null },
        { assignee_id: 'creator-1', created_at: TASK_CREATED_AT, content_id: 'c-3', editor_content_id: null, team_content_id: null },
        { assignee_id: 'creator-1', created_at: TASK_CREATED_AT, content_id: null, editor_content_id: null, team_content_id: null },
      ],
      contents: [
        { id: 'c-1', created_at: IN_PERIOD_CONTENT },
        { id: 'c-2', created_at: IN_PERIOD_CONTENT },
        { id: 'c-3', created_at: BEFORE_PERIOD_CONTENT },
      ],
    });

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);
    const member = await memberOf(result, 'creator-1');

    expect(member.content_new).toBe(2);
    expect(member.content_old).toBe(2);
  });
});
