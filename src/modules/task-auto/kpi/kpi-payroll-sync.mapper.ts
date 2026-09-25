export const KPI_PAYROLL_SYNC_CONTRACT_VERSION = "1.2";

export const KPI_GROUP = {
  VIDEO_PRODUCTION: "VIDEO_PRODUCTION",
  CONTENT: "CONTENT",
  PRODUCT: "PRODUCT",
  CONTENT_CREATOR: "AGV_CONTENT_CREATOR_MONTHLY",
} as const;

export type KpiPayrollSyncWarningCode =
  | "MISSING_EMPLOYEE_ID"
  | "UNKNOWN_CONTENT_LINE_CODE"
  | "DUPLICATE_METRIC"
  | "UNSCOPED_CREATOR_ACTUAL"
  | "UNSCOPED_EDITOR_ACTUAL"
  | "NO_ACTUAL_SOURCE"
  | "UNKNOWN_PRODUCT_LINE_CATEGORY";

export interface KpiPayrollSyncWarning {
  code: KpiPayrollSyncWarningCode;
  user_id?: string;
  message: string;
}

export interface KpiPayrollSyncRecord {
  user_id: string;
  employee_id: string | null;
  group_code: string;
  metric_code: string;
  target: number | null;
  actual: number | null;
}

export interface KpiPayrollSyncResponse {
  contract_version: string;
  month: string;
  team: { id: string; name: string };
  generated_at: string;
  records: KpiPayrollSyncRecord[];
  warnings: KpiPayrollSyncWarning[];
}

export interface MetricContribution {
  user_id: string;
  group_code: string;
  metric_code: string;
  target: number | null;
  actual: number | null;
}

export interface EditorKpiInput {
  user_id: string;
  total_target: number;
  video_win: number;
  video_fail: number;
  content_new: number;
  content_collected: number;
  content_win_cover: number;
  product_planned: number;
  product_win_collect: number;
  product_profit: number;
  product_collect_test_win: number;
  allocations?: Array<{
    type: string;
    quantity: number;
    content_line?: ContentLineLike | null;
  }> | null;
}

export interface ContentLineLike {
  id: string;
  a_type: string | null;
  name?: string | null;
}

export interface ContentCreatorInput {
  user_id: string;
  target: { content_target: number; translation_target: number } | null;
  actual: {
    content_collected: number;
    translations_count: number;
    videos_made: number;
    win: number;
    fail: number;
  } | null;
}

export interface EditorActualInput {
  videos_approved: number | null;
  win: number | null;
  fail: number | null;
  product_gmv: number | null;
  product_traffic: number | null;
  product_profit: number | null;
  product_collect_test_win: number | null;
  content_new: number | null;
  content_collected: number | null;
  content_win_cover: number | null;
}

export const METRICS_WITHOUT_ACTUAL_SOURCE: readonly string[] = [];

export const PRODUCT_CATEGORY_TO_METRIC: Record<string, string> = {
  GMV: "PRODUCT_PLANNED",
  TRAFFIC: "PRODUCT_COLLECTED",
  PROFIT: "PRODUCT_PROFIT",
};

export const PRODUCT_COLLECT_TEST_WIN_METRIC = "PRODUCT_COLLECT_TEST_WIN";

export function mapEditorKpi(
  kpi: EditorKpiInput,
  actual: EditorActualInput,
): MetricContribution[] {
  const at = (
    group_code: string,
    metric_code: string,
    target: number | null,
    actualValue: number | null,
  ) => ({ user_id: kpi.user_id, group_code, metric_code, target, actual: actualValue });

  return [
    at(KPI_GROUP.VIDEO_PRODUCTION, "TOTAL_VIDEO", kpi.total_target, actual.videos_approved),
    at(KPI_GROUP.VIDEO_PRODUCTION, "VIDEO_WIN", kpi.video_win, actual.win),
    at(KPI_GROUP.VIDEO_PRODUCTION, "VIDEO_FAIL", kpi.video_fail, actual.fail),
    at(KPI_GROUP.CONTENT, "CONTENT_NEW", kpi.content_new, actual.content_new),
    at(KPI_GROUP.CONTENT, "CONTENT_COLLECTED", kpi.content_collected, actual.content_collected),
    at(KPI_GROUP.CONTENT, "CONTENT_WIN_COVER", kpi.content_win_cover, actual.content_win_cover),
    at(KPI_GROUP.PRODUCT, "PRODUCT_PLANNED", kpi.product_planned, actual.product_gmv),
    at(KPI_GROUP.PRODUCT, "PRODUCT_COLLECTED", kpi.product_win_collect, actual.product_traffic),
    at(KPI_GROUP.PRODUCT, "PRODUCT_PROFIT", kpi.product_profit, actual.product_profit),
    at(
      KPI_GROUP.PRODUCT,
      PRODUCT_COLLECT_TEST_WIN_METRIC,
      kpi.product_collect_test_win,
      actual.product_collect_test_win,
    ),
  ];
}

export const CONTENT_ROUTE_CODES = ["A1", "A2", "A3", "A4", "A5"] as const;
export type ContentRouteCode = (typeof CONTENT_ROUTE_CODES)[number];

export function contentRouteCodeOf(
  line: ContentLineLike | null | undefined,
): ContentRouteCode | null {
  for (const candidate of [line?.a_type, line?.name]) {
    const code = (candidate ?? "").trim().toUpperCase();
    if ((CONTENT_ROUTE_CODES as readonly string[]).includes(code)) return code as ContentRouteCode;
  }
  return null;
}

export function mapEditorContentRoutes(
  kpi: EditorKpiInput,
  routeActuals: Partial<Record<ContentRouteCode, number>> | null,
): {
  contributions: MetricContribution[];
  warnings: KpiPayrollSyncWarning[];
} {
  const warnings: KpiPayrollSyncWarning[] = [];
  const targetByRoute = new Map<ContentRouteCode, number>();

  for (const alloc of kpi.allocations ?? []) {
    if (alloc.type !== "CONTENT_LINE") continue;
    const code = contentRouteCodeOf(alloc.content_line);
    if (!code) {
      const raw =
        (alloc.content_line?.a_type ?? "").trim() || (alloc.content_line?.name ?? "").trim();
      warnings.push({
        code: "UNKNOWN_CONTENT_LINE_CODE",
        user_id: kpi.user_id,
        message: `Allocation content line không quy được về A1..A5 (${raw || "rỗng"}), đã bỏ qua`,
      });
      continue;
    }
    targetByRoute.set(code, (targetByRoute.get(code) ?? 0) + alloc.quantity);
  }

  const contributions = CONTENT_ROUTE_CODES.filter(
    (code) => targetByRoute.has(code) || routeActuals?.[code] !== undefined,
  ).map((code) => ({
    user_id: kpi.user_id,
    group_code: KPI_GROUP.VIDEO_PRODUCTION,
    metric_code: `CONTENT_ROUTE_${code}`,
    target: targetByRoute.get(code) ?? null,
    actual: routeActuals ? routeActuals[code] ?? 0 : null,
  }));

  return { contributions, warnings };
}

export function mapContentCreator(input: ContentCreatorInput): MetricContribution[] {
  const { user_id, target, actual } = input;
  const at = (metric_code: string, t: number | null, a: number | null) => ({
    user_id,
    group_code: KPI_GROUP.CONTENT_CREATOR,
    metric_code,
    target: t,
    actual: a,
  });

  return [
    at(
      "CONTENT_COLLECTED",
      target ? target.content_target : null,
      actual ? actual.content_collected : null,
    ),
    at(
      "TRANSLATIONS",
      target ? target.translation_target : null,
      actual ? actual.translations_count : null,
    ),
    at("VIDEOS_MADE", null, actual ? actual.videos_made : null),
    at("CONTENT_WIN", null, actual ? actual.win : null),
    at("CONTENT_FAIL", null, actual ? actual.fail : null),
  ];
}

const keyOf = (c: { user_id: string; group_code: string; metric_code: string }) =>
  `${c.user_id} ${c.group_code} ${c.metric_code}`;

export function mergeContributions(
  contributions: MetricContribution[],
  employeeIdOf: (userId: string) => string | null,
): { records: KpiPayrollSyncRecord[]; warnings: KpiPayrollSyncWarning[] } {
  const warnings: KpiPayrollSyncWarning[] = [];
  const merged = new Map<string, KpiPayrollSyncRecord>();

  for (const c of contributions) {
    const key = keyOf(c);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        user_id: c.user_id,
        employee_id: employeeIdOf(c.user_id),
        group_code: c.group_code,
        metric_code: c.metric_code,
        target: c.target,
        actual: c.actual,
      });
      continue;
    }

    for (const field of ["target", "actual"] as const) {
      const incoming = c[field];
      if (incoming === null) continue;
      if (existing[field] === null) {
        existing[field] = incoming;
      } else if (existing[field] !== incoming) {
        warnings.push({
          code: "DUPLICATE_METRIC",
          user_id: c.user_id,
          message: `Hai nguồn cho ${field} khác nhau ở ${c.group_code}/${c.metric_code} (giữ ${existing[field]}, bỏ ${incoming})`,
        });
      }
    }
  }

  const records = Array.from(merged.values()).filter(
    (r) => r.target !== null || r.actual !== null,
  );

  records.sort(
    (a, b) =>
      a.user_id.localeCompare(b.user_id) ||
      a.group_code.localeCompare(b.group_code) ||
      a.metric_code.localeCompare(b.metric_code),
  );

  return { records, warnings };
}

export function missingEmployeeIdWarnings(
  records: KpiPayrollSyncRecord[],
): KpiPayrollSyncWarning[] {
  const seen = new Set<string>();
  const warnings: KpiPayrollSyncWarning[] = [];
  for (const r of records) {
    if (r.employee_id !== null || seen.has(r.user_id)) continue;
    seen.add(r.user_id);
    warnings.push({
      code: "MISSING_EMPLOYEE_ID",
      user_id: r.user_id,
      message: "User chưa có employee_id",
    });
  }
  return warnings;
}
