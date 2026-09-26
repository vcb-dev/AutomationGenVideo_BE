import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { TaskAutoKpiService } from "../kpi.service";
import { TaskAutoKpiController } from "../kpi.controller";
import { KpiPayrollSyncQueryDto } from "../dto/kpi-payroll-sync.dto";
import {
  mapEditorContentRoutes,
  mapEditorKpi,
  mergeContributions,
  type MetricContribution,
} from "../kpi-payroll-sync.mapper";
import { RolesGuard } from "../../../auth/guards/roles.guard";
import { JwtOrApiKeyGuard } from "../../../api-keys/guards/jwt-or-api-key.guard";

const TEAM_ID = "team-1";
const MONTH = "2026-09";

function editorKpi(over: Partial<Record<string, any>> = {}) {
  const row = {
    user_id: "editor-1",
    total_target: 0,
    video_win: 0,
    video_fail: 0,
    content_new: 0,
    content_collected: 0,
    content_win_cover: 0,
    product_planned: 0,
    product_win_collect: 0,
    product_profit: 0,
    product_collect_test_win: 0,
    user: { id: over.user_id ?? "editor-1", employee_id: "K2_07" },
    allocations: [],
    ...over,
  };
  return {
    ...row,
    content_paast_analyzed: over.content_paast_analyzed ?? row.content_collected,
    product_gmv: over.product_gmv ?? row.product_planned,
    product_traffic: over.product_traffic ?? row.product_win_collect,
  };
}

function fbLink(views: number) {
  return [
    {
      id: "l1",
      platform: "FACEBOOK",
      url: "https://facebook.com/x",
      stats: { views, status: "success" },
    },
  ];
}

interface PrismaOpts {
  team?: { id: string; name: string } | null;
  editorKpis?: any[];
  creatorKpis?: any[];
  creatorMembers?: any[];
  memberships?: any[];
  users?: any[];
  collectedGroups?: any[];
  translationGroups?: any[];
  creatorTasks?: any[];
  editorTasks?: any[];
  approvedTasks?: any[];
  contents?: any[];
  editorContents?: any[];
  teamContents?: any[];
  contentLines?: any[];
  productLines?: any[];
  products?: any[];
  editorProducts?: any[];
  teamProducts?: any[];
}

function approvedTask(over: Partial<Record<string, any>> = {}) {
  return {
    assignee_id: "editor-1",
    team_id: TEAM_ID,
    status: "APPROVED",
    published_links: [],
    content_id: null,
    editor_content_id: null,
    team_content_id: null,
    content_line_id: null,
    product_line_id: null,
    product_id: null,
    editor_product_id: null,
    team_product_id: null,
    ...over,
  };
}

function buildPrisma(opts: PrismaOpts = {}) {
  const write = jest.fn();
  return {
    team: {
      findUnique: jest.fn(async () =>
        opts.team === undefined ? { id: TEAM_ID, name: "Team K2" } : opts.team,
      ),
    },
    editorKpi: { findMany: jest.fn(async (_args?: any) => opts.editorKpis ?? []), update: write, create: write, upsert: write, delete: write, deleteMany: write },
    contentCreatorKpi: { findMany: jest.fn(async (_args?: any) => opts.creatorKpis ?? []), update: write, create: write, upsert: write },
    teamMember: {
      findMany: jest.fn(async (args: any) =>
        args?.where?.is_content_creator ? opts.creatorMembers ?? [] : opts.memberships ?? [],
      ),
    },
    user: { findMany: jest.fn(async () => opts.users ?? []), update: write },
    teamContent: {
      groupBy: jest.fn(async (_args?: any) => opts.collectedGroups ?? []),
      findMany: jest.fn(async () => opts.teamContents ?? []),
    },
    contentTranslation: { groupBy: jest.fn(async (_args?: any) => opts.translationGroups ?? []) },
    task: {
      findMany: jest.fn(async (args: any) => {
        if (args?.where?.AND) return opts.approvedTasks ?? [];
        if (args?.where?.team_id && args?.where?.assignee_id) return opts.approvedTasks ?? [];
        if (args?.where?.assignee_id) return opts.editorTasks ?? [];
        return opts.creatorTasks ?? [];
      }),
      update: write,
      updateMany: write,
    },
    content: { findMany: jest.fn(async () => opts.contents ?? []) },
    editorContent: { findMany: jest.fn(async () => opts.editorContents ?? []) },
    contentLine: { findMany: jest.fn(async () => opts.contentLines ?? []) },
    productLine: { findMany: jest.fn(async () => opts.productLines ?? []) },
    product: { findMany: jest.fn(async () => opts.products ?? []) },
    editorProduct: { findMany: jest.fn(async () => opts.editorProducts ?? []) },
    teamProduct: { findMany: jest.fn(async () => opts.teamProducts ?? []) },
    publishedLink: { update: write, updateMany: write, create: write },
    $transaction: write,
    __write: write,
  };
}

function buildService(opts: PrismaOpts = {}) {
  const prisma = buildPrisma(opts);
  const linkStats = { fetchStatsForLink: jest.fn(), refreshLinks: jest.fn() };
  const contentWinPush = { pushWinningContent: jest.fn(), autoPushForTask: jest.fn() };
  const service = new TaskAutoKpiService(prisma as any, linkStats as any, contentWinPush as any);
  return { service, prisma, linkStats, contentWinPush };
}

const recordFor = (records: any[], group: string, metric: string, userId?: string) =>
  records.find(
    (r) =>
      r.group_code === group &&
      r.metric_code === metric &&
      (userId === undefined || r.user_id === userId),
  );

describe("KpiPayrollSyncQueryDto", () => {
  const errorsFor = (query: any) =>
    validateSync(plainToInstance(KpiPayrollSyncQueryDto, query));

  it("nhận month đúng dạng YYYY-MM", () => {
    expect(errorsFor({ month: "2026-09" })).toHaveLength(0);
    expect(errorsFor({ month: "2026-01" })).toHaveLength(0);
    expect(errorsFor({ month: "2026-12" })).toHaveLength(0);
  });

  it("400: month thiếu, sai định dạng, hoặc tháng ngoài 01..12", () => {
    for (const bad of [undefined, "", "2026-9", "2026-13", "2026-00", "2026", "2026-09-01", "abc"]) {
      expect(errorsFor({ month: bad }).length).toBeGreaterThan(0);
    }
  });
});

describe("kpi-payroll-sync mapper — Editor (mục 6.1)", () => {
  const noActual = {
    videos_approved: null,
    win: null,
    fail: null,
    product_gmv: null,
    product_traffic: null,
    product_profit: null,
    product_collect_test_win: null,
    content_new: null,
    content_collected: null,
    content_win_cover: null,
  };

  it("MỌI cột editor_kpis vào cột target; actual chỉ đến từ báo cáo (không lấy lại cột target)", () => {
    const contributions = mapEditorKpi(
      editorKpi({
        total_target: 40,
        video_win: 12,
        video_fail: 23,
        content_new: 5,
        content_collected: 7,
        content_win_cover: 2,
        product_planned: 9,
        product_win_collect: 4,
        product_profit: 3,
        product_collect_test_win: 6,
      }),
      {
        videos_approved: 35,
        win: 11,
        fail: 24,
        product_gmv: 8,
        product_traffic: 6,
        product_profit: 2,
        product_collect_test_win: 1,
        content_new: 4,
        content_collected: 3,
        content_win_cover: 1,
      },
    );

    expect(
      contributions.map((c) => [c.group_code, c.metric_code, c.target, c.actual]),
    ).toEqual([
      ["VIDEO_PRODUCTION", "TOTAL_VIDEO", 40, 35],
      ["VIDEO_PRODUCTION", "VIDEO_WIN", 12, 11],
      ["VIDEO_PRODUCTION", "VIDEO_FAIL", 23, 24],
      ["CONTENT", "CONTENT_NEW", 5, 4],
      ["CONTENT", "CONTENT_COLLECTED", 7, 3],
      ["CONTENT", "CONTENT_WIN_COVER", 2, 1],
      ["PRODUCT", "PRODUCT_PLANNED", 9, 8],
      ["PRODUCT", "PRODUCT_COLLECTED", 4, 6],
      ["PRODUCT", "PRODUCT_PROFIT", 3, 2],
      ["PRODUCT", "PRODUCT_COLLECT_TEST_WIN", 6, 1],
    ]);
  });

  it("KHÔNG dùng editor_kpis.video_win làm actual — đó là mục tiêu số video win, không phải số đạt", () => {
    const c = mapEditorKpi(editorKpi({ video_win: 12, video_fail: 23 }), {
      ...noActual,
      videos_approved: 0,
      win: 0,
      fail: 0,
    });
    expect(c[1]).toMatchObject({ metric_code: "VIDEO_WIN", target: 12, actual: 0 });
    expect(c[2]).toMatchObject({ metric_code: "VIDEO_FAIL", target: 23, actual: 0 });
  });

  it("TOTAL_VIDEO.actual là số task đã duyệt, KHÔNG phải video_win + video_fail", () => {
    const c = mapEditorKpi(editorKpi({ total_target: 40, video_win: 6, video_fail: 1 }), {
      ...noActual,
      videos_approved: 30,
      win: 6,
      fail: 1,
    });
    expect(c[0]).toMatchObject({ metric_code: "TOTAL_VIDEO", target: 40, actual: 30 });
  });

  it("không có nguồn báo cáo thì actual = null, không tụt về 0", () => {
    const c = mapEditorKpi(editorKpi({ total_target: 40 }), noActual);
    expect(c[0]).toMatchObject({ metric_code: "TOTAL_VIDEO", target: 40, actual: null });
  });

  it("không xuất kpi_extra (VCB Salary chưa có KPI item tương ứng)", () => {
    const c = mapEditorKpi(editorKpi({ kpi_extra: 99 } as any), noActual);
    expect(c.some((x) => x.metric_code.includes("EXTRA"))).toBe(false);
  });
});

describe("kpi-payroll-sync mapper — tuyến nội dung (mục 6.2)", () => {
  const alloc = (aType: string | null, quantity: number, type = "CONTENT_LINE") => ({
    type,
    quantity,
    content_line: aType === null ? null : { id: `cl-${aType}`, a_type: aType, name: `Line ${aType}` },
  });

  it("target cộng quantity khi cùng tuyến, chuẩn hóa trim + uppercase; actual từ báo cáo", () => {
    const { contributions, warnings } = mapEditorContentRoutes(
      editorKpi({ allocations: [alloc("A1", 10), alloc(" a1 ", 5), alloc("A3", 7)] }),
      { A1: 12, A3: 0 },
    );

    expect(warnings).toHaveLength(0);
    expect(contributions.map((c) => [c.metric_code, c.target, c.actual])).toEqual([
      ["CONTENT_ROUTE_A1", 15, 12],
      ["CONTENT_ROUTE_A3", 7, 0],
    ]);
    expect(contributions.every((c) => c.group_code === "VIDEO_PRODUCTION")).toBe(true);
  });

  it("xuất HỢP của hai tập: tuyến chỉ có mục tiêu và tuyến chỉ có video làm ngoài phân bổ", () => {
    const { contributions } = mapEditorContentRoutes(
      editorKpi({ allocations: [alloc("A1", 10)] }),
      { A4: 3 },
    );
    expect(contributions.map((c) => [c.metric_code, c.target, c.actual])).toEqual([
      ["CONTENT_ROUTE_A1", 10, 0],
      ["CONTENT_ROUTE_A4", null, 3],
    ]);
  });

  it("không có báo cáo nào (null) thì actual null — phân biệt với đo được và bằng 0", () => {
    const { contributions } = mapEditorContentRoutes(
      editorKpi({ allocations: [alloc("A1", 10)] }),
      null,
    );
    expect(contributions).toEqual([
      expect.objectContaining({ metric_code: "CONTENT_ROUTE_A1", target: 10, actual: null }),
    ]);
  });

  it("fallback sang name khi a_type rỗng — nhiều team đặt thẳng tên tuyến là A1..A5", () => {
    const { contributions, warnings } = mapEditorContentRoutes(
      editorKpi({
        allocations: [
          { type: "CONTENT_LINE", quantity: 8, content_line: { id: "cl1", a_type: null, name: "A2" } },
        ],
      }),
      null,
    );
    expect(warnings).toHaveLength(0);
    expect(contributions).toEqual([
      expect.objectContaining({ metric_code: "CONTENT_ROUTE_A2", target: 8, actual: null }),
    ]);
  });

  it("không quy được về A1..A5: bỏ allocation + warning, không bịa metric_code từ tên tự do", () => {
    const { contributions, warnings } = mapEditorContentRoutes(
      editorKpi({
        allocations: [
          { type: "CONTENT_LINE", quantity: 4, content_line: { id: "c1", a_type: "A9", name: "Tuyến lạ" } },
          { type: "CONTENT_LINE", quantity: 3, content_line: null },
          { type: "CONTENT_LINE", quantity: 6, content_line: { id: "c2", a_type: "A2", name: "A2" } },
        ],
      }),
      null,
    );

    expect(contributions.map((c) => c.metric_code)).toEqual(["CONTENT_ROUTE_A2"]);
    expect(warnings).toHaveLength(2);
    expect(warnings.every((w) => w.code === "UNKNOWN_CONTENT_LINE_CODE")).toBe(true);
    expect(warnings.every((w) => w.user_id === "editor-1")).toBe(true);
  });

  it("bỏ qua allocation PRODUCT_LINE, không tạo warning", () => {
    const { contributions, warnings } = mapEditorContentRoutes(
      editorKpi({ allocations: [alloc(null, 8, "PRODUCT_LINE")] }),
      null,
    );
    expect(contributions).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
});

describe("kpi-payroll-sync mapper — mergeContributions", () => {
  const c = (over: Partial<MetricContribution>): MetricContribution => ({
    user_id: "u1",
    group_code: "VIDEO_PRODUCTION",
    metric_code: "TOTAL_VIDEO",
    target: null,
    actual: null,
    ...over,
  });

  it("gộp target + actual rời rạc thành đúng một record", () => {
    const { records, warnings } = mergeContributions([c({ target: 10 }), c({ actual: 4 })], () => "E1");
    expect(records).toEqual([
      {
        user_id: "u1",
        employee_id: "E1",
        group_code: "VIDEO_PRODUCTION",
        metric_code: "TOTAL_VIDEO",
        target: 10,
        actual: 4,
      },
    ]);
    expect(warnings).toHaveLength(0);
  });

  it("bỏ record mà cả target lẫn actual đều null, nhưng GIỮ giá trị 0", () => {
    const { records } = mergeContributions(
      [c({ metric_code: "A" }), c({ metric_code: "B", actual: 0 }), c({ metric_code: "C", target: 0 })],
      () => null,
    );
    expect(records.map((r) => [r.metric_code, r.target, r.actual])).toEqual([
      ["B", null, 0],
      ["C", 0, null],
    ]);
  });

  it("hai giá trị khác nhau cùng khóa: FIRST-WINS + warning DUPLICATE_METRIC (không im lặng)", () => {
    const { records, warnings } = mergeContributions(
      [c({ target: 10, actual: 3 }), c({ target: 99, actual: 88 })],
      () => null,
    );
    expect(records[0]).toMatchObject({ target: 10, actual: 3 });
    expect(warnings).toHaveLength(2);
    expect(warnings.every((w) => w.code === "DUPLICATE_METRIC")).toBe(true);
  });

  it("null không ghi đè và không gây conflict; giá trị trùng nhau cũng không cảnh báo", () => {
    const { records, warnings } = mergeContributions(
      [c({ target: 10 }), c({ target: null }), c({ target: 10 })],
      () => null,
    );
    expect(records[0].target).toBe(10);
    expect(warnings).toHaveLength(0);
  });

  it("sắp xếp deterministic theo user_id, group_code, metric_code", () => {
    const { records } = mergeContributions(
      [
        c({ user_id: "u2", group_code: "PRODUCT", metric_code: "PRODUCT_PROFIT", actual: 1 }),
        c({ user_id: "u1", group_code: "VIDEO_PRODUCTION", metric_code: "VIDEO_WIN", actual: 1 }),
        c({ user_id: "u1", group_code: "CONTENT", metric_code: "CONTENT_NEW", actual: 1 }),
        c({ user_id: "u1", group_code: "VIDEO_PRODUCTION", metric_code: "TOTAL_VIDEO", actual: 1 }),
      ],
      () => null,
    );
    expect(records.map((r) => `${r.user_id}/${r.group_code}/${r.metric_code}`)).toEqual([
      "u1/CONTENT/CONTENT_NEW",
      "u1/VIDEO_PRODUCTION/TOTAL_VIDEO",
      "u1/VIDEO_PRODUCTION/VIDEO_WIN",
      "u2/PRODUCT/PRODUCT_PROFIT",
    ]);
  });
});

describe("TaskAutoKpiService.getTeamKpiPayrollSync", () => {
  it("404 khi team không tồn tại, và không đụng tới bảng KPI nào", async () => {
    const { service, prisma } = buildService({ team: null });
    await expect(service.getTeamKpiPayrollSync(TEAM_ID, MONTH)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.editorKpi.findMany).not.toHaveBeenCalled();
    expect(prisma.contentCreatorKpi.findMany).not.toHaveBeenCalled();
  });

  it("200 với records rỗng khi team tồn tại nhưng tháng đó chưa có KPI nào", async () => {
    const { service } = buildService();
    const res = await service.getTeamKpiPayrollSync(TEAM_ID, MONTH);

    expect(res).toMatchObject({
      contract_version: "1.2",
      month: MONTH,
      team: { id: TEAM_ID, name: "Team K2" },
      records: [],
      warnings: [],
    });
    expect(new Date(res.generated_at).toISOString()).toBe(res.generated_at);
  });

  it("không có EditorKpi tháng đó thì KHÔNG tự sinh record Editor toàn 0", async () => {
    const { service } = buildService({ editorKpis: [] });
    const res = await service.getTeamKpiPayrollSync(TEAM_ID, MONTH);
    expect(res.records.filter((r) => r.group_code === "VIDEO_PRODUCTION")).toHaveLength(0);
  });

  it("query đúng team_id + month, KHÔNG lọc theo users.is_active (payroll cần dữ liệu lịch sử)", async () => {
    const { service, prisma } = buildService({
      editorKpis: [
        editorKpi({
          user_id: "editor-left",
          total_target: 12,
          video_win: 1,
          user: { id: "editor-left", employee_id: "K2_99" },
        }),
      ],
    });
    const res = await service.getTeamKpiPayrollSync(TEAM_ID, MONTH);

    const editorArgs = prisma.editorKpi.findMany.mock.calls[0][0];
    const creatorArgs = prisma.contentCreatorKpi.findMany.mock.calls[0][0];
    expect(editorArgs.where).toEqual({ team_id: TEAM_ID, month: MONTH });
    expect(creatorArgs.where).toEqual({ team_id: TEAM_ID, month: MONTH });
    expect(JSON.stringify(editorArgs)).not.toContain("is_active");
    expect(JSON.stringify(editorArgs)).not.toContain("deleted_at");

    expect(recordFor(res.records, "VIDEO_PRODUCTION", "TOTAL_VIDEO", "editor-left")).toMatchObject({
      target: 12,
      employee_id: "K2_99",
    });
  });

  it("target lấy từ editor_kpis, actual lấy từ báo cáo — hai nguồn hoàn toàn khác nhau", async () => {
    const { service, prisma } = buildService({
      editorKpis: [
        editorKpi({
          user_id: "editor-1",
          total_target: 40,
          video_win: 12,
          video_fail: 23,
          content_new: 5,
          content_collected: 7,
          content_win_cover: 2,
          product_planned: 9,
          product_win_collect: 4,
          product_profit: 3,
          allocations: [
            { type: "CONTENT_LINE", quantity: 10, content_line: { id: "cl-a1", a_type: "A1", name: "A1" } },
            { type: "CONTENT_LINE", quantity: 5, content_line: { id: "cl-a1b", a_type: "a1", name: "A1 phụ" } },
            { type: "CONTENT_LINE", quantity: 4, content_line: { id: "cl-x", a_type: "Xyz", name: "Tuyến lạ" } },
          ],
        }),
      ],
      contentLines: [
        { id: "cl-a1", name: "A1", a_type: "A1" },
        { id: "cl-a3", name: "A3", a_type: "A3" },
        { id: "cl-x", name: "Tuyến lạ", a_type: "Xyz" },
      ],
      productLines: [
        { id: "pl-gmv", name: "GMV", video_category: null },
        { id: "pl-traffic", name: "Traffic", video_category: null },
        { id: "pl-profit", name: "Profit", video_category: null },
      ],
      approvedTasks: [
        approvedTask({ content_line_id: "cl-a1", product_id: "p-gmv-1", published_links: fbLink(20000) }),
        approvedTask({ content_line_id: "cl-a1", product_id: "p-gmv-2", published_links: fbLink(500) }),
        approvedTask({ content_line_id: "cl-a3", product_id: "p-profit-1" }),
        approvedTask({ content_line_id: "cl-x", team_product_id: "tp-1" }),
        approvedTask({ content_line_id: null, content_id: "c-new" }),
      ],
      contents: [{ id: "c-new", classification: { name: "Mới" } }],
      products: [
        { id: "p-gmv-1", product_line_id: "pl-gmv" },
        { id: "p-gmv-2", product_line_id: "pl-gmv" },
        { id: "p-profit-1", product_line_id: "pl-profit" },
      ],
      teamProducts: [{ id: "tp-1", product_line_id: "pl-traffic" }],
    });
    const res = await service.getTeamKpiPayrollSync(TEAM_ID, MONTH);

    expect(recordFor(res.records, "VIDEO_PRODUCTION", "TOTAL_VIDEO")).toMatchObject({
      target: 40,
      actual: 5,
    });
    expect(recordFor(res.records, "VIDEO_PRODUCTION", "VIDEO_WIN")).toMatchObject({
      target: 12,
      actual: 1,
    });
    expect(recordFor(res.records, "VIDEO_PRODUCTION", "VIDEO_FAIL")).toMatchObject({
      target: 23,
      actual: 1,
    });

    expect(recordFor(res.records, "VIDEO_PRODUCTION", "CONTENT_ROUTE_A1")).toMatchObject({
      target: 15,
      actual: 2,
    });
    expect(recordFor(res.records, "VIDEO_PRODUCTION", "CONTENT_ROUTE_A3")).toMatchObject({
      target: null,
      actual: 1,
    });

    expect(recordFor(res.records, "PRODUCT", "PRODUCT_PLANNED")).toMatchObject({
      target: 9,
      actual: 2,
    });
    expect(recordFor(res.records, "PRODUCT", "PRODUCT_COLLECTED")).toMatchObject({
      target: 4,
      actual: 1,
    });
    expect(recordFor(res.records, "PRODUCT", "PRODUCT_PROFIT")).toMatchObject({
      target: 3,
      actual: 1,
    });

    expect(recordFor(res.records, "CONTENT", "CONTENT_NEW")).toMatchObject({ target: 5, actual: 1 });
    expect(recordFor(res.records, "CONTENT", "CONTENT_COLLECTED")).toMatchObject({ target: 7, actual: 0 });
    expect(recordFor(res.records, "CONTENT", "CONTENT_WIN_COVER")).toMatchObject({ target: 2, actual: 1 });
    expect(res.warnings.map((w) => w.code)).toContain("UNKNOWN_CONTENT_LINE_CODE");
    expect(res.warnings.some((w) => w.code === "NO_ACTUAL_SOURCE")).toBe(false);

    const approvedArgs = prisma.task.findMany.mock.calls.find(
      (c: any) => c[0]?.where?.team_id && c[0]?.where?.assignee_id,
    )![0];
    expect(approvedArgs.where.status).toBe("APPROVED");
    expect(approvedArgs.where.OR).toEqual([
      { deadline: { gte: expect.any(Date), lt: expect.any(Date) } },
      { deadline: null, created_at: { gte: expect.any(Date), lt: expect.any(Date) } },
    ]);
  });

  it("dòng sản phẩm không phải GMV/Traffic/Profit: cảnh báo thay vì biến mất im lặng", async () => {
    const { service } = buildService({
      editorKpis: [editorKpi({ user_id: "editor-1", product_planned: 5 })],
      productLines: [{ id: "pl-x", name: "Hàng tồn", video_category: null }],
      approvedTasks: [approvedTask({ product_id: "p-x" })],
      products: [{ id: "p-x", product_line_id: "pl-x" }],
    });
    const res = await service.getTeamKpiPayrollSync(TEAM_ID, MONTH);

    expect(recordFor(res.records, "PRODUCT", "PRODUCT_PLANNED")).toMatchObject({
      target: 5,
      actual: 0,
    });
    expect(res.warnings.filter((w) => w.code === "UNKNOWN_PRODUCT_LINE_CATEGORY")).toEqual([
      {
        code: "UNKNOWN_PRODUCT_LINE_CATEGORY",
        message:
          "Dòng sản phẩm không khớp GMV/Traffic/Profit nên không tính vào metric nào: HÀNG TỒN",
      },
    ]);
  });

  it("dùng ProductLine.video_category khi có set, không phải name", async () => {
    const { service } = buildService({
      editorKpis: [editorKpi({ user_id: "editor-1", product_profit: 2 })],
      productLines: [{ id: "pl-1", name: "Dòng cao cấp", video_category: "Profit" }],
      approvedTasks: [approvedTask({ product_id: "p-1" })],
      products: [{ id: "p-1", product_line_id: "pl-1" }],
    });
    const res = await service.getTeamKpiPayrollSync(TEAM_ID, MONTH);

    expect(recordFor(res.records, "PRODUCT", "PRODUCT_PROFIT")).toMatchObject({ actual: 1 });
    expect(res.warnings.some((w) => w.code === "UNKNOWN_PRODUCT_LINE_CATEGORY")).toBe(false);
  });

  it("PRODUCT_*: đếm SỐ SẢN PHẨM riêng biệt, không phải số video", async () => {
    const { service } = buildService({
      editorKpis: [editorKpi({ user_id: "editor-1", product_planned: 10 })],
      productLines: [{ id: "pl-gmv", name: "GMV", video_category: null }],
      approvedTasks: [
        approvedTask({ product_id: "p-1" }),
        approvedTask({ product_id: "p-1" }),
        approvedTask({ product_id: "p-2" }),
        approvedTask({ product_line_id: "pl-gmv" }),
      ],
      products: [
        { id: "p-1", product_line_id: "pl-gmv" },
        { id: "p-2", product_line_id: "pl-gmv" },
      ],
    });
    const res = await service.getTeamKpiPayrollSync(TEAM_ID, MONTH);

    expect(recordFor(res.records, "PRODUCT", "PRODUCT_PLANNED")).toMatchObject({
      target: 10,
      actual: 2,
    });
    expect(recordFor(res.records, "VIDEO_PRODUCTION", "TOTAL_VIDEO")).toMatchObject({ actual: 4 });
  });

  it("PRODUCT_COLLECT_TEST_WIN: sản phẩm dòng \"Sưu tầm\" có video đạt win", async () => {
    const { service } = buildService({
      editorKpis: [editorKpi({ user_id: "editor-1", product_collect_test_win: 4 })],
      productLines: [
        { id: "pl-collect", name: "Sưu tầm", video_category: null },
        { id: "pl-gmv", name: "GMV", video_category: null },
      ],
      approvedTasks: [
        approvedTask({ product_id: "p-collect", published_links: fbLink(20000) }),
        approvedTask({ product_id: "p-collect-2", published_links: fbLink(500) }),
        approvedTask({ product_id: "p-gmv", published_links: fbLink(30000) }),
      ],
      products: [
        { id: "p-collect", product_line_id: "pl-collect" },
        { id: "p-collect-2", product_line_id: "pl-collect" },
        { id: "p-gmv", product_line_id: "pl-gmv" },
      ],
    });
    const res = await service.getTeamKpiPayrollSync(TEAM_ID, MONTH);

    expect(recordFor(res.records, "PRODUCT", "PRODUCT_COLLECT_TEST_WIN")).toMatchObject({
      target: 4,
      actual: 1,
    });
    expect(recordFor(res.records, "PRODUCT", "PRODUCT_PLANNED")).toMatchObject({ actual: 1 });
    expect(res.warnings.some((w) => w.code === "UNKNOWN_PRODUCT_LINE_CATEGORY")).toBe(true);
  });

  it("CONTENT_NEW / CONTENT_COLLECTED tính cả task CHƯA duyệt, theo phân loại content", async () => {
    const { service } = buildService({
      editorKpis: [editorKpi({ user_id: "editor-1", content_new: 3, content_collected: 2 })],
      approvedTasks: [
        approvedTask({ content_id: "c-new" }),
        approvedTask({ status: "SUBMITTED", editor_content_id: "ec-new" }),
        approvedTask({ status: "IN_PROGRESS", team_content_id: "tc-paast" }),
      ],
      contents: [{ id: "c-new", classification: { name: "Mới" } }],
      editorContents: [{ id: "ec-new", classification: { name: "mới" } }],
      teamContents: [{ id: "tc-paast", classification: { name: "Phân tích theo PAAST" } }],
    });
    const res = await service.getTeamKpiPayrollSync(TEAM_ID, MONTH);

    expect(recordFor(res.records, "CONTENT", "CONTENT_NEW")).toMatchObject({ target: 3, actual: 2 });
    expect(recordFor(res.records, "CONTENT", "CONTENT_COLLECTED")).toMatchObject({ target: 2, actual: 1 });
    expect(recordFor(res.records, "VIDEO_PRODUCTION", "TOTAL_VIDEO")).toMatchObject({ actual: 1 });
  });

  it("giá trị 0 giữ nguyên là 0, không bị đổi thành null", async () => {
    const { service } = buildService({
      editorKpis: [editorKpi({ total_target: 0, video_win: 0, video_fail: 0 })],
    });
    const res = await service.getTeamKpiPayrollSync(TEAM_ID, MONTH);

    expect(recordFor(res.records, "VIDEO_PRODUCTION", "TOTAL_VIDEO")).toMatchObject({
      target: 0,
      actual: 0,
    });
    expect(recordFor(res.records, "VIDEO_PRODUCTION", "VIDEO_WIN")).toMatchObject({
      target: 0,
      actual: 0,
    });
    expect(recordFor(res.records, "CONTENT", "CONTENT_WIN_COVER")).toMatchObject({
      target: 0,
      actual: 0,
    });
  });

  it("editor ở nhiều team: KHÔNG còn warning UNSCOPED_EDITOR_ACTUAL, win/fail chỉ tính task của team này", async () => {
    const { service } = buildService({
      editorKpis: [editorKpi({ user_id: "editor-1", total_target: 5, video_win: 3 })],
      memberships: [
        { user_id: "editor-1", team_id: TEAM_ID },
        { user_id: "editor-1", team_id: "team-2" },
      ],
      approvedTasks: [
        approvedTask({ published_links: fbLink(20000) }),
        approvedTask({ team_id: "team-2", published_links: fbLink(30000) }),
      ],
    });
    const res = await service.getTeamKpiPayrollSync(TEAM_ID, MONTH);

    expect(res.warnings.some((w) => w.code === "UNSCOPED_EDITOR_ACTUAL")).toBe(false);
    expect(recordFor(res.records, "VIDEO_PRODUCTION", "VIDEO_WIN")).toMatchObject({
      target: 3,
      actual: 1,
    });
  });

  it("không có editor nào thì không phát warning NO_ACTUAL_SOURCE thừa", async () => {
    const { service } = buildService({ editorKpis: [] });
    const res = await service.getTeamKpiPayrollSync(TEAM_ID, MONTH);
    expect(res.warnings.some((w) => w.code === "NO_ACTUAL_SOURCE")).toBe(false);
  });

  it("thiếu employee_id vẫn trả đủ record, kèm đúng một warning MISSING_EMPLOYEE_ID cho user đó", async () => {
    const { service } = buildService({
      editorKpis: [
        editorKpi({ user_id: "editor-1", total_target: 5, user: { id: "editor-1", employee_id: null } }),
      ],
    });
    const res = await service.getTeamKpiPayrollSync(TEAM_ID, MONTH);

    expect(res.records.length).toBeGreaterThan(0);
    expect(res.records.every((r) => r.employee_id === null)).toBe(true);
    expect(res.warnings.filter((w) => w.code === "MISSING_EMPLOYEE_ID")).toEqual([
      { code: "MISSING_EMPLOYEE_ID", user_id: "editor-1", message: "User chưa có employee_id" },
    ]);
  });

  it("Content Creator: union member + target tháng, merge target và actual về một record mỗi metric", async () => {
    const { service, prisma } = buildService({
      creatorMembers: [{ user_id: "cc-1", user: { id: "cc-1", employee_id: "K2_11" } }],
      creatorKpis: [
        {
          user_id: "cc-1",
          content_target: 60,
          translation_target: 30,
          user: { id: "cc-1", employee_id: "K2_11" },
        },
        {
          user_id: "cc-2",
          content_target: 20,
          translation_target: 0,
          user: { id: "cc-2", employee_id: "K2_12" },
        },
      ],
      memberships: [{ user_id: "cc-1", team_id: TEAM_ID }, { user_id: "cc-2", team_id: TEAM_ID }],
      users: [{ id: "cc-1", full_name: "CC 1" }, { id: "cc-2", full_name: "CC 2" }],
      collectedGroups: [{ added_by_id: "cc-1", _count: { id: 52 } }],
      translationGroups: [{ translated_by_id: "cc-1", _count: { id: 28 } }],
      creatorTasks: [
        {
          id: "t1",
          status: "APPROVED",
          published_links: fbLink(20000),
          assignee: { id: "editor-1", full_name: "E" },
          team_content: { added_by_id: "cc-1", code: "C1", title: "C1" },
          content: null,
        },
        {
          id: "t2",
          status: "APPROVED",
          published_links: fbLink(500),
          assignee: { id: "editor-1", full_name: "E" },
          team_content: { added_by_id: "cc-1", code: "C2", title: "C2" },
          content: null,
        },
      ],
    });
    const res = await service.getTeamKpiPayrollSync(TEAM_ID, MONTH);

    const g = "AGV_CONTENT_CREATOR_MONTHLY";
    expect(recordFor(res.records, g, "CONTENT_COLLECTED", "cc-1")).toMatchObject({
      target: 60,
      actual: 52,
      employee_id: "K2_11",
    });
    expect(recordFor(res.records, g, "TRANSLATIONS", "cc-1")).toMatchObject({ target: 30, actual: 28 });
    expect(recordFor(res.records, g, "VIDEOS_MADE", "cc-1")).toMatchObject({ target: null, actual: 2 });
    expect(recordFor(res.records, g, "CONTENT_WIN", "cc-1")).toMatchObject({ target: null, actual: 1 });
    expect(recordFor(res.records, g, "CONTENT_FAIL", "cc-1")).toMatchObject({ target: null, actual: 1 });
    expect(res.records.some((r) => r.metric_code === "CONTENT_PENDING")).toBe(false);
    expect(recordFor(res.records, g, "CONTENT_COLLECTED", "cc-2")).toMatchObject({
      target: 20,
      actual: 0,
    });

    const collectedArgs = prisma.teamContent.groupBy.mock.calls[0][0];
    expect(collectedArgs.where.team_id).toBe(TEAM_ID);
    expect(collectedArgs.where.added_at.gte.toISOString()).toBe("2026-08-31T17:00:00.000Z");
    expect(collectedArgs.where.added_at.lt.toISOString()).toBe("2026-09-30T17:00:00.000Z");
  });

  it("user ở nhiều team: vẫn trả actual nhưng kèm warning UNSCOPED_CREATOR_ACTUAL", async () => {
    const { service } = buildService({
      creatorMembers: [{ user_id: "cc-1", user: { id: "cc-1", employee_id: "K2_11" } }],
      memberships: [
        { user_id: "cc-1", team_id: TEAM_ID },
        { user_id: "cc-1", team_id: "team-2" },
      ],
      users: [{ id: "cc-1", full_name: "CC 1" }],
      translationGroups: [{ translated_by_id: "cc-1", _count: { id: 9 } }],
    });
    const res = await service.getTeamKpiPayrollSync(TEAM_ID, MONTH);

    expect(
      recordFor(res.records, "AGV_CONTENT_CREATOR_MONTHLY", "TRANSLATIONS", "cc-1"),
    ).toMatchObject({ actual: 9 });
    expect(res.warnings.filter((w) => w.code === "UNSCOPED_CREATOR_ACTUAL")).toHaveLength(1);
  });

  it("user vừa là Editor vừa là Content Creator: CONTENT_COLLECTED không đè nhau nhờ group_code", async () => {
    const uid = "dual-1";
    const { service } = buildService({
      editorKpis: [
        editorKpi({ user_id: uid, content_collected: 7, user: { id: uid, employee_id: "K2_20" } }),
      ],
      creatorMembers: [{ user_id: uid, user: { id: uid, employee_id: "K2_20" } }],
      creatorKpis: [
        { user_id: uid, content_target: 60, translation_target: 0, user: { id: uid, employee_id: "K2_20" } },
      ],
      memberships: [{ user_id: uid, team_id: TEAM_ID }],
      users: [{ id: uid, full_name: "Dual" }],
      collectedGroups: [{ added_by_id: uid, _count: { id: 52 } }],
    });
    const res = await service.getTeamKpiPayrollSync(TEAM_ID, MONTH);

    expect(recordFor(res.records, "CONTENT", "CONTENT_COLLECTED", uid)).toMatchObject({
      target: 7,
      actual: 0,
    });
    expect(
      recordFor(res.records, "AGV_CONTENT_CREATOR_MONTHLY", "CONTENT_COLLECTED", uid),
    ).toMatchObject({ target: 60, actual: 52 });
    expect(res.warnings.filter((w) => w.code === "DUPLICATE_METRIC")).toHaveLength(0);
  });

  it("không có duplicate khóa (user_id, group_code, metric_code) và thứ tự ổn định giữa 2 lần gọi", async () => {
    const opts: PrismaOpts = {
      editorKpis: [
        editorKpi({ user_id: "editor-2", total_target: 3, user: { id: "editor-2", employee_id: "B" } }),
        editorKpi({ user_id: "editor-1", total_target: 5, user: { id: "editor-1", employee_id: "A" } }),
      ],
      creatorMembers: [{ user_id: "cc-1", user: { id: "cc-1", employee_id: "C" } }],
      memberships: [{ user_id: "cc-1", team_id: TEAM_ID }],
      users: [{ id: "cc-1", full_name: "CC 1" }],
      collectedGroups: [{ added_by_id: "cc-1", _count: { id: 2 } }],
    };
    const first = await buildService(opts).service.getTeamKpiPayrollSync(TEAM_ID, MONTH);
    const second = await buildService(opts).service.getTeamKpiPayrollSync(TEAM_ID, MONTH);

    const keys = first.records.map((r) => `${r.user_id}|${r.group_code}|${r.metric_code}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
    expect(second.records).toEqual(first.records);
  });

  it("GET không ghi dữ liệu, không refresh traffic, không gọi API mạng ngoài", async () => {
    const { service, prisma, linkStats, contentWinPush } = buildService({
      editorKpis: [editorKpi({ total_target: 5, video_win: 2 })],
      creatorMembers: [{ user_id: "cc-1", user: { id: "cc-1", employee_id: "C" } }],
      memberships: [{ user_id: "cc-1", team_id: TEAM_ID }],
      users: [{ id: "cc-1", full_name: "CC 1" }],
      creatorTasks: [
        {
          id: "t1",
          status: "APPROVED",
          published_links: fbLink(20000),
          assignee: null,
          team_content: { added_by_id: "cc-1", code: "C1", title: "C1" },
          content: null,
        },
      ],
    });
    const refreshSpy = jest.spyOn(service, "refreshContentWinFailStats");

    await service.getTeamKpiPayrollSync(TEAM_ID, MONTH);

    expect(prisma.__write).not.toHaveBeenCalled();
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(Object.values(linkStats).every((fn: any) => fn.mock.calls.length === 0)).toBe(true);
    expect(Object.values(contentWinPush).every((fn: any) => fn.mock.calls.length === 0)).toBe(true);
  });

  it("số lượng query hữu hạn, không N+1 theo số nhân sự", async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      editorKpi({ user_id: `e-${i}`, total_target: i, user: { id: `e-${i}`, employee_id: `E${i}` } }),
    );
    const { service, prisma } = buildService({
      editorKpis: many,
      creatorMembers: Array.from({ length: 25 }, (_, i) => ({
        user_id: `c-${i}`,
        user: { id: `c-${i}`, employee_id: `C${i}` },
      })),
      memberships: [],
      users: [],
      approvedTasks: many.map((k) => approvedTask({ assignee_id: k.user_id })),
      contentLines: [{ id: "cl-a1", name: "A1", a_type: "A1" }],
      productLines: [{ id: "pl-gmv", name: "GMV", video_category: null }],
    });
    await service.getTeamKpiPayrollSync(TEAM_ID, MONTH);

    expect(prisma.editorKpi.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.contentCreatorKpi.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.teamContent.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.contentTranslation.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.task.findMany).toHaveBeenCalledTimes(4);
    expect(prisma.contentLine.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.productLine.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.teamMember.findMany).toHaveBeenCalledTimes(2);
  });
});

describe("TaskAutoKpiController.getTeamKpiPayrollSync — route & auth", () => {
  const handler = TaskAutoKpiController.prototype.getTeamKpiPayrollSync;

  function ctx(user: any) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => handler,
      getClass: () => TaskAutoKpiController,
    } as any;
  }

  it("chuyển team id + month xuống service và trả nguyên snapshot", async () => {
    const snapshot = { contract_version: "1.2", records: [], warnings: [] };
    const kpi = { getTeamKpiPayrollSync: jest.fn(async () => snapshot) };
    const controller = new TaskAutoKpiController(kpi as any);

    await expect(controller.getTeamKpiPayrollSync(TEAM_ID, { month: MONTH })).resolves.toBe(
      snapshot,
    );
    expect(kpi.getTeamKpiPayrollSync).toHaveBeenCalledWith(TEAM_ID, MONTH);
  });

  it("route được gắn @Roles('ADMIN'): ADMIN qua, role khác bị chặn (403)", () => {
    const guard = new RolesGuard(new Reflector());
    expect(Reflect.getMetadata("roles", handler)).toEqual(["ADMIN"]);

    expect(guard.canActivate(ctx({ id: "svc", roles: ["ADMIN"] }))).toBe(true);
    for (const roles of [["MANAGER"], ["LEADER"], ["EDITOR"], []]) {
      expect(guard.canActivate(ctx({ id: "u", roles }))).toBe(false);
    }
    expect(guard.canActivate(ctx(undefined))).toBe(false);
  });

  it("API key hợp lệ (service user ADMIN) đi qua guard và được RolesGuard chấp nhận", async () => {
    const serviceUser = { id: "svc-1", roles: ["ADMIN"], is_active: true };
    const prisma: any = {
      apiKey: {
        findUnique: jest.fn(async () => ({
          id: "key-1",
          name: "vcb-salary",
          is_active: true,
          revoked_at: null,
          expires_at: null,
          service_user: serviceUser,
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const req: any = { headers: { "x-api-key": "agv_" + "a".repeat(48) }, socket: {} };
    const guardCtx: any = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => handler,
      getClass: () => TaskAutoKpiController,
    };

    await expect(new JwtOrApiKeyGuard(new Reflector(), prisma).canActivate(guardCtx)).resolves.toBe(
      true,
    );
    expect(req.user).toBe(serviceUser);
    expect(new RolesGuard(new Reflector()).canActivate(guardCtx)).toBe(true);
  });

  it("API key bị thu hồi -> 401, không rơi xuống nhánh JWT", async () => {
    const prisma: any = {
      apiKey: {
        findUnique: jest.fn(async () => ({
          id: "key-1",
          name: "vcb-salary",
          is_active: true,
          revoked_at: new Date(),
          expires_at: null,
          service_user: { id: "svc-1", roles: ["ADMIN"], is_active: true },
        })),
      },
    };
    const req: any = { headers: { "x-api-key": "agv_" + "b".repeat(48) }, socket: {} };
    const guardCtx: any = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => handler,
      getClass: () => TaskAutoKpiController,
    };

    await expect(
      new JwtOrApiKeyGuard(new Reflector(), prisma).canActivate(guardCtx),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
