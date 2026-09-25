import { Injectable } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import { DateTime } from "luxon";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { parseTeamIdFilter } from "../../../common/utils/team-membership.util";
import { vietnamMonthString } from "../../../utils/date.utils";
import {
  computeEditorKpiActuals,
  editorKpiActualKey,
  emptyEditorKpiActuals,
  EditorKpiActuals,
} from "../kpi/editor-kpi-actuals.util";
import {
  calculateGoalProgress,
  calculateUnweightedOverall,
} from "../performance-goals/performance-goal.calculator";
import { TaskAutoTasksService } from "./tasks.service";
import { QueryTaskDto } from "./dto/task.dto";

const EXPORT_MAX_ROWS = 10_000;
const EXPORT_CHUNK = 1_000;
const MAX_KPI_MONTHS = 6;

const INDIGO = "FF4F46E5";
const INDIGO_DARK = "FF3730A3";
const INDIGO_SOFT = "FFEEF2FF";
const INK = "FF0F172A";
const SLATE = "FF64748B";
const SLATE_DARK = "FF334155";
const SLATE_SOFT = "FFF1F5F9";
const GRID = "FFCBD5E1";
const GREEN = "FF047857";
const AMBER = "FFB45309";
const LINK = "FF2563EB";
const GOAL_GROUP_FILL: Record<string, string> = {
  ORANGE: "FFFB923C",
  GREEN: "FF22C55E",
  PURPLE: "FFA855F7",
  BLUE: "FF3B82F6",
  AMBER: "FFF59E0B",
  ROSE: "FFF43F5E",
  SLATE: "FF64748B",
};
const OKR_FILL = "FF7C3AED";
const GOAL_DESCRIPTION_MAX = 300;

const FONT_NAME = "Arial";
const FONT_SIZE = { title: 20, subtitle: 12, note: 11, section: 15, block: 13, body: 12 } as const;
const font = (size: number, extra: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({
  name: FONT_NAME,
  size,
  ...extra,
});

const CHARS_PER_WIDTH = 0.9;
const UPPERCASE_WEIGHT = 1.4;
const LINE_HEIGHT = 16;
const ROW_HEIGHT = 24;

export interface ExportRequester {
  id: string;
  roles?: string[];
}

interface ExportColumn {
  header: string;
  width: number;
  align?: "left" | "center" | "right";
}

const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "STT", width: 8, align: "center" },
  { header: "Tiêu đề", width: 58 },
  { header: "Tuyến nội dung", width: 22 },
  { header: "Dòng sản phẩm", width: 22 },
  { header: "Phân loại content", width: 24 },
  { header: "Link bài đăng", width: 62 },
];
const LAST_COL = EXPORT_COLUMNS.length;

type KpiTargetKey =
  | "total_target"
  | "content_new"
  | "content_paast_analyzed"
  | "content_win_cover"
  | "product_gmv"
  | "product_traffic"
  | "product_profit"
  | "product_collect_test_win";

interface KpiMetric {
  label: string;
  target: KpiTargetKey;
  actual: keyof EditorKpiActuals;
}

const KPI_SECTIONS: { title: string; fill: string; childFill?: string; rows: KpiMetric[] }[] = [
  {
    title: "Số video sản xuất đạt tiêu chuẩn",
    fill: "FFFB923C",
    childFill: "FFFFF7ED",
    rows: [{ label: "Tổng video sản xuất", target: "total_target", actual: "total_actual" }],
  },
  {
    title: "Content",
    fill: "FF22C55E",
    rows: [
      { label: "Content mới làm được", target: "content_new", actual: "content_new_actual" },
      { label: "Content phân tích theo PAAST", target: "content_paast_analyzed", actual: "paast_analyzed_actual" },
      { label: "Content win được team cover lại", target: "content_win_cover", actual: "content_win_cover_actual" },
    ],
  },
  {
    title: "Product",
    fill: "FFA855F7",
    rows: [
      { label: "Số sản phẩm GMV", target: "product_gmv", actual: "product_gmv_actual" },
      { label: "Số sản phẩm Traffic", target: "product_traffic", actual: "product_traffic_actual" },
      { label: "Số sản phẩm Profit", target: "product_profit", actual: "product_profit_actual" },
      { label: "Số sản phẩm sưu tầm và test win", target: "product_collect_test_win", actual: "product_collect_test_win_actual" },
    ],
  },
];

interface KpiBlock {
  month: string;
  teamName: string | null;
  setBy: string | null;
  targets: Record<KpiTargetKey, number> | null;
  actuals: EditorKpiActuals;
  contentLines: ContentLineProgress[];
  extraKpis: GoalGroup[];
  okrs: GoalRow[];
}

interface GoalRow {
  title: string;
  description: string | null;
  unit: string | null;
  lowerIsBetter: boolean;
  draft: boolean;
  target: number;
  actual: number | null;
  progress: number | null;
  progressForOverall: number;
  passed: boolean;
  thresholdPct: number;
}

interface GoalGroup {
  title: string;
  fill: string;
  order: number;
  rows: GoalRow[];
}

interface ContentLineProgress {
  label: string;
  target: number | null;
  actual: number;
  unassigned?: boolean;
}

const contentLineLabel = (name: string) => (/^tuyến/i.test(name.trim()) ? name.trim() : `Tuyến ${name.trim()}`);

interface UserGroup {
  userId: string | null;
  name: string;
  email: string;
  tasks: any[];
}

@Injectable()
export class TaskExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TaskAutoTasksService,
  ) {}

  private readonly exportInclude = {
    assignee: { select: { full_name: true, email: true } },
    content_line: { select: { name: true } },
    product_line: { select: { name: true } },
    content: {
      select: {
        code: true,
        title: true,
        classification: { select: { name: true } },
        source_team_content: {
          select: { code: true, title: true, source_editor_content: { select: { code: true, title: true } } },
        },
      },
    },
    editor_content: { select: { code: true, title: true, classification: { select: { name: true } } } },
    team_content: {
      select: {
        code: true,
        title: true,
        classification: { select: { name: true } },
        source_editor_content: { select: { code: true, title: true } },
      },
    },
    product: { select: { product_line: { select: { name: true } } } },
    editor_product: { select: { product_line: { select: { name: true } } } },
    team_product: { select: { product_line: { select: { name: true } } } },
  };

  async exportApprovedTasks(
    q: QueryTaskDto,
    requester?: ExportRequester,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const where = this.tasks.buildTaskListWhere({
      ...q,
      status: "APPROVED" as any,
      overdue: undefined,
      exclude_overdue: undefined,
    });

    const rows: any[] = [];
    for (let skip = 0; skip < EXPORT_MAX_ROWS; skip += EXPORT_CHUNK) {
      const chunk = await this.prisma.task.findMany({
        where,
        include: this.exportInclude,
        orderBy: [{ reviewed_at: "desc" }, { created_at: "desc" }],
        skip,
        take: EXPORT_CHUNK,
      });
      rows.push(...chunk);
      if (chunk.length < EXPORT_CHUNK) break;
    }

    const groups = this.groupByAssignee(rows);
    const [filterLine, kpiBlocks] = await Promise.all([
      this.describeFilters(q),
      this.loadKpiBlocks(groups, q, requester),
    ]);
    return {
      buffer: await this.buildWorkbook(groups, kpiBlocks, filterLine, rows.length >= EXPORT_MAX_ROWS),
      filename: this.buildFilename(q),
    };
  }

  private groupByAssignee(rows: any[]): UserGroup[] {
    const map = new Map<string, UserGroup>();
    for (const t of rows) {
      const key = t.assignee_id ?? "";
      const group = map.get(key) ?? {
        userId: t.assignee_id ?? null,
        name: t.assignee?.full_name || t.assignee?.email || "Chưa giao",
        email: t.assignee?.email ?? "",
        tasks: [],
      };
      group.tasks.push(t);
      map.set(key, group);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }

  private fmtDate(d: Date | null | undefined): string {
    return d ? DateTime.fromJSDate(d).setZone("Asia/Ho_Chi_Minh").toFormat("dd/MM/yyyy") : "";
  }

  private async describeFilters(q: QueryTaskDto): Promise<string> {
    const parts: string[] = [];

    if (q.reviewed_from || q.reviewed_to)
      parts.push(`Ngày duyệt: ${q.reviewed_from ? this.fmtDate(new Date(q.reviewed_from)) : "không giới hạn"} – ${q.reviewed_to ? this.fmtDate(new Date(q.reviewed_to)) : "nay"}`);
    else if (q.deadline_from || q.deadline_to)
      parts.push(`Hạn chót: ${q.deadline_from ? this.fmtDate(new Date(q.deadline_from)) : "không giới hạn"} – ${q.deadline_to ? this.fmtDate(new Date(q.deadline_to)) : "nay"}`);
    else parts.push("Toàn bộ thời gian");

    const teamIds = (q.team_id ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (teamIds.length) {
      const teams = await this.prisma.team.findMany({
        where: { id: { in: teamIds } },
        select: { name: true },
      });
      if (teams.length) parts.push(`Team: ${teams.map((t) => t.name).join(", ")}`);
    }

    if (q.assignee_id) {
      const user = await this.prisma.user.findUnique({
        where: { id: q.assignee_id },
        select: { full_name: true, email: true },
      });
      if (user) parts.push(`Người thực hiện: ${user.full_name || user.email}`);
    }

    if (q.search) parts.push(`Từ khoá: "${q.search}"`);
    if (q.task_type) parts.push(`Loại task: ${q.task_type === "auto" ? "Auto" : "Task thêm"}`);

    return parts.join("  ·  ");
  }

  private kpiMonthsFor(group: UserGroup, q: QueryTaskDto): string[] {
    const toMonth = (v?: string) => (v && /^\d{4}-\d{2}/.test(v) ? v.slice(0, 7) : undefined);
    const [from, to] =
      q.reviewed_from || q.reviewed_to
        ? [toMonth(q.reviewed_from), toMonth(q.reviewed_to)]
        : [toMonth(q.deadline_from), toMonth(q.deadline_to)];

    const taskMonths = group.tasks
      .map((t) => t.deadline ?? t.created_at)
      .filter(Boolean)
      .map((d) => vietnamMonthString(new Date(d)))
      .sort();
    let start = from ?? taskMonths[0];
    let end = to ?? taskMonths[taskMonths.length - 1];
    if (!start || !end) return [];
    if (start > end) [start, end] = [end, start];

    const months: string[] = [];
    let cursor = DateTime.fromFormat(end, "yyyy-MM");
    const first = DateTime.fromFormat(start, "yyyy-MM");
    if (!cursor.isValid || !first.isValid) return [];
    while (cursor >= first && months.length < MAX_KPI_MONTHS) {
      months.push(cursor.toFormat("yyyy-MM"));
      cursor = cursor.minus({ months: 1 });
    }
    return months;
  }

  private async kpiScopeWhere(requester?: ExportRequester): Promise<any> {
    const roles = requester?.roles ?? [];
    if (!requester?.id || roles.includes("ADMIN") || roles.includes("MANAGER")) return {};
    if (roles.includes("LEADER")) {
      const teams = await this.prisma.team.findMany({
        where: { leader_id: requester.id },
        select: { id: true },
      });
      return { team_id: { in: teams.map((t) => t.id) } };
    }
    return { user_id: requester.id };
  }

  private async loadKpiBlocks(
    groups: UserGroup[],
    q: QueryTaskDto,
    requester?: ExportRequester,
  ): Promise<Map<string, KpiBlock[]>> {
    const result = new Map<string, KpiBlock[]>();
    const monthsByUser = new Map<string, string[]>();
    for (const g of groups) {
      if (!g.userId) continue;
      const months = this.kpiMonthsFor(g, q);
      if (months.length) monthsByUser.set(g.userId, months);
    }
    if (monthsByUser.size === 0) return result;

    const teamFilter = parseTeamIdFilter(q.team_id);
    const scope = [
      {
        user_id: { in: [...monthsByUser.keys()] },
        month: { in: [...new Set([...monthsByUser.values()].flat())] },
      },
      ...(teamFilter ? [{ team_id: teamFilter }] : []),
      await this.kpiScopeWhere(requester),
    ];
    const [kpis, goals] = await Promise.all([
      this.prisma.editorKpi.findMany({
        where: { AND: scope },
        include: {
          team: { select: { name: true } },
          set_by: { select: { full_name: true } },
          allocations: {
            where: { type: "CONTENT_LINE" },
            select: { content_line_id: true, quantity: true, content_line: { select: { name: true } } },
          },
        },
      }),
      this.prisma.performanceGoal.findMany({
        where: { AND: [...scope, { status: { not: "ARCHIVED" } }] },
        include: {
          team: { select: { name: true } },
          set_by: { select: { full_name: true } },
          kpi_group: { select: { id: true, name: true, color: true, sort_order: true } },
        },
        orderBy: [{ created_at: "asc" }],
      }),
    ]);

    const placeholderTeamId = typeof teamFilter === "string" ? teamFilter : null;
    type Plan = {
      month: string;
      teamId: string | null;
      teamName: string | null;
      kpi: (typeof kpis)[number] | null;
      goals: typeof goals;
    };
    const plansByUser = new Map<string, Plan[]>();
    for (const [userId, months] of monthsByUser) {
      const plans: Plan[] = [];
      for (const month of months) {
        const goalsOfMonth = goals.filter((g) => g.user_id === userId && g.month === month);
        const ofMonth: Plan[] = kpis
          .filter((k) => k.user_id === userId && k.month === month)
          .map((k) => ({
            month,
            teamId: k.team_id,
            teamName: k.team?.name ?? null,
            kpi: k,
            goals: goalsOfMonth.filter((g) => g.team_id === k.team_id),
          }));
        for (const g of goalsOfMonth)
          if (!ofMonth.some((p) => p.teamId === g.team_id))
            ofMonth.push({
              month,
              teamId: g.team_id,
              teamName: g.team?.name ?? null,
              kpi: null,
              goals: goalsOfMonth.filter((x) => x.team_id === g.team_id),
            });
        if (ofMonth.length === 0)
          ofMonth.push({ month, teamId: placeholderTeamId, teamName: null, kpi: null, goals: [] });
        plans.push(...ofMonth.sort((a, b) => (a.teamName ?? "").localeCompare(b.teamName ?? "", "vi")));
      }
      plansByUser.set(userId, plans);
    }

    const placeholders = [...plansByUser].flatMap(([userId, plans]) =>
      plans.filter((p) => !p.kpi).map((p) => ({ month: p.month, user_id: userId, team_id: p.teamId })),
    );
    const actualMap = await computeEditorKpiActuals(this.prisma, [...kpis, ...placeholders]);
    const actualsOf = (month: string, userId: string, teamId: string | null) =>
      actualMap.get(editorKpiActualKey(month, userId, teamId)) ?? emptyEditorKpiActuals();

    const lineIds = new Set<string>();
    for (const a of actualMap.values()) Object.keys(a.content_line_actuals ?? {}).forEach((id) => lineIds.add(id));
    const lineNames = new Map<string, string>(
      lineIds.size
        ? (
            await this.prisma.contentLine.findMany({
              where: { id: { in: [...lineIds] } },
              select: { id: true, name: true },
            })
          ).map((l) => [l.id, l.name])
        : [],
    );

    for (const [userId, plans] of plansByUser)
      result.set(
        userId,
        plans.map(({ month, teamId, teamName, kpi, goals: planGoals }) => {
          const actuals = actualsOf(month, userId, teamId);
          return {
            month,
            teamName,
            setBy: kpi
              ? (kpi.set_by?.full_name ?? null)
              : [...new Set(planGoals.map((g) => g.set_by?.full_name).filter(Boolean))].join(", ") || null,
            targets: kpi
              ? (Object.fromEntries(
                  KPI_SECTIONS.flatMap((s) => s.rows).map((r) => [r.target, Number((kpi as any)[r.target] ?? 0)]),
                ) as Record<KpiTargetKey, number>)
              : null,
            actuals,
            contentLines: this.contentLineProgress(kpi?.allocations ?? [], actuals, lineNames),
            extraKpis: this.goalGroups(planGoals.filter((g) => g.type === "KPI")),
            okrs: planGoals.filter((g) => g.type === "OKR").map((g) => this.toGoalRow(g)),
          };
        }),
      );
    return result;
  }

  private goalGroups(goals: any[]): GoalGroup[] {
    const map = new Map<string, GoalGroup>();
    for (const g of goals) {
      const key = g.kpi_group?.id ?? "legacy";
      const group = map.get(key) ?? {
        title: g.kpi_group?.name ?? "KPI bổ sung",
        fill: GOAL_GROUP_FILL[g.kpi_group?.color ?? "BLUE"] ?? GOAL_GROUP_FILL.SLATE,
        order: g.kpi_group?.sort_order ?? 90,
        rows: [],
      };
      group.rows.push(this.toGoalRow(g));
      map.set(key, group);
    }
    return [...map.values()].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, "vi"));
  }

  private toGoalRow(g: any): GoalRow {
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    const target = Number(g.target_value);
    const thresholdPct = Number(g.pass_threshold_pct);
    const p = calculateGoalProgress({
      target,
      actualSystem: num(g.actual_system),
      actualManual: num(g.actual_manual),
      direction: g.direction,
      passThresholdPct: thresholdPct,
    });
    return {
      title: g.title,
      description: g.description?.trim() || null,
      unit: g.unit?.trim() || (g.metric_type === "PERCENT" ? "%" : null),
      lowerIsBetter: g.direction === "AT_MOST",
      draft: g.status === "DRAFT",
      target,
      actual: p.actualFinal,
      progress: p.progressPct === null ? null : p.progressPct / 100,
      progressForOverall: p.progressPctForOverall,
      passed: p.passed,
      thresholdPct,
    };
  }

  private contentLineProgress(
    allocations: { content_line_id: string | null; quantity: number; content_line: { name: string } | null }[],
    actuals: EditorKpiActuals,
    lineNames: Map<string, string>,
  ): ContentLineProgress[] {
    const byLine = actuals.content_line_actuals ?? {};
    const rows = new Map<string, ContentLineProgress>();
    for (const a of allocations) {
      if (!a.content_line_id) continue;
      const existing = rows.get(a.content_line_id);
      if (existing) existing.target = (existing.target ?? 0) + a.quantity;
      else
        rows.set(a.content_line_id, {
          label: contentLineLabel(a.content_line?.name ?? lineNames.get(a.content_line_id) ?? "?"),
          target: a.quantity,
          actual: byLine[a.content_line_id] ?? 0,
        });
    }
    for (const [lineId, actual] of Object.entries(byLine)) {
      if (!rows.has(lineId))
        rows.set(lineId, { label: contentLineLabel(lineNames.get(lineId) ?? "?"), target: null, actual });
    }

    const sorted = [...rows.values()].sort((a, b) =>
      a.label.localeCompare(b.label, "vi", { numeric: true, sensitivity: "base" }),
    );
    const assigned = Object.values(byLine).reduce((sum, n) => sum + n, 0);
    const unassigned = actuals.total_actual - assigned;
    if (unassigned > 0) sorted.push({ label: "Chưa gắn tuyến nội dung", target: null, actual: unassigned, unassigned: true });
    return sorted;
  }

  private resolveTitle(t: any): string {
    const g = t.content?.source_team_content;
    const candidates = [
      t.editor_content,
      t.team_content,
      t.team_content?.source_editor_content,
      t.content,
      g,
      g?.source_editor_content,
    ];
    return candidates.find((c) => c?.title)?.title ?? candidates.find((c) => c?.code)?.code ?? "";
  }

  private resolveClassification(t: any): string {
    return (
      t.content?.classification?.name ??
      t.editor_content?.classification?.name ??
      t.team_content?.classification?.name ??
      ""
    );
  }

  private resolveProductLine(t: any): string {
    return (
      t.product_line?.name ??
      t.product?.product_line?.name ??
      t.editor_product?.product_line?.name ??
      t.team_product?.product_line?.name ??
      ""
    );
  }

  private publishedUrls(t: any): string[] {
    const links: any[] = Array.isArray(t.published_links) ? t.published_links : [];
    return links.map((l) => String(l?.url ?? "").trim()).filter(Boolean);
  }

  private buildFilename(q: QueryTaskDto): string {
    const range =
      q.reviewed_from || q.reviewed_to
        ? `_${q.reviewed_from || "dau"}_${q.reviewed_to || "nay"}`
        : q.deadline_from || q.deadline_to
          ? `_${q.deadline_from || "dau"}_${q.deadline_to || "nay"}`
          : "";
    return `task-da-hoan-thanh${range}_${DateTime.now().setZone("Asia/Ho_Chi_Minh").toFormat("yyyyMMdd-HHmm")}.xlsx`;
  }

  private sheetName(raw: string, used: Set<string>): string {
    const base =
      raw.replace(/[\\/?*[\]:]/g, " ").replace(/^'+|'+$/g, "").replace(/\s+/g, " ").trim().slice(0, 31) ||
      "Không tên";
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()) || name.toLowerCase() === "history"; i++) {
      const suffix = ` (${i})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  }

  private addSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
    const ws = wb.addWorksheet(name, {
      views: [{ showGridLines: false }],
      pageSetup: {
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
      },
    });
    ws.properties.defaultRowHeight = ROW_HEIGHT;
    (ws.properties as any).tabColor = { argb: INDIGO };
    ws.columns = EXPORT_COLUMNS.map((c) => ({ width: c.width }));
    return ws;
  }

  private fitRowHeight(texts: (string | null | undefined)[], min = ROW_HEIGHT): number {
    let lines = 1;
    texts.forEach((text, i) => {
      if (!text) return;
      const perLine = Math.max(1, Math.floor(EXPORT_COLUMNS[i].width * CHARS_PER_WIDTH));
      const n = text
        .split("\n")
        .reduce((sum, part) => {
          const upper = [...part].filter((ch) => ch !== ch.toLowerCase()).length;
          const width = part.length + upper * (UPPERCASE_WEIGHT - 1);
          return sum + Math.max(1, Math.ceil(width / perLine));
        }, 0);
      lines = Math.max(lines, n);
    });
    return Math.max(min, lines * LINE_HEIGHT + 8);
  }

  private addBanner(
    ws: ExcelJS.Worksheet,
    text: string,
    cellFont: Partial<ExcelJS.Font>,
    fill?: string,
    height?: number,
  ): ExcelJS.Row {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, LAST_COL);
    const cell = row.getCell(1);
    cell.font = cellFont;
    cell.alignment = { vertical: "middle", wrapText: true, indent: fill ? 1 : 0 };
    if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } } as any;
    if (height) row.height = height;
    return row;
  }

  private writeTitle(ws: ExcelJS.Worksheet, title: string, subtitle: string, truncated: boolean) {
    this.addBanner(ws, title, font(FONT_SIZE.title, { bold: true, color: { argb: INDIGO } }), undefined, 36);
    this.addBanner(ws, subtitle, font(FONT_SIZE.subtitle, { color: { argb: SLATE_DARK } }), undefined, 22);
    this.addBanner(
      ws,
      `Xuất lúc ${DateTime.now().setZone("Asia/Ho_Chi_Minh").toFormat("dd/MM/yyyy HH:mm")} (giờ VN)`,
      font(FONT_SIZE.note, { italic: true, color: { argb: SLATE } }),
      undefined,
      20,
    );
    if (truncated)
      this.addBanner(
        ws,
        `Đã đạt giới hạn ${EXPORT_MAX_ROWS.toLocaleString("vi-VN")} task/lần xuất — có thể còn task chưa được xuất. Hãy thu hẹp khoảng ngày rồi xuất lại.`,
        font(FONT_SIZE.note, { bold: true, color: { argb: "FF92400E" } }),
        "FFFEF3C7",
        26,
      );
  }

  private writeSectionHeading(ws: ExcelJS.Worksheet, text: string) {
    ws.addRow([]).height = 14;
    const row = this.addBanner(ws, text, font(FONT_SIZE.section, { bold: true, color: { argb: INDIGO_DARK } }), undefined, 30);
    row.getCell(1).alignment = { vertical: "bottom" };
  }

  private styleCells(
    row: ExcelJS.Row,
    opts: { font?: Partial<ExcelJS.Font>; fill?: string; align?: (col: number) => "left" | "center" | "right" },
  ) {
    for (let col = 1; col <= LAST_COL; col++) {
      const cell = row.getCell(col);
      cell.font = opts.font ?? font(FONT_SIZE.body, { color: { argb: INK } });
      cell.alignment = { horizontal: opts.align?.(col) ?? "left", vertical: "middle", wrapText: true, indent: col === 1 ? 0 : 1 };
      cell.border = this.thinBorder(GRID);
      if (opts.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } } as any;
    }
  }

  private writeKpiBlock(ws: ExcelJS.Worksheet, block: KpiBlock) {
    const monthLabel = block.month.replace(/(\d{4})-(\d{2})/, "Tháng $2/$1");
    const hasGoals = block.extraKpis.length > 0 || block.okrs.length > 0;
    const head = [
      monthLabel,
      block.teamName ? `Nhóm: ${block.teamName}` : null,
      block.targets || hasGoals ? `Người đặt: ${block.setBy ?? "—"}` : null,
      block.targets
        ? null
        : hasGoals
          ? "Chưa đặt KPI cố định — chỉ hiện số thực đạt"
          : "Chưa có KPI tháng này — chỉ hiện số thực đạt",
    ].filter(Boolean);
    this.addBanner(ws, head.join("   ·   "), font(FONT_SIZE.block, { bold: true, color: { argb: INDIGO_DARK } }), INDIGO_SOFT, 30);

    const centered = (col: number) => (col === 2 || col === 6 ? "left" : "center");
    const header = ws.addRow(["#", "Chỉ tiêu", "Mục tiêu", "Thực đạt", "Tỷ lệ", "Đánh giá"]);
    this.styleCells(header, {
      font: font(FONT_SIZE.body, { bold: true, color: { argb: SLATE_DARK } }),
      fill: SLATE_SOFT,
      align: centered,
    });
    header.height = 26;

    let stt = 0;
    for (const section of KPI_SECTIONS) {
      this.addBanner(ws, section.title, font(FONT_SIZE.body, { bold: true, color: { argb: "FFFFFFFF" } }), section.fill, 24);
      for (const metric of section.rows) {
        stt++;
        this.writeKpiRow(ws, {
          stt,
          label: metric.label,
          target: block.targets ? block.targets[metric.target] : null,
          actual: Number(block.actuals[metric.actual] ?? 0),
          noTargetText: "Chưa đặt mục tiêu",
        });
        if (metric.target === "total_target")
          block.contentLines.forEach((line, i) =>
            this.writeKpiRow(ws, {
              stt: `${stt}.${i + 1}`,
              label: line.label,
              target: line.target,
              actual: line.actual,
              noTargetText: line.unassigned ? "Task chưa chọn tuyến nội dung" : "Chưa phân bổ mục tiêu",
              child: true,
              fill: section.childFill,
            }),
          );
      }
    }

    const goalSections = [
      ...block.extraKpis.map((g) => ({ title: `KPI thêm · ${g.title}`, fill: g.fill, rows: g.rows })),
      ...(block.okrs.length ? [{ title: "OKR", fill: OKR_FILL, rows: block.okrs }] : []),
    ];
    for (const section of goalSections) {
      const summary = this.goalSummary(section.rows);
      this.addBanner(
        ws,
        summary ? `${section.title}   ·   ${summary}` : section.title,
        font(FONT_SIZE.body, { bold: true, color: { argb: "FFFFFFFF" } }),
        section.fill,
        24,
      );
      for (const goal of section.rows) this.writeGoalRow(ws, ++stt, goal);
    }
  }

  private goalSummary(rows: GoalRow[]): string {
    const active = rows.filter((r) => !r.draft);
    const overall = calculateUnweightedOverall(active.map((r) => ({ progressPctForOverall: r.progressForOverall })));
    if (overall === null) return "";
    const pct = overall.toLocaleString("vi-VN", { maximumFractionDigits: 1 });
    return `Tiến độ chung ${pct}%  ·  đạt ${active.filter((r) => r.passed).length}/${active.length}`;
  }

  private writeKpiRow(
    ws: ExcelJS.Worksheet,
    r: {
      stt: number | string;
      label: string;
      target: number | null;
      actual: number;
      noTargetText: string;
      child?: boolean;
      fill?: string;
    },
  ) {
    const target = r.target;
    const reached = target !== null && target > 0 && r.actual >= target;
    const verdict = !target
      ? r.noTargetText
      : reached
        ? "Đạt"
        : `Chưa đạt — còn thiếu ${(target - r.actual).toLocaleString("vi-VN")}`;

    this.addKpiRow(ws, [r.stt, r.label, target ?? "—", r.actual, target ? r.actual / target : null, verdict], {
      tone: target ? (reached ? GREEN : AMBER) : null,
      child: r.child,
      fill: r.fill,
    });
  }

  private writeGoalRow(ws: ExcelJS.Worksheet, stt: number, g: GoalRow) {
    const fmt = (n: number) => {
      const text = n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
      return !g.unit ? text : g.unit === "%" ? `${text}%` : `${text} ${g.unit}`;
    };
    const verdict =
      g.actual === null
        ? "Chưa nhập số thực đạt"
        : g.progress === null
          ? "Chưa đặt mục tiêu"
          : g.passed
            ? "Đạt"
            : g.lowerIsBetter
              ? `Chưa đạt — cần giảm xuống ≤ ${fmt((g.target * 100) / g.thresholdPct)}`
              : `Chưa đạt — còn thiếu ${fmt((g.target * g.thresholdPct) / 100 - g.actual)} để đạt ${g.thresholdPct}%`;

    const unitInFmt = !!g.unit && !g.unit.includes("%");
    const title = [
      g.title,
      g.unit && !unitInFmt ? `(${g.unit})` : null,
      g.draft ? "(bản nháp)" : null,
      g.lowerIsBetter ? "(càng thấp càng tốt)" : null,
    ]
      .filter(Boolean)
      .join(" ");
    const description =
      g.description && g.description.length > GOAL_DESCRIPTION_MAX
        ? `${g.description.slice(0, GOAL_DESCRIPTION_MAX).trimEnd()}…`
        : g.description;
    const label: ExcelJS.CellValue = description
      ? {
          richText: [
            { text: title, font: font(FONT_SIZE.body, { color: { argb: INK } }) },
            { text: `\n${description}`, font: font(FONT_SIZE.note, { italic: true, color: { argb: SLATE } }) },
          ],
        }
      : title;

    const row = this.addKpiRow(ws, [stt, label, g.target, g.actual ?? "—", g.progress, verdict], {
      tone: g.progress === null ? null : g.passed ? GREEN : AMBER,
      height: this.fitRowHeight([null, description ? `${title}\n${description}` : title, null, null, null, verdict]),
    });
    row.getCell(3).numFmt = this.goalNumFmt(g.target, unitInFmt ? g.unit : null);
    if (g.actual !== null) row.getCell(4).numFmt = this.goalNumFmt(g.actual, unitInFmt ? g.unit : null);
  }

  private goalNumFmt(value: number, unit: string | null): string {
    const base = Number.isInteger(value) ? "#,##0" : "#,##0.##";
    const suffix = unit?.replace(/"/g, "").trim();
    return suffix ? `${base}" ${suffix}"` : base;
  }

  private addKpiRow(
    ws: ExcelJS.Worksheet,
    cells: [number | string, ExcelJS.CellValue, number | string, number | string, number | null, string],
    opts: { tone: string | null; child?: boolean; fill?: string; height?: number },
  ): ExcelJS.Row {
    const row = ws.addRow(cells);
    const ink = { argb: opts.child ? SLATE_DARK : INK };
    this.styleCells(row, {
      font: font(FONT_SIZE.body, { color: ink }),
      fill: opts.fill,
      align: (col) => (col === 2 || col === 6 ? "left" : "center"),
    });
    if (opts.child) row.getCell(2).alignment = { horizontal: "left", vertical: "middle", indent: 3 };
    row.height = opts.height ?? ROW_HEIGHT;
    row.getCell(3).numFmt = "#,##0";
    row.getCell(4).numFmt = "#,##0";
    row.getCell(4).font = font(FONT_SIZE.body, { bold: true, color: ink });
    row.getCell(5).numFmt = "0%";
    if (opts.tone) {
      row.getCell(5).font = font(FONT_SIZE.body, { bold: true, color: { argb: opts.tone } });
      row.getCell(6).font = font(FONT_SIZE.body, { bold: true, color: { argb: opts.tone } });
    } else row.getCell(6).font = font(FONT_SIZE.body, { italic: true, color: { argb: SLATE } });
    return row;
  }

  private writeTaskTable(ws: ExcelJS.Worksheet, tasks: any[], tableIndex: number) {
    const headerRow = ws.rowCount + 1;
    const urlsByRow = tasks.map((t) => this.publishedUrls(t));
    const values = tasks.map((t, i) => [
      i + 1,
      this.resolveTitle(t) || null,
      t.content_line?.name || null,
      this.resolveProductLine(t) || null,
      this.resolveClassification(t) || null,
      urlsByRow[i].join("\n") || null,
    ]);

    ws.addTable({
      name: `DanhSachTask_${tableIndex}`,
      ref: `A${headerRow}`,
      headerRow: true,
      totalsRow: false,
      style: { theme: "TableStyleMedium2", showRowStripes: true } as any,
      columns: EXPORT_COLUMNS.map((c) => ({ name: c.header, filterButton: true })),
      rows: values,
    });

    const header = ws.getRow(headerRow);
    EXPORT_COLUMNS.forEach((_, i) => {
      const cell = header.getCell(i + 1);
      cell.font = font(FONT_SIZE.body, { bold: true, color: { argb: "FFFFFFFF" } });
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INDIGO } } as any;
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = this.thinBorder(INDIGO_DARK);
    });
    header.height = 32;
    (ws.pageSetup as any).printTitlesRow = `${headerRow}:${headerRow}`;

    values.forEach((v, i) => {
      const row = ws.getRow(headerRow + 1 + i);
      this.styleCells(row, { align: (col) => EXPORT_COLUMNS[col - 1].align ?? "left" });
      row.height = this.fitRowHeight(v.map((x) => (x === null ? null : String(x))));
      const urls = urlsByRow[i];
      if (urls.length === 1 && /^https?:\/\//i.test(urls[0])) {
        const c = row.getCell(LAST_COL);
        c.value = { text: urls[0], hyperlink: urls[0] } as any;
        c.font = font(FONT_SIZE.body, { color: { argb: LINK }, underline: true });
      }
    });
  }

  private async buildWorkbook(
    groups: UserGroup[],
    kpiBlocks: Map<string, KpiBlock[]>,
    filterLine: string,
    truncated: boolean,
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = "VCB Studio AI";
    wb.created = new Date();

    if (groups.length === 0) {
      const ws = this.addSheet(wb, "Task đã hoàn thành");
      this.writeTitle(ws, "DANH SÁCH TASK ĐÃ HOÀN THÀNH", filterLine, truncated);
      ws.addRow([]);
      const empty = this.addBanner(
        ws,
        "Không có task đã hoàn thành nào khớp bộ lọc đang chọn.",
        font(FONT_SIZE.subtitle, { italic: true, color: { argb: SLATE } }),
        SLATE_SOFT,
        40,
      );
      empty.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      return Buffer.from(await wb.xlsx.writeBuffer());
    }

    const usedNames = new Set<string>();
    groups.forEach((g, index) => {
      const ws = this.addSheet(wb, this.sheetName(g.name, usedNames));
      this.writeTitle(
        ws,
        g.email && g.email !== g.name ? `${g.name}  (${g.email})` : g.name,
        `${filterLine}   ·   ${g.tasks.length.toLocaleString("vi-VN")} task đã hoàn thành`,
        truncated,
      );

      const blocks = g.userId ? (kpiBlocks.get(g.userId) ?? []) : [];
      if (blocks.length) {
        this.writeSectionHeading(ws, "BẢNG TỔNG HỢP KPI");
        const hasGoals = blocks.some((b) => b.extraKpis.length > 0 || b.okrs.length > 0);
        this.addBanner(
          ws,
          "Cùng số với tab KPI: tính trên CẢ THÁNG KPI (không theo khoảng ngày đang lọc) — video & sản phẩm tính task đã duyệt, content tính theo phân loại content gắn vào task." +
            (hasGoals ? " KPI thêm & OKR: số thực đạt do người giao nhập, đạt khi hoàn thành từ 80% mục tiêu." : ""),
          font(FONT_SIZE.note, { italic: true, color: { argb: SLATE } }),
          undefined,
          hasGoals ? 48 : 34,
        );
        blocks.forEach((b, i) => {
          if (i > 0) ws.addRow([]).height = 14;
          this.writeKpiBlock(ws, b);
        });
      }

      this.writeSectionHeading(
        ws,
        `DANH SÁCH TASK ĐÃ HOÀN THÀNH — ${g.tasks.length.toLocaleString("vi-VN")} task`,
      );
      this.writeTaskTable(ws, g.tasks, index + 1);
    });

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private thinBorder(argb: string) {
    const side = { style: "thin" as const, color: { argb } };
    return { top: side, left: side, bottom: side, right: side };
  }
}
