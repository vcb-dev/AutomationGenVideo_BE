import { TaskAutoTasksService } from '../tasks.service';

/**
 * getContentFreshnessByAssignee() (private, gọi qua getDashboard/getTeamReport) — "content mới"
 * vs "content cũ": so ngày tạo content đã dùng trong task (Content.created_at / EditorContent.added_at
 * / TeamContent.added_at — đúng 1 trong 3 field được set trên mỗi task) với ngày tạo task, theo
 * NGÀY LỊCH VN. Cùng ngày → "mới" (editor vừa tạo content rồi dùng ngay); khác ngày → "cũ" (tiêu
 * thụ tồn kho có sẵn). Xem comment gốc tại tasks.service.ts.
 */
describe('TaskAutoTasksService — content_new / content_old (qua getDashboard)', () => {
  // Cùng ngày lịch VN (UTC+7): 04:00Z là 11:00 giờ VN, an toàn giữa ngày, không lệch ranh giới.
  const SAME_DAY_TASK = new Date('2026-08-12T04:00:00Z');
  const SAME_DAY_CONTENT = new Date('2026-08-12T02:00:00Z'); // 09:00 VN cùng ngày 12/08
  const PREV_DAY_CONTENT = new Date('2026-08-11T04:00:00Z'); // 11:00 VN ngày 11/08 — trước 1 ngày

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
      trafficReport: { groupBy: jest.fn(async () => []) },
      revenueReport: { groupBy: jest.fn(async () => []) },
      contentLine: { findMany: jest.fn(async () => []) },
      editorDailyKpi: { findMany: jest.fn(async () => []) },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any);
    return { service, prisma };
  }

  async function memberOf(result: any, userId: string) {
    return result.members.find((m: any) => m.user_id === userId);
  }

  afterEach(() => jest.clearAllMocks());

  it('content dùng đúng ngày task tạo (qua content_id) → tính là "mới"', async () => {
    const { service } = build({
      taskRows: [
        {
          assignee_id: 'creator-1',
          created_at: SAME_DAY_TASK,
          content_id: 'c-1',
          editor_content_id: null,
          team_content_id: null,
        },
      ],
      contents: [{ id: 'c-1', created_at: SAME_DAY_CONTENT }],
    });

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);
    const member = await memberOf(result, 'creator-1');

    expect(member.content_new).toBe(1);
    expect(member.content_old).toBe(0);
  });

  it('content được thêm từ trước (qua team_content_id) → tính là "cũ"', async () => {
    const { service } = build({
      taskRows: [
        {
          assignee_id: 'creator-1',
          created_at: SAME_DAY_TASK,
          content_id: null,
          editor_content_id: null,
          team_content_id: 'tc-1',
        },
      ],
      teamContents: [{ id: 'tc-1', added_at: PREV_DAY_CONTENT }],
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
          created_at: SAME_DAY_TASK,
          content_id: null,
          editor_content_id: 'ec-1',
          team_content_id: null,
        },
      ],
      editorContents: [{ id: 'ec-1', added_at: SAME_DAY_CONTENT }],
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
          created_at: SAME_DAY_TASK,
          content_id: 'c-1',
          editor_content_id: null,
          team_content_id: null,
        },
      ],
      contents: [{ id: 'c-1', created_at: SAME_DAY_CONTENT }],
    });

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);
    const member = await memberOf(result, 'creator-1');

    expect(member.content_new).toBe(0);
    expect(member.content_old).toBe(0);
  });

  it('content bị xoá/thiếu liên kết (không tra được ngày) → bị bỏ qua, không tính vào mẫu số', async () => {
    const { service } = build({
      taskRows: [
        {
          assignee_id: 'creator-1',
          created_at: SAME_DAY_TASK,
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
    expect(member.content_old).toBe(0);
  });

  it('gộp đúng nhiều task cho cùng 1 assignee, cả mới lẫn cũ', async () => {
    const { service } = build({
      taskRows: [
        { assignee_id: 'creator-1', created_at: SAME_DAY_TASK, content_id: 'c-1', editor_content_id: null, team_content_id: null },
        { assignee_id: 'creator-1', created_at: SAME_DAY_TASK, content_id: 'c-2', editor_content_id: null, team_content_id: null },
        { assignee_id: 'creator-1', created_at: SAME_DAY_TASK, content_id: 'c-3', editor_content_id: null, team_content_id: null },
      ],
      contents: [
        { id: 'c-1', created_at: SAME_DAY_CONTENT },
        { id: 'c-2', created_at: SAME_DAY_CONTENT },
        { id: 'c-3', created_at: PREV_DAY_CONTENT },
      ],
    });

    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);
    const member = await memberOf(result, 'creator-1');

    expect(member.content_new).toBe(2);
    expect(member.content_old).toBe(1);
  });
});
