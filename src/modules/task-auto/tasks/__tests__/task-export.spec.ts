import * as ExcelJS from 'exceljs';

// computeEditorKpiActuals() đã có test riêng ở module kpi — ở đây chỉ kiểm tra gọi đúng dòng KPI.
jest.mock('../../kpi/editor-kpi-actuals.util', () => ({
  ...jest.requireActual('../../kpi/editor-kpi-actuals.util'),
  computeEditorKpiActuals: jest.fn(async () => new Map()),
}));

import {
  computeEditorKpiActuals,
  editorKpiActualKey,
  emptyEditorKpiActuals,
} from '../../kpi/editor-kpi-actuals.util';
import { TaskExportService } from '../task-export.service';
import { TaskAutoTasksService } from '../tasks.service';

const computeActuals = computeEditorKpiActuals as jest.Mock;

/**
 * Điểm dễ vỡ: (1) file theo đúng bộ lọc trên màn hình, luôn ép APPROVED và bỏ cờ "quá hạn"; (2) mỗi
 * người 1 sheet; (3) bảng KPI cùng số với tab KPI và không lộ KPI ngoài phạm vi người xuất.
 */
describe('TaskExportService.exportApprovedTasks — xuất task đã hoàn thành theo bộ lọc', () => {
  beforeEach(() => computeActuals.mockReset().mockResolvedValue(new Map()));

  function build(taskRows: any[], kpis: any[] = [], goals: any[] = []) {
    const prisma: any = {
      task: { findMany: jest.fn(async () => taskRows) },
      // describeFilters() tra tên team/người thực hiện để ghi vào khối tiêu đề — mặc định không có gì.
      team: { findMany: jest.fn(async () => []) },
      user: { findUnique: jest.fn(async () => null) },
      editorKpi: { findMany: jest.fn(async () => kpis) },
      // KPI thêm & OKR (performance_goals) cùng khoá người/team/tháng.
      performanceGoal: { findMany: jest.fn(async () => goals) },
      // Tên các tuyến có video nhưng không nằm trong phân bổ KPI.
      contentLine: { findMany: jest.fn(async () => []) },
    };
    const tasks = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const service = new TaskExportService(prisma, tasks);
    return { service, prisma, tasks };
  }

  const taskRow = (over: Partial<any> = {}) => ({
    id: 't-1',
    assignee_id: 'u-a',
    assignee: { full_name: 'Nguyễn Văn A', email: 'a@x.com' },
    content_line: { name: 'Tuyến 1' },
    product_line: { name: 'GMV' },
    editor_content: { code: 'CT-01', title: 'Content một', classification: { name: 'Mới' } },
    deadline: new Date('2026-09-10T03:00:00Z'),
    reviewed_at: new Date('2026-09-09T07:00:00Z'),
    created_at: new Date('2026-09-07T03:00:00Z'),
    published_links: [{ platform: 'FACEBOOK', url: 'https://fb/1', stats: { views: 1000 } }],
    ...over,
  });

  const kpiRow = (over: Partial<any> = {}) => ({
    id: 'k-1',
    user_id: 'u-a',
    team_id: 'team-1',
    month: '2026-09',
    total_target: 20,
    content_new: 5,
    content_paast_analyzed: 0,
    content_win_cover: 0,
    product_gmv: 0,
    product_traffic: 0,
    product_profit: 0,
    product_collect_test_win: 0,
    team: { name: 'Team K1' },
    set_by: { full_name: 'Leader B' },
    ...over,
  });

  const goalRow = (over: Partial<any> = {}) => ({
    id: 'g-1',
    user_id: 'u-a',
    team_id: 'team-1',
    month: '2026-09',
    type: 'KPI',
    title: 'Phát triển concept mới',
    description: null,
    metric_type: 'NUMBER',
    unit: null,
    direction: 'AT_LEAST',
    target_value: 10,
    actual_system: null,
    actual_manual: null,
    pass_threshold_pct: 80,
    status: 'PUBLISHED',
    team: { name: 'Team K1' },
    set_by: { full_name: 'Leader B' },
    kpi_group: { id: 'grp-content', name: 'Content', color: 'GREEN', sort_order: 20 },
    ...over,
  });

  async function load(buffer: Buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    return wb;
  }
  const values = (ws: ExcelJS.Worksheet, n: number) => (ws.getRow(n).values as any[]).slice(1);
  /** Số dòng đầu tiên thoả điều kiện, 0 nếu không có. */
  function findRow(ws: ExcelJS.Worksheet, match: (v: any[]) => boolean): number {
    for (let n = 1; n <= ws.rowCount; n++) if (match(values(ws, n))) return n;
    return 0;
  }
  const taskHeaderRow = (ws: ExcelJS.Worksheet) => findRow(ws, (v) => v[0] === 'STT' && v[1] === 'Tiêu đề');
  /** Các dòng task của sheet (sau dòng header bảng task). */
  function taskRows(ws: ExcelJS.Worksheet): any[][] {
    const header = taskHeaderRow(ws);
    const out: any[][] = [];
    for (let n = header + 1; n <= ws.rowCount; n++) out.push(values(ws, n));
    return out;
  }
  const kpiRowOf = (ws: ExcelJS.Worksheet, label: string) => values(ws, findRow(ws, (v) => v[1] === label));
  const kpiWhere = (prisma: any) => prisma.editorKpi.findMany.mock.calls[0][0].where;

  it('ép status APPROVED và bỏ cờ quá hạn, nhưng giữ nguyên mọi bộ lọc còn lại', async () => {
    const { service, prisma } = build([]);

    await service.exportApprovedTasks({
      status: 'SUBMITTED' as any, // ô Trạng thái trên màn hình KHÔNG được lái file xuất ra
      overdue: 'true',
      exclude_overdue: 'true',
      team_id: 'team-1',
      assignee_id: 'user-1',
      search: 'nhẫn',
      deadline_from: '2026-09-01',
      deadline_to: '2026-09-30',
    } as any);

    const where = prisma.task.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('APPROVED');
    expect(where.team_id).toBe('team-1');
    expect(where.assignee_id).toBe('user-1');
    expect(where.content).toEqual({ title: { contains: 'nhẫn', mode: 'insensitive' } });
    // Còn cờ overdue thì AND sẽ có {status: {notIn: [APPROVED, CANCELLED]}} → mâu thuẫn, file rỗng.
    expect(JSON.stringify(where.AND)).not.toContain('notIn');
    expect(where.AND).toEqual([
      {
        OR: [
          { deadline: { gte: new Date('2026-09-01T00:00:00+07:00'), lte: new Date('2026-09-30T23:59:59.999+07:00') } },
          { deadline: null, created_at: { gte: new Date('2026-09-01T00:00:00+07:00'), lte: new Date('2026-09-30T23:59:59.999+07:00') } },
        ],
      },
    ]);
  });

  it('lọc theo NGÀY DUYỆT (tab "Video đã nộp") đi thẳng vào reviewed_at', async () => {
    const { service, prisma } = build([]);

    await service.exportApprovedTasks({ reviewed_from: '2026-09-01', reviewed_to: '2026-09-14' } as any);

    expect(prisma.task.findMany.mock.calls[0][0].where.reviewed_at).toEqual({
      gte: new Date('2026-09-01T00:00:00+07:00'),
      lte: new Date('2026-09-14T23:59:59.999+07:00'),
    });
  });

  it('mỗi người thực hiện 1 sheet (tên sheet = tên người, sắp theo tên), chỉ chứa task của người đó', async () => {
    const { service } = build([
      taskRow({ id: 't-b1', assignee_id: 'u-b', assignee: { full_name: 'Trần Thị B', email: 'b@x.com' }, editor_content: { title: 'Việc của B' } }),
      taskRow({ id: 't-a1', editor_content: { title: 'Việc 1 của A' } }),
      taskRow({ id: 't-a2', editor_content: { title: 'Việc 2 của A' } }),
    ]);

    const wb = await load((await service.exportApprovedTasks({} as any)).buffer);

    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Nguyễn Văn A', 'Trần Thị B']);
    const [a, b] = wb.worksheets;
    expect(taskRows(a).map((r) => r[1])).toEqual(['Việc 1 của A', 'Việc 2 của A']);
    expect(taskRows(b).map((r) => r[1])).toEqual(['Việc của B']);
    expect(String(a.getRow(1).getCell(1).value)).toBe('Nguyễn Văn A  (a@x.com)');
    expect(String(a.getRow(2).getCell(1).value)).toContain('2 task đã hoàn thành');
  });

  it('bảng task chỉ còn 6 cột cơ bản: tiêu đề, tuyến nội dung, dòng sản phẩm, phân loại content, link bài đăng', async () => {
    const { service } = build([
      taskRow(),
      // Task chưa gắn dòng sản phẩm → lấy theo dòng của sản phẩm (như resolveTaskProductLineId).
      taskRow({
        id: 't-2',
        product_line: null,
        editor_product: { product_line: { name: 'Traffic' } },
        editor_content: null,
        team_content: { title: 'Content team', classification: { name: 'Phân tích theo PAAST' } },
      }),
    ]);

    const ws = (await load((await service.exportApprovedTasks({} as any)).buffer)).worksheets[0];

    expect(values(ws, taskHeaderRow(ws))).toEqual([
      'STT', 'Tiêu đề', 'Tuyến nội dung', 'Dòng sản phẩm', 'Phân loại content', 'Link bài đăng',
    ]);
    const [r1, r2] = taskRows(ws);
    expect(r1.slice(0, 5)).toEqual([1, 'Content một', 'Tuyến 1', 'GMV', 'Mới']);
    expect(r2.slice(0, 5)).toEqual([2, 'Content team', 'Tuyến 1', 'Traffic', 'Phân tích theo PAAST']);
  });

  it('danh sách task là Excel Table lọc/sắp xếp được theo từng cột, phủ từ header tới dòng cuối', async () => {
    const { service } = build([
      taskRow(),
      taskRow({ id: 't-2' }),
      taskRow({ id: 't-3', assignee_id: 'u-b', assignee: { full_name: 'Trần Thị B' } }),
    ]);

    const wb = await load((await service.exportApprovedTasks({} as any)).buffer);
    const ws = wb.worksheets[0];
    const tables = ws.getTables() as any[];
    const header = taskHeaderRow(ws);

    expect(tables).toHaveLength(1);
    const model = tables[0].table ?? tables[0].model;
    expect(model.tableRef).toBe(`A${header}:F${header + 2}`);
    expect(model.columns.map((c: any) => c.name)).toEqual([
      'STT', 'Tiêu đề', 'Tuyến nội dung', 'Dòng sản phẩm', 'Phân loại content', 'Link bài đăng',
    ]);
    expect(model.autoFilterRef).toBe(`A${header}:F${header + 2}`);
    // Tên Table phải duy nhất trong cả workbook — trùng là Excel báo file lỗi.
    expect((wb.worksheets[1].getTables() as any[])[0].name).not.toBe(tables[0].name);
    // Đã có filter của Table thì KHÔNG được có thêm auto-filter cấp sheet (Excel đòi sửa file).
    expect(ws.autoFilter).toBeUndefined();
  });

  it('chữ to, dễ đọc: font Arial, nội dung ≥ 12pt, tiêu đề lớn hơn; tiêu đề dài thì dòng tự cao lên', async () => {
    const longTitle = 'Một tiêu đề content rất dài '.repeat(6).trim();
    const { service } = build([taskRow(), taskRow({ id: 't-2', editor_content: { title: longTitle } })]);

    const ws = (await load((await service.exportApprovedTasks({} as any)).buffer)).worksheets[0];
    const first = ws.getRow(taskHeaderRow(ws) + 1);
    const second = ws.getRow(taskHeaderRow(ws) + 2);

    expect(first.getCell(2).font).toMatchObject({ name: 'Arial', size: 12 });
    expect(ws.getRow(1).getCell(1).font.size).toBeGreaterThanOrEqual(18);
    expect(second.height).toBeGreaterThan(first.height);
  });

  it('link bài đăng: 1 link là hyperlink bấm được; nhiều link thì mỗi link 1 dòng trong ô', async () => {
    const { service } = build([
      taskRow(),
      taskRow({
        id: 't-2',
        published_links: [
          { platform: 'FACEBOOK', url: 'https://fb/2' },
          { platform: 'YOUTUBE', url: 'https://yt/2' },
        ],
      }),
    ]);

    const ws = (await load((await service.exportApprovedTasks({} as any)).buffer)).worksheets[0];
    const first = ws.getRow(taskHeaderRow(ws) + 1).getCell(6);
    const second = ws.getRow(taskHeaderRow(ws) + 2).getCell(6);

    expect((first.value as any).hyperlink).toBe('https://fb/1');
    expect(first.font?.underline).toBe(true);
    expect(second.value).toBe('https://fb/2\nhttps://yt/2');
  });

  it('bảng KPI: mục tiêu từ editor_kpis, thực đạt từ computeEditorKpiActuals, kèm tỷ lệ và đánh giá', async () => {
    const { service, prisma } = build([taskRow()], [kpiRow()]);
    computeActuals.mockResolvedValue(
      new Map([
        [
          editorKpiActualKey('2026-09', 'u-a', 'team-1'),
          { ...emptyEditorKpiActuals(), total_actual: 20, content_new_actual: 2, product_gmv_actual: 3 },
        ],
      ]),
    );

    const ws = (
      await load((await service.exportApprovedTasks({ deadline_from: '2026-09-01', deadline_to: '2026-09-30' } as any)).buffer)
    ).worksheets[0];

    expect(kpiWhere(prisma).AND[0]).toEqual({ user_id: { in: ['u-a'] }, month: { in: ['2026-09'] } });
    const title = String(ws.getRow(findRow(ws, (v) => String(v[0]).startsWith('Tháng 09/2026'))).getCell(1).value);
    expect(title).toContain('Nhóm: Team K1');
    expect(title).toContain('Người đặt: Leader B');

    expect(kpiRowOf(ws, 'Tổng video sản xuất')).toEqual([1, 'Tổng video sản xuất', 20, 20, 1, 'Đạt']);
    expect(kpiRowOf(ws, 'Content mới làm được')).toEqual([2, 'Content mới làm được', 5, 2, 0.4, 'Chưa đạt — còn thiếu 3']);
    // Mục tiêu 0 → không có tỷ lệ, không phán "chưa đạt" — nhưng vẫn hiện số thực đạt.
    const gmv = kpiRowOf(ws, 'Số sản phẩm GMV');
    expect(gmv[2]).toBe(0);
    expect(gmv[3]).toBe(3);
    expect(gmv[4]).toBeUndefined();
    expect(gmv[5]).toBe('Chưa đặt mục tiêu');
    // Bảng KPI nằm TRÊN bảng task.
    expect(findRow(ws, (v) => v[1] === 'Tổng video sản xuất')).toBeLessThan(taskHeaderRow(ws));
  });

  it('mục sản xuất video tách tiến độ theo tuyến nội dung: mục tiêu = phân bổ trong KPI, thực đạt = video đã duyệt của tuyến', async () => {
    const { service, prisma } = build(
      [taskRow()],
      [
        kpiRow({
          allocations: [
            { content_line_id: 'cl-a2', quantity: 8, content_line: { name: 'A2' } },
            { content_line_id: 'cl-a1', quantity: 12, content_line: { name: 'A1' } },
          ],
        }),
      ],
    );
    prisma.contentLine.findMany = jest.fn(async () => [{ id: 'cl-a3', name: 'A3' }]);
    computeActuals.mockResolvedValue(
      new Map([
        [
          editorKpiActualKey('2026-09', 'u-a', 'team-1'),
          // 12 + 1 + 1 video có tuyến, 1 video chưa gắn tuyến.
          { ...emptyEditorKpiActuals(), total_actual: 15, content_line_actuals: { 'cl-a1': 12, 'cl-a2': 1, 'cl-a3': 1 } },
        ],
      ]),
    );

    const ws = (
      await load((await service.exportApprovedTasks({ deadline_from: '2026-09-01', deadline_to: '2026-09-30' } as any)).buffer)
    ).worksheets[0];

    expect(prisma.editorKpi.findMany.mock.calls[0][0].include.allocations.where).toEqual({ type: 'CONTENT_LINE' });
    const total = findRow(ws, (v) => v[1] === 'Tổng video sản xuất');
    // Ngay dưới dòng tổng, sắp theo tên tuyến; các dòng con cộng lại = số thực đạt của dòng tổng.
    expect([1, 2, 3, 4].map((i) => values(ws, total + i))).toEqual([
      ['1.1', 'Tuyến A1', 12, 12, 1, 'Đạt'],
      ['1.2', 'Tuyến A2', 8, 1, 0.125, 'Chưa đạt — còn thiếu 7'],
      ['1.3', 'Tuyến A3', '—', 1, undefined, 'Chưa phân bổ mục tiêu'],
      ['1.4', 'Chưa gắn tuyến nội dung', '—', 1, undefined, 'Task chưa chọn tuyến nội dung'],
    ]);
    expect(String(values(ws, total + 5)[0])).toBe('Content');
    expect(kpiRowOf(ws, 'Content mới làm được')[0]).toBe(2); // đánh số chỉ tiêu chính không bị xô lệch
  });

  it('tháng chưa đặt KPI → vẫn có bảng với số thực đạt, cột mục tiêu để "—"', async () => {
    const { service } = build([taskRow()], []);
    computeActuals.mockResolvedValue(
      new Map([[editorKpiActualKey('2026-09', 'u-a', null), { ...emptyEditorKpiActuals(), total_actual: 7 }]]),
    );

    const ws = (
      await load((await service.exportApprovedTasks({ deadline_from: '2026-09-01', deadline_to: '2026-09-30' } as any)).buffer)
    ).worksheets[0];

    // Không lọc team → số thực đạt gộp mọi team (bucket team_id null, như dòng KPI legacy).
    expect(computeActuals.mock.calls[0][1]).toEqual([{ month: '2026-09', user_id: 'u-a', team_id: null }]);
    expect(String(ws.getRow(findRow(ws, (v) => String(v[0]).startsWith('Tháng 09/2026'))).getCell(1).value))
      .toContain('Chưa có KPI tháng này');
    expect(kpiRowOf(ws, 'Tổng video sản xuất')).toEqual([1, 'Tổng video sản xuất', '—', 7, undefined, 'Chưa đặt mục tiêu']);
  });

  it('tháng KPI theo khoảng ngày đang lọc; không lọc ngày thì theo tháng của task (mới → cũ, lấp tháng trống)', async () => {
    const ranged = build([taskRow()]);
    await ranged.service.exportApprovedTasks({ reviewed_from: '2026-08-15', reviewed_to: '2026-09-10' } as any);
    expect(kpiWhere(ranged.prisma).AND[0].month).toEqual({ in: ['2026-09', '2026-08'] });

    // Trục tháng của task = deadline, chưa đặt hạn → ngày tạo (đúng trục tab KPI xếp task vào tháng).
    const open = build([
      taskRow({ id: 't-sep' }),
      taskRow({ id: 't-jul', deadline: null, created_at: new Date('2026-07-20T03:00:00Z') }),
    ]);
    await open.service.exportApprovedTasks({} as any);
    expect(kpiWhere(open.prisma).AND[0].month).toEqual({ in: ['2026-09', '2026-08', '2026-07'] });
  });

  it('lọc 1 team → chỉ lấy KPI đặt cho team đó, số thực đạt của tháng chưa có KPI cũng theo team đó', async () => {
    const { service, prisma } = build([taskRow()], []);

    await service.exportApprovedTasks({ team_id: 'team-1', deadline_from: '2026-09-01', deadline_to: '2026-09-30' } as any);

    expect(kpiWhere(prisma).AND).toContainEqual({ team_id: 'team-1' });
    expect(computeActuals.mock.calls[0][1]).toEqual([{ month: '2026-09', user_id: 'u-a', team_id: 'team-1' }]);
  });

  // Endpoint export không có guard theo role — file KHÔNG được là đường vòng để xem mục tiêu KPI mà
  // tab KPI (getEditorKpis) đang chặn.
  it('phạm vi KPI theo quyền: admin/manager xem hết, leader chỉ team mình lead, member chỉ KPI của mình', async () => {
    const q = { deadline_from: '2026-09-01', deadline_to: '2026-09-30' } as any;

    const admin = build([taskRow()]);
    await admin.service.exportApprovedTasks(q, { id: 'admin-1', roles: ['ADMIN'] });
    expect(kpiWhere(admin.prisma).AND).toHaveLength(2);
    expect(kpiWhere(admin.prisma).AND[1]).toEqual({});

    const leader = build([taskRow()]);
    leader.prisma.team.findMany = jest.fn(async () => [{ id: 'team-1' }, { id: 'team-2' }]);
    await leader.service.exportApprovedTasks(q, { id: 'leader-1', roles: ['LEADER'] });
    expect(leader.prisma.team.findMany).toHaveBeenCalledWith({ where: { leader_id: 'leader-1' }, select: { id: true } });
    expect(kpiWhere(leader.prisma).AND[1]).toEqual({ team_id: { in: ['team-1', 'team-2'] } });

    const member = build([taskRow()]);
    await member.service.exportApprovedTasks(q, { id: 'u-a', roles: ['MEMBER'] });
    expect(kpiWhere(member.prisma).AND[1]).toEqual({ user_id: 'u-a' });
  });

  it('bảng KPI có thêm KPI thêm (theo nhóm) và OKR sau 8 chỉ tiêu cố định, đạt khi ≥ 80% mục tiêu', async () => {
    const { service, prisma } = build(
      [taskRow()],
      [kpiRow()],
      [
        goalRow({ id: 'g-1', title: 'Phát triển concept mới', unit: 'concept', actual_manual: 8 }),
        goalRow({ id: 'g-2', title: 'Viết kịch bản dài', actual_manual: 5, description: 'Kịch bản trên 3 phút' }),
        goalRow({
          id: 'g-3',
          title: 'Tỷ lệ video bị trả lại',
          unit: '%',
          direction: 'AT_MOST',
          target_value: 4,
          actual_manual: 10,
          kpi_group: { id: 'grp-custom', name: 'Chất lượng & kỷ luật', color: 'ROSE', sort_order: 100 },
        }),
        goalRow({ id: 'g-4', type: 'OKR', title: 'Ra mắt kênh TikTok mới', target_value: 1, actual_manual: 1, kpi_group: null }),
        goalRow({ id: 'g-5', type: 'OKR', title: 'Đào tạo 2 editor mới', target_value: 2, kpi_group: null }),
      ],
    );

    const ws = (
      await load((await service.exportApprovedTasks({ deadline_from: '2026-09-01', deadline_to: '2026-09-30' } as any)).buffer)
    ).worksheets[0];

    // Cùng khoá + cùng phạm vi quyền với KPI cố định, bỏ đầu mục đã lưu trữ.
    const goalWhere = prisma.performanceGoal.findMany.mock.calls[0][0].where;
    expect(goalWhere.AND).toEqual([...kpiWhere(prisma).AND, { status: { not: 'ARCHIVED' } }]);

    const banner = (text: string) => findRow(ws, (v) => String(v[0]).startsWith(text));
    // Nhóm xếp theo thứ tự nhóm KPI (Content 20 → nhóm tự tạo 100), OKR luôn ở cuối.
    expect(banner('KPI thêm · Content')).toBeGreaterThan(findRow(ws, (v) => v[1] === 'Số sản phẩm sưu tầm và test win'));
    expect(banner('KPI thêm · Chất lượng & kỷ luật')).toBeGreaterThan(banner('KPI thêm · Content'));
    expect(banner('OKR')).toBeGreaterThan(banner('KPI thêm · Chất lượng & kỷ luật'));
    // Tiến độ chung mỗi phần: trung bình không trọng số, mỗi mục cap 100%.
    expect(String(values(ws, banner('KPI thêm · Content'))[0])).toContain('Tiến độ chung 65%  ·  đạt 1/2');
    expect(String(values(ws, banner('OKR'))[0])).toContain('Tiến độ chung 50%  ·  đạt 1/2');

    // Số thứ tự nối tiếp 8 chỉ tiêu cố định; 8/10 = 80% → đạt (KHÁC chỉ tiêu cố định cần 100%).
    const concept = findRow(ws, (v) => v[1] === 'Phát triển concept mới');
    expect(values(ws, concept)).toEqual([9, 'Phát triển concept mới', 10, 8, 0.8, 'Đạt']);
    // Đơn vị hiện ngay sau số nhưng ô vẫn là số.
    expect(ws.getRow(concept).getCell(3).numFmt).toBe('#,##0" concept"');

    // Có mô tả → xuống dòng trong cùng ô; "còn thiếu" tính tới ngưỡng 80%, không tới 100%.
    const script = values(ws, concept + 1);
    expect(script[1].richText.map((r: any) => r.text)).toEqual(['Viết kịch bản dài', '\nKịch bản trên 3 phút']);
    expect(script.slice(2)).toEqual([10, 5, 0.5, 'Chưa đạt — còn thiếu 3 để đạt 80%']);

    // Càng thấp càng tốt: tỷ lệ = mục tiêu / thực đạt. Đơn vị "%" ghi kèm tên, không vào numFmt.
    const lowerLabel = 'Tỷ lệ video bị trả lại (%) (càng thấp càng tốt)';
    expect(kpiRowOf(ws, lowerLabel)).toEqual([11, lowerLabel, 4, 10, 0.4, 'Chưa đạt — cần giảm xuống ≤ 5%']);
    expect(ws.getRow(findRow(ws, (v) => v[1] === lowerLabel)).getCell(3).numFmt).toBe('#,##0');

    expect(kpiRowOf(ws, 'Ra mắt kênh TikTok mới')).toEqual([12, 'Ra mắt kênh TikTok mới', 1, 1, 1, 'Đạt']);
    // Chưa nhập thực đạt → không phán đạt/chưa đạt.
    const pending = kpiRowOf(ws, 'Đào tạo 2 editor mới');
    expect(pending[3]).toBe('—');
    expect(pending[4]).toBeUndefined();
    expect(pending[5]).toBe('Chưa nhập số thực đạt');
  });

  it('bản nháp vẫn in (đánh dấu) nhưng không tính vào tiến độ chung; KPI cũ chưa có nhóm vào "KPI bổ sung"', async () => {
    const { service } = build(
      [taskRow()],
      [kpiRow()],
      [
        goalRow({ id: 'g-1', kpi_group: null, actual_manual: 10 }),
        goalRow({ id: 'g-2', kpi_group: null, title: 'Mục nháp', status: 'DRAFT', actual_manual: 0 }),
      ],
    );

    const ws = (
      await load((await service.exportApprovedTasks({ deadline_from: '2026-09-01', deadline_to: '2026-09-30' } as any)).buffer)
    ).worksheets[0];

    expect(String(values(ws, findRow(ws, (v) => String(v[0]).startsWith('KPI thêm · KPI bổ sung')))[0]))
      .toContain('Tiến độ chung 100%  ·  đạt 1/1');
    expect(findRow(ws, (v) => v[1] === 'Mục nháp (bản nháp)')).toBeGreaterThan(0);
  });

  it('team chỉ có KPI thêm/OKR, chưa đặt KPI cố định → vẫn có bảng riêng của team đó, không mất đầu mục', async () => {
    const { service } = build(
      [taskRow()],
      [kpiRow()],
      [goalRow({ team_id: 'team-2', team: { name: 'Team K2' }, set_by: { full_name: 'Leader C' }, type: 'OKR', kpi_group: null })],
    );

    const ws = (
      await load((await service.exportApprovedTasks({ deadline_from: '2026-09-01', deadline_to: '2026-09-30' } as any)).buffer)
    ).worksheets[0];

    // Số thực đạt KPI cố định của bảng mới tính theo đúng team của đầu mục.
    expect(computeActuals.mock.calls[0][1]).toContainEqual({ month: '2026-09', user_id: 'u-a', team_id: 'team-2' });
    const headers = [];
    for (let n = 1; n <= ws.rowCount; n++) if (String(values(ws, n)[0]).startsWith('Tháng 09/2026')) headers.push(String(values(ws, n)[0]));
    expect(headers).toHaveLength(2);
    expect(headers[0]).toContain('Nhóm: Team K1');
    expect(headers[1]).toContain('Nhóm: Team K2');
    expect(headers[1]).toContain('Người đặt: Leader C');
    expect(headers[1]).toContain('Chưa đặt KPI cố định');
    // Đầu mục nằm dưới bảng Team K2, không lẫn vào bảng Team K1.
    expect(findRow(ws, (v) => v[1] === 'Phát triển concept mới')).toBeGreaterThan(
      findRow(ws, (v) => String(v[0]).includes('Nhóm: Team K2')),
    );
  });

  it('tên sheet hợp lệ với Excel: bỏ ký tự cấm, tối đa 31 ký tự, trùng tên thì thêm (2)', async () => {
    const { service } = build([
      taskRow({ id: 't-1', assignee_id: 'u-1', assignee: { full_name: 'Team A/B: [Lead]' } }),
      taskRow({ id: 't-2', assignee_id: 'u-2', assignee: { full_name: 'Nguyễn Văn A' } }),
      taskRow({ id: 't-3', assignee_id: 'u-3', assignee: { full_name: 'Nguyễn Văn A' } }),
      taskRow({ id: 't-4', assignee_id: 'u-4', assignee: { full_name: 'Một cái tên rất rất dài vượt quá ba mươi mốt ký tự' } }),
    ]);

    const wb = await load((await service.exportApprovedTasks({} as any)).buffer);
    const names = wb.worksheets.map((ws) => ws.name);

    expect(names).toEqual(
      expect.arrayContaining(['Team A B Lead', 'Nguyễn Văn A', 'Nguyễn Văn A (2)', 'Một cái tên rất rất dài vượt qu']),
    );
    names.forEach((n) => expect(n.length).toBeLessThanOrEqual(31));
  });

  it('không có task nào khớp → vẫn ra file hợp lệ kèm dòng giải thích, không phải file trắng', async () => {
    const { service, prisma } = build([]);

    const wb = await load((await service.exportApprovedTasks({} as any)).buffer);

    expect(wb.worksheets).toHaveLength(1);
    const ws = wb.worksheets[0];
    expect(String(ws.getRow(1).getCell(1).value)).toBe('DANH SÁCH TASK ĐÃ HOÀN THÀNH');
    expect(findRow(ws, (v) => String(v[0]).includes('Không có task đã hoàn thành nào khớp bộ lọc'))).toBeGreaterThan(0);
    expect(prisma.editorKpi.findMany).not.toHaveBeenCalled();
  });

  it('đọc theo mẻ: mẻ cuối ngắn hơn chunk thì dừng, không quét tiếp tới trần', async () => {
    const { service, prisma } = build([taskRow()]);

    await service.exportApprovedTasks({} as any);

    expect(prisma.task.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.task.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 1000 });
  });

  it('tên file kèm khoảng ngày đang lọc để không đè lên file xuất trước đó', async () => {
    const { service } = build([]);

    const { filename } = await service.exportApprovedTasks({
      reviewed_from: '2026-09-01',
      reviewed_to: '2026-09-14',
    } as any);

    expect(filename).toContain('2026-09-01_2026-09-14');
    expect(filename).toMatch(/^task-da-hoan-thanh_2026-09-01_2026-09-14_\d{8}-\d{4}\.xlsx$/);
  });
});
