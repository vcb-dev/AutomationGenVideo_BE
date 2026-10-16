import * as ExcelJS from 'exceljs';

jest.mock('../../../../utils/task-auto/editor-kpi-actuals.util', () => ({
  ...jest.requireActual('../../../../utils/task-auto/editor-kpi-actuals.util'),
  computeEditorKpiActuals: jest.fn(async () => new Map()),
}));

import {
  computeEditorKpiActuals,
  editorKpiActualKey,
  emptyEditorKpiActuals,
} from '../../../../utils/task-auto/editor-kpi-actuals.util';
import { TaskExportService } from '../task-export.service';

const computeActuals = computeEditorKpiActuals as jest.Mock;

describe('TaskExportService.exportApprovedTasks — xuất task đã hoàn thành theo bộ lọc', () => {
  beforeEach(() => computeActuals.mockReset().mockResolvedValue(new Map()));

  function build(taskRows: any[], kpis: any[] = [], goals: any[] = []) {
    const prisma: any = {
      task: { findMany: jest.fn(async () => taskRows) },
      team: { findMany: jest.fn(async () => []) },
      user: { findUnique: jest.fn(async () => null) },
      editorKpi: { findMany: jest.fn(async () => kpis) },
      performanceGoal: { findMany: jest.fn(async () => goals) },
      contentLine: { findMany: jest.fn(async () => []) },
    };
    const fbVideos: any = { getVideosByOwner: jest.fn(async () => new Map()) };
    const service = new TaskExportService(prisma, fbVideos);
    return { service, prisma, fbVideos };
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
  function findRow(ws: ExcelJS.Worksheet, match: (v: any[]) => boolean): number {
    for (let n = 1; n <= ws.rowCount; n++) if (match(values(ws, n))) return n;
    return 0;
  }
  const taskHeaderRow = (ws: ExcelJS.Worksheet) => findRow(ws, (v) => v[0] === 'STT' && v[1] === 'Tiêu đề');
  // Dòng của bảng bắt đầu ở `header`, dừng ở dòng trống đầu tiên (trước mục kế tiếp).
  function tableRows(ws: ExcelJS.Worksheet, header: number): any[][] {
    const out: any[][] = [];
    for (let n = header + 1; n <= ws.rowCount && values(ws, n).length; n++) out.push(values(ws, n));
    return out;
  }
  const taskRows = (ws: ExcelJS.Worksheet) => tableRows(ws, taskHeaderRow(ws));
  const videoHeaderRow = (ws: ExcelJS.Worksheet) => findRow(ws, (v) => v[0] === 'STT' && v[1] === 'Nội dung video');
  const kpiRowOf = (ws: ExcelJS.Worksheet, label: string) => values(ws, findRow(ws, (v) => v[1] === label));
  const kpiWhere = (prisma: any) => prisma.editorKpi.findMany.mock.calls[0][0].where;

  it('ép status APPROVED và bỏ cờ quá hạn, nhưng giữ nguyên mọi bộ lọc còn lại', async () => {
    const { service, prisma } = build([]);

    await service.exportApprovedTasks({
      status: 'SUBMITTED' as any,
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
    expect((wb.worksheets[1].getTables() as any[])[0].name).not.toBe(tables[0].name);
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
    const gmv = kpiRowOf(ws, 'Số sản phẩm GMV');
    expect(gmv[2]).toBe(0);
    expect(gmv[3]).toBe(3);
    expect(gmv[4]).toBeUndefined();
    expect(gmv[5]).toBe('Chưa đặt mục tiêu');
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
          { ...emptyEditorKpiActuals(), total_actual: 15, content_line_actuals: { 'cl-a1': 12, 'cl-a2': 1, 'cl-a3': 1 } },
        ],
      ]),
    );

    const ws = (
      await load((await service.exportApprovedTasks({ deadline_from: '2026-09-01', deadline_to: '2026-09-30' } as any)).buffer)
    ).worksheets[0];

    expect(prisma.editorKpi.findMany.mock.calls[0][0].include.allocations.where).toEqual({ type: 'CONTENT_LINE' });
    const total = findRow(ws, (v) => v[1] === 'Tổng video sản xuất');
    expect([1, 2, 3, 4].map((i) => values(ws, total + i))).toEqual([
      ['1.1', 'Tuyến A1', 12, 12, 1, 'Đạt'],
      ['1.2', 'Tuyến A2', 8, 1, 0.125, 'Chưa đạt — còn thiếu 7'],
      ['1.3', 'Tuyến A3', '—', 1, undefined, 'Chưa phân bổ mục tiêu'],
      ['1.4', 'Chưa gắn tuyến nội dung', '—', 1, undefined, 'Task chưa chọn tuyến nội dung'],
    ]);
    expect(String(values(ws, total + 5)[0])).toBe('Content');
    expect(kpiRowOf(ws, 'Content mới làm được')[0]).toBe(2);
  });

  it('tháng chưa đặt KPI → vẫn có bảng với số thực đạt, cột mục tiêu để "—"', async () => {
    const { service } = build([taskRow()], []);
    computeActuals.mockResolvedValue(
      new Map([[editorKpiActualKey('2026-09', 'u-a', null), { ...emptyEditorKpiActuals(), total_actual: 7 }]]),
    );

    const ws = (
      await load((await service.exportApprovedTasks({ deadline_from: '2026-09-01', deadline_to: '2026-09-30' } as any)).buffer)
    ).worksheets[0];

    expect(computeActuals.mock.calls[0][1]).toEqual([{ month: '2026-09', user_id: 'u-a', team_id: null }]);
    expect(String(ws.getRow(findRow(ws, (v) => String(v[0]).startsWith('Tháng 09/2026'))).getCell(1).value))
      .toContain('Chưa có KPI tháng này');
    expect(kpiRowOf(ws, 'Tổng video sản xuất')).toEqual([1, 'Tổng video sản xuất', '—', 7, undefined, 'Chưa đặt mục tiêu']);
  });

  it('tháng KPI theo khoảng ngày đang lọc; không lọc ngày thì theo tháng của task (mới → cũ, lấp tháng trống)', async () => {
    const ranged = build([taskRow()]);
    await ranged.service.exportApprovedTasks({ reviewed_from: '2026-08-15', reviewed_to: '2026-09-10' } as any);
    expect(kpiWhere(ranged.prisma).AND[0].month).toEqual({ in: ['2026-09', '2026-08'] });

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

    const goalWhere = prisma.performanceGoal.findMany.mock.calls[0][0].where;
    expect(goalWhere.AND).toEqual([...kpiWhere(prisma).AND, { status: { not: 'ARCHIVED' } }]);

    const banner = (text: string) => findRow(ws, (v) => String(v[0]).startsWith(text));
    expect(banner('KPI thêm · Content')).toBeGreaterThan(findRow(ws, (v) => v[1] === 'Số sản phẩm sưu tầm và test win'));
    expect(banner('KPI thêm · Chất lượng & kỷ luật')).toBeGreaterThan(banner('KPI thêm · Content'));
    expect(banner('OKR')).toBeGreaterThan(banner('KPI thêm · Chất lượng & kỷ luật'));
    expect(String(values(ws, banner('KPI thêm · Content'))[0])).toContain('Tiến độ chung 65%  ·  đạt 1/2');
    expect(String(values(ws, banner('OKR'))[0])).toContain('Tiến độ chung 50%  ·  đạt 1/2');

    const concept = findRow(ws, (v) => v[1] === 'Phát triển concept mới');
    expect(values(ws, concept)).toEqual([9, 'Phát triển concept mới', 10, 8, 0.8, 'Đạt']);
    expect(ws.getRow(concept).getCell(3).numFmt).toBe('#,##0" concept"');

    const script = values(ws, concept + 1);
    expect(script[1].richText.map((r: any) => r.text)).toEqual(['Viết kịch bản dài', '\nKịch bản trên 3 phút']);
    expect(script.slice(2)).toEqual([10, 5, 0.5, 'Chưa đạt — còn thiếu 3 để đạt 80%']);

    const lowerLabel = 'Tỷ lệ video bị trả lại (%) (càng thấp càng tốt)';
    expect(kpiRowOf(ws, lowerLabel)).toEqual([11, lowerLabel, 4, 10, 0.4, 'Chưa đạt — cần giảm xuống ≤ 5%']);
    expect(ws.getRow(findRow(ws, (v) => v[1] === lowerLabel)).getCell(3).numFmt).toBe('#,##0');

    expect(kpiRowOf(ws, 'Ra mắt kênh TikTok mới')).toEqual([12, 'Ra mắt kênh TikTok mới', 1, 1, 1, 'Đạt']);
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

    expect(computeActuals.mock.calls[0][1]).toContainEqual({ month: '2026-09', user_id: 'u-a', team_id: 'team-2' });
    const headers = [];
    for (let n = 1; n <= ws.rowCount; n++) if (String(values(ws, n)[0]).startsWith('Tháng 09/2026')) headers.push(String(values(ws, n)[0]));
    expect(headers).toHaveLength(2);
    expect(headers[0]).toContain('Nhóm: Team K1');
    expect(headers[1]).toContain('Nhóm: Team K2');
    expect(headers[1]).toContain('Người đặt: Leader C');
    expect(headers[1]).toContain('Chưa đặt KPI cố định');
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
  describe('mục "Video đã đăng" — video Facebook trên page người thực hiện cầm', () => {
    const video = (over: Partial<any> = {}) => ({
      post_id: 'v-1',
      caption: 'Nhẫn kim cương #A1 #N0006',
      published_at: new Date('2026-09-10T13:30:00Z'),
      permalink_url: 'https://www.facebook.com/reel/1108106365200234/',
      view_count: 12500,
      page_name: 'HuyK - Góc Kim Hoàn',
      ...over,
    });
    const owned = (videos: any[], over: Partial<any> = {}) => ({
      page_count: 1,
      total: videos.length,
      total_views: videos.reduce((sum, v) => sum + v.view_count, 0),
      videos,
      ...over,
    });

    it('cuối sheet, sau bảng task: mỗi video 1 dòng (nội dung, tuyến, page, giờ đăng VN, link bấm được, lượt xem)', async () => {
      const { service, fbVideos } = build([taskRow()]);
      fbVideos.getVideosByOwner.mockResolvedValue(
        new Map([
          ['u-a', owned([
            video(),
            video({ post_id: 'v-2', caption: `  Dòng 1\n\nDòng 2 ${'rất dài '.repeat(40)}`, view_count: 300, permalink_url: null }),
            video({ post_id: 'v-3', caption: 'Hai tuyến #a4 #A1 #A1', view_count: 0 }),
          ])],
        ]),
      );

      const ws = (await load((await service.exportApprovedTasks({} as any)).buffer)).worksheets[0];

      expect(String(ws.getRow(2).getCell(1).value)).toContain('1 task đã hoàn thành   ·   3 video đã đăng');
      const header = videoHeaderRow(ws);
      expect(header).toBeGreaterThan(taskHeaderRow(ws));
      expect(String(values(ws, findRow(ws, (v) => String(v[0]).startsWith('VIDEO ĐÃ ĐĂNG')))[0])).toBe(
        'VIDEO ĐÃ ĐĂNG — 3 video · 12.800 lượt xem',
      );
      expect(values(ws, header)).toEqual([
        'STT', 'Nội dung video', 'Tuyến nội dung', 'Page', 'Ngày đăng', 'Link video', 'Lượt xem',
      ]);

      const [r1, r2, r3] = tableRows(ws, header);
      expect(r1.slice(0, 4)).toEqual([1, 'Nhẫn kim cương #A1 #N0006', 'A1', 'HuyK - Góc Kim Hoàn']);
      expect(r1[4]).toEqual(new Date('2026-09-10T20:30:00Z'));
      expect(r1[6]).toBe(12500);
      const link = ws.getRow(header + 1).getCell(6);
      expect((link.value as any).hyperlink).toBe('https://www.facebook.com/reel/1108106365200234/');
      expect(ws.getRow(header + 1).getCell(5).numFmt).toBe('dd/mm/yyyy hh:mm');
      expect(ws.getRow(header + 1).getCell(7).numFmt).toBe('#,##0');
      expect(ws.getRow(header + 1).getCell(7).border).toBeDefined();

      expect(r2[1]).toMatch(/^Dòng 1 Dòng 2 rất dài .*…$/);
      expect(r2[1].length).toBeLessThanOrEqual(201);
      expect(r2[2]).toBeUndefined();
      expect(r2[5]).toBeUndefined();
      expect(r3[2]).toBe('A1, A4');

      // Tiêu đề mục video trải hết 7 cột của bảng video; mục KPI/task vẫn 6 cột như cũ.
      const videoHeading = findRow(ws, (v) => String(v[0]).startsWith('VIDEO ĐÃ ĐĂNG'));
      expect(ws.getRow(videoHeading).getCell(7).isMerged).toBe(true);
      expect(ws.getRow(1).getCell(6).isMerged).toBe(true);
      expect(ws.getRow(1).getCell(7).isMerged).toBe(false);

      const names = (ws.getTables() as any[]).map((t) => (t.table ?? t.model).name);
      expect(names).toEqual(['DanhSachTask_1', 'VideoDaDang_1']);
    });

    it('cùng khoảng ngày + team với bộ lọc task: ngày duyệt nếu có, không thì hạn chót', async () => {
      const { service, fbVideos } = build([taskRow(), taskRow({ id: 't-x', assignee_id: null, assignee: null })]);

      await service.exportApprovedTasks({ reviewed_from: '2026-09-01', reviewed_to: '2026-09-14', team_id: 'team-1, team-2' } as any);
      await service.exportApprovedTasks({ deadline_from: '2026-09-01', deadline_to: '2026-09-30' } as any);

      expect(fbVideos.getVideosByOwner.mock.calls[0]).toEqual([
        ['u-a'],
        {
          date_from: '2026-09-01',
          date_to: '2026-09-14',
          team_ids: ['team-1', 'team-2'],
          content_line: undefined,
          limit_per_owner: 1000,
        },
      ]);
      expect(fbVideos.getVideosByOwner.mock.calls[1][1]).toMatchObject({ date_from: '2026-09-01', date_to: '2026-09-30', team_ids: [] });
    });

    it('lọc tuyến nội dung → video lọc theo hashtag tuyến (#A1) trong caption, ghi rõ trên sheet', async () => {
      const { service, prisma, fbVideos } = build([
        taskRow(),
        taskRow({ id: 't-b', assignee_id: 'u-b', assignee: { full_name: 'Trần Thị B' } }),
      ]);
      prisma.contentLine.findUnique = jest.fn(async () => ({ name: 'a1' }));
      fbVideos.getVideosByOwner.mockResolvedValue(new Map([['u-a', owned([video()])], ['u-b', owned([])]]));

      const [a, b] = (await load((await service.exportApprovedTasks({ content_line_id: 'cl-a1' } as any)).buffer)).worksheets;

      expect(prisma.contentLine.findUnique).toHaveBeenCalledWith({ where: { id: 'cl-a1' }, select: { name: true } });
      expect(fbVideos.getVideosByOwner.mock.calls[0][1].content_line).toBe('A1');
      expect(String(a.getRow(2).getCell(1).value)).toContain('1 video đã đăng (#A1)');
      expect(findRow(a, (v) => String(v[0]).startsWith('VIDEO ĐÃ ĐĂNG #A1 — 1 video'))).toBeGreaterThan(0);
      expect(findRow(a, (v) => String(v[0]).includes('chỉ video có hashtag #A1 trong nội dung'))).toBeGreaterThan(0);
      expect(findRow(b, (v) => String(v[0]).startsWith('Không có video nào gắn #A1 được đăng'))).toBeGreaterThan(0);
    });

    it('tuyến không quy được về mã A1…A5 → không lọc video theo hashtag', async () => {
      const { service, prisma, fbVideos } = build([taskRow()]);
      prisma.contentLine.findUnique = jest.fn(async () => ({ name: 'Tuyến đặc biệt' }));

      await service.exportApprovedTasks({ content_line_id: 'cl-x' } as any);

      expect(fbVideos.getVideosByOwner.mock.calls[0][1].content_line).toBeUndefined();
    });

    it('chưa ghép page / không có video trong kỳ → dòng giải thích thay cho bảng; bị cắt thì ghi rõ chỉ liệt kê N video mới nhất', async () => {
      const { service, fbVideos } = build([
        taskRow(),
        taskRow({ id: 't-b', assignee_id: 'u-b', assignee: { full_name: 'Trần Thị B' } }),
        taskRow({ id: 't-c', assignee_id: 'u-c', assignee: { full_name: 'Võ Văn C' } }),
      ]);
      fbVideos.getVideosByOwner.mockResolvedValue(
        new Map([
          ['u-b', owned([])],
          ['u-c', owned([video()], { total: 1500, total_views: 99000 })],
        ]),
      );

      const [a, b, c] = (await load((await service.exportApprovedTasks({} as any)).buffer)).worksheets;

      expect(videoHeaderRow(a)).toBe(0);
      expect(findRow(a, (v) => String(v[0]).startsWith('Chưa ghép được page Facebook nào'))).toBeGreaterThan(0);
      expect(String(a.getRow(2).getCell(1).value)).not.toContain('video đã đăng');
      expect(videoHeaderRow(b)).toBe(0);
      expect(findRow(b, (v) => String(v[0]).startsWith('Không có video nào được đăng'))).toBeGreaterThan(0);
      expect(findRow(c, (v) => String(v[0]).includes('Chỉ liệt kê 1 video mới nhất.'))).toBeGreaterThan(0);
      expect(tableRows(c, videoHeaderRow(c))).toHaveLength(1);
    });
  });
});
