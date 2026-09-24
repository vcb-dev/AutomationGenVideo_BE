import {
  classifyPublishedLinksWinFail,
  PublishedLinkLike,
} from "../tasks/published-link-win-fail.util";
import { PAAST_CLASSIFICATION_NAME } from "../tasks/paast-classification.util";
import { deadlineWindow } from "../tasks/deadline-window.util";
import { vietnamMonthRange } from "../../../utils/date.utils";
import {
  productLineCategoryLabel,
  resolveTaskProductLineId,
  ProductLineLookup,
} from "../tasks/product-line-category.util";

/** Khoá tra cứu theo ContentClassification.name — đổi tên phân loại sẽ làm số thực đạt về 0. */
export const CONTENT_NEW_CLASSIFICATION_NAME = "Mới";

/** Nhãn productLineCategoryLabel() ứng với 3 chỉ tiêu sản phẩm. */
const PRODUCT_CATEGORY_GMV = "GMV";
const PRODUCT_CATEGORY_TRAFFIC = "TRAFFIC";
const PRODUCT_CATEGORY_PROFIT = "PROFIT";

/**
 * Khoá tra cứu của `product_collect_test_win` (seed ở migration 20260924120000). Khớp theo name HOẶC
 * video_category chứ không qua productLineCategoryLabel(), để vẫn nhận ra dòng "Sưu tầm" khi leader
 * gán thêm video_category cho nó.
 */
export const PRODUCT_COLLECT_LINE_NAME = "Sưu tầm";

/** DB đang có cả "Mới" và "mới" (2 bản ghi khác nhau) nên so khớp bỏ qua hoa-thường. */
const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** Số thực đạt, đối xứng 1-1 với các cột target của EditorKpi. */
export interface EditorKpiActuals {
  total_actual: number;
  content_new_actual: number;
  paast_analyzed_actual: number;
  /** Cùng công thức với `video_win_actual`, khác chỉ tiêu đem ra so. */
  content_win_cover_actual: number;
  /** "fail" = đã cào được view nhưng không vượt ngưỡng; chưa cào được view thì không tính. */
  video_win_actual: number;
  video_fail_actual: number;
  /** Đếm sản phẩm riêng biệt, không đếm task. */
  product_gmv_actual: number;
  product_traffic_actual: number;
  product_profit_actual: number;
  product_collect_test_win_actual: number;
  /** content_line_id → số task APPROVED. */
  content_line_actuals: Record<string, number>;
}

export const emptyEditorKpiActuals = (): EditorKpiActuals => ({
  total_actual: 0,
  content_new_actual: 0,
  paast_analyzed_actual: 0,
  content_win_cover_actual: 0,
  video_win_actual: 0,
  video_fail_actual: 0,
  product_gmv_actual: 0,
  product_traffic_actual: 0,
  product_profit_actual: 0,
  product_collect_test_win_actual: 0,
  content_line_actuals: {},
});

export interface EditorKpiActualTask {
  assignee_id: string | null;
  team_id: string | null;
  status: string;
  published_links: unknown;
  content_line_id: string | null;
  content_id: string | null;
  editor_content_id: string | null;
  team_content_id: string | null;
  product_line_id: string | null;
  product_id: string | null;
  editor_product_id: string | null;
  team_product_id: string | null;
}

export interface EditorKpiActualLookup {
  /** id content → tên phân loại, tách theo 3 kho content. */
  classificationByContentId: Map<string, string | null>;
  classificationByEditorContentId: Map<string, string | null>;
  classificationByTeamContentId: Map<string, string | null>;
  productLine: ProductLineLookup;
  /** product_line_id → nhãn dòng (GMV/TRAFFIC/PROFIT...). */
  categoryByLineId: Map<string, string>;
  /** Các product_line_id được coi là dòng "Sưu tầm" (theo name hoặc video_category). */
  collectLineIds: Set<string>;
}

interface Bucket {
  total: number;
  contentNew: number;
  paast: number;
  win: number;
  fail: number;
  productKeysByCategory: Map<string, Set<string>>;
  collectWinProductKeys: Set<string>;
  byContentLine: Map<string, number>;
}

const newBucket = (): Bucket => ({
  total: 0,
  contentNew: 0,
  paast: 0,
  win: 0,
  fail: 0,
  productKeysByCategory: new Map(),
  collectWinProductKeys: new Set(),
  byContentLine: new Map(),
});

/** Khoá bucket trong tháng: mỗi (editor, team) một bucket, cộng thêm bucket "ALL" gộp mọi team cho
 * dòng KPI legacy (team_id null, có trước multi-team). */
export const editorKpiActualBucketKey = (
  userId: string,
  teamId: string | null,
): string => `${userId}|${teamId ?? "ALL"}`;

/**
 * Gộp task của 1 tháng (đã lọc sẵn: bỏ CANCELLED, theo deadlineWindow()) thành số thực đạt cho từng
 * (editor, team). Chỉ tiêu content tính mọi task còn lại, không đợi duyệt video; chỉ tiêu video /
 * win / sản phẩm chỉ tính task APPROVED.
 */
export function aggregateEditorKpiActuals(
  tasks: EditorKpiActualTask[],
  lookup: EditorKpiActualLookup,
): Map<string, EditorKpiActuals> {
  const buckets = new Map<string, Bucket>();
  const bucketsOf = (userId: string, teamId: string | null): Bucket[] => {
    const keys = [
      editorKpiActualBucketKey(userId, teamId),
      ...(teamId ? [editorKpiActualBucketKey(userId, null)] : []),
    ];
    return keys.map((k) => {
      const existing = buckets.get(k) ?? newBucket();
      buckets.set(k, existing);
      return existing;
    });
  };

  for (const task of tasks) {
    if (!task.assignee_id) continue;
    const targets = bucketsOf(task.assignee_id, task.team_id);

    const classification =
      (task.content_id
        ? lookup.classificationByContentId.get(task.content_id)
        : null) ??
      (task.editor_content_id
        ? lookup.classificationByEditorContentId.get(task.editor_content_id)
        : null) ??
      (task.team_content_id
        ? lookup.classificationByTeamContentId.get(task.team_content_id)
        : null) ??
      null;
    const isContentNew =
      norm(classification) === norm(CONTENT_NEW_CLASSIFICATION_NAME);
    const isPaast = norm(classification) === norm(PAAST_CLASSIFICATION_NAME);

    const isApproved = task.status === "APPROVED";
    const winFail = isApproved
      ? classifyPublishedLinksWinFail(
          task.published_links as PublishedLinkLike[] | null,
        ).status
      : "pending";
    const isWin = winFail === "win";

    // Task gắn tối đa 1 trong 3 kho sản phẩm, như getProductVideoStats().
    const productKey =
      task.product_id ?? task.editor_product_id ?? task.team_product_id ?? null;
    const lineId = resolveTaskProductLineId(task, lookup.productLine);
    const category = lineId ? lookup.categoryByLineId.get(lineId) : undefined;
    const isCollectLine = !!lineId && lookup.collectLineIds.has(lineId);

    for (const bucket of targets) {
      if (isContentNew) bucket.contentNew++;
      if (isPaast) bucket.paast++;
      if (!isApproved) continue;
      bucket.total++;
      if (task.content_line_id)
        bucket.byContentLine.set(
          task.content_line_id,
          (bucket.byContentLine.get(task.content_line_id) ?? 0) + 1,
        );
      if (isWin) bucket.win++;
      else if (winFail === "fail") bucket.fail++;
      if (productKey && category) {
        const set = bucket.productKeysByCategory.get(category) ?? new Set();
        set.add(productKey);
        bucket.productKeysByCategory.set(category, set);
      }
      if (productKey && isCollectLine && isWin)
        bucket.collectWinProductKeys.add(productKey);
    }
  }

  const result = new Map<string, EditorKpiActuals>();
  for (const [key, b] of buckets) {
    const distinct = (category: string) =>
      b.productKeysByCategory.get(category)?.size ?? 0;
    result.set(key, {
      total_actual: b.total,
      content_new_actual: b.contentNew,
      paast_analyzed_actual: b.paast,
      content_win_cover_actual: b.win,
      video_win_actual: b.win,
      video_fail_actual: b.fail,
      product_gmv_actual: distinct(PRODUCT_CATEGORY_GMV),
      product_traffic_actual: distinct(PRODUCT_CATEGORY_TRAFFIC),
      product_profit_actual: distinct(PRODUCT_CATEGORY_PROFIT),
      product_collect_test_win_actual: b.collectWinProductKeys.size,
      content_line_actuals: Object.fromEntries(b.byContentLine),
    });
  }
  return result;
}

export { productLineCategoryLabel };

/** Khai báo hẹp để gọi được từ mọi service mà không cần DI. */
type PrismaLike = {
  task: { findMany: (args: any) => Promise<any[]> };
  content: { findMany: (args: any) => Promise<any[]> };
  editorContent: { findMany: (args: any) => Promise<any[]> };
  teamContent: { findMany: (args: any) => Promise<any[]> };
  product: { findMany: (args: any) => Promise<any[]> };
  editorProduct: { findMany: (args: any) => Promise<any[]> };
  teamProduct: { findMany: (args: any) => Promise<any[]> };
  productLine: { findMany: (args: any) => Promise<any[]> };
};

export const editorKpiActualKey = (
  month: string,
  userId: string,
  teamId: string | null,
): string => `${month}|${editorKpiActualBucketKey(userId, teamId)}`;

/** Gom truy vấn theo tháng (1 findMany/tháng) thay vì mỗi dòng KPI 1 query. */
export async function computeEditorKpiActuals(
prisma: PrismaLike,
rows: { month: string; user_id: string; team_id: string | null }[],
): Promise<Map<string, EditorKpiActuals>> {
  const result = new Map<string, EditorKpiActuals>();
  if (rows.length === 0) return result;

  const userIdsByMonth = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = userIdsByMonth.get(r.month) ?? new Set<string>();
    set.add(r.user_id);
    userIdsByMonth.set(r.month, set);
  }

  await Promise.all(
    [...userIdsByMonth.entries()].map(async ([month, userIds]) => {
      const range = vietnamMonthRange(month);
      if (!range) return;
      const tasks = await prisma.task.findMany({
        where: {
          AND: [
            {
              assignee_id: { in: [...userIds] },
              status: { not: "CANCELLED" },
            },
            deadlineWindow(range),
          ],
        },
        select: {
          assignee_id: true,
          team_id: true,
          status: true,
          published_links: true,
          content_line_id: true,
          content_id: true,
          editor_content_id: true,
          team_content_id: true,
          product_line_id: true,
          product_id: true,
          editor_product_id: true,
          team_product_id: true,
        },
      });
      if (tasks.length === 0) return;

      const lookup = await loadEditorKpiActualLookup(prisma, tasks);
      for (const [key, actuals] of aggregateEditorKpiActuals(tasks, lookup)) {
        result.set(`${month}|${key}`, actuals);
      }
    }),
  );

  return result;
}

/** Cùng chuỗi tra cứu với getContentByClassification() và getProductVideoStats(). */
async function loadEditorKpiActualLookup(
prisma: PrismaLike,
tasks: EditorKpiActualTask[],
): Promise<EditorKpiActualLookup> {
  const ids = (pick: (t: EditorKpiActualTask) => string | null) => [
    ...new Set(tasks.map(pick).filter((id): id is string => !!id)),
  ];
  const contentIds = ids((t) => t.content_id);
  const editorContentIds = ids((t) => t.editor_content_id);
  const teamContentIds = ids((t) => t.team_content_id);
  const productIds = ids((t) => t.product_id);
  const editorProductIds = ids((t) => t.editor_product_id);
  const teamProductIds = ids((t) => t.team_product_id);

  const classificationSelect = {
    id: true,
    classification: { select: { name: true } },
  };
  const productLineSelect = { id: true, product_line_id: true };
  const findMany = <T>(
    idList: string[],
    run: (list: string[]) => Promise<T[]>,
  ): Promise<T[]> => (idList.length > 0 ? run(idList) : Promise.resolve([]));

  const [
    contents,
    editorContents,
    teamContents,
    products,
    editorProducts,
    teamProducts,
    productLines,
  ] = await Promise.all([
    findMany(contentIds, (list) =>
      prisma.content.findMany({
        where: { id: { in: list } },
        select: classificationSelect,
      }),
    ),
    findMany(editorContentIds, (list) =>
      prisma.editorContent.findMany({
        where: { id: { in: list } },
        select: classificationSelect,
      }),
    ),
    findMany(teamContentIds, (list) =>
      prisma.teamContent.findMany({
        where: { id: { in: list } },
        select: classificationSelect,
      }),
    ),
    findMany(productIds, (list) =>
      prisma.product.findMany({
        where: { id: { in: list } },
        select: productLineSelect,
      }),
    ),
    findMany(editorProductIds, (list) =>
      prisma.editorProduct.findMany({
        where: { id: { in: list } },
        select: productLineSelect,
      }),
    ),
    findMany(teamProductIds, (list) =>
      prisma.teamProduct.findMany({
        where: { id: { in: list } },
        select: productLineSelect,
      }),
    ),
    prisma.productLine.findMany({
      select: { id: true, name: true, video_category: true },
    }),
  ]);

  const classificationMap = (
    list: { id: string; classification: { name: string } | null }[],
  ) => new Map(list.map((c) => [c.id, c.classification?.name ?? null]));
  const lineMap = (list: { id: string; product_line_id: string | null }[]) =>
    new Map(list.map((p) => [p.id, p.product_line_id]));

  return {
    classificationByContentId: classificationMap(contents),
    classificationByEditorContentId: classificationMap(editorContents),
    classificationByTeamContentId: classificationMap(teamContents),
    productLine: {
      byProductId: lineMap(products),
      byEditorProductId: lineMap(editorProducts),
      byTeamProductId: lineMap(teamProducts),
    },
    categoryByLineId: new Map(
      productLines.map((l) => [l.id, productLineCategoryLabel(l)]),
    ),
    collectLineIds: new Set(
      productLines
        .filter((l) =>
          [l.name, l.video_category].some(
            (v) =>
              (v ?? "").trim().toLowerCase() ===
              PRODUCT_COLLECT_LINE_NAME.toLowerCase(),
          ),
        )
        .map((l) => l.id),
    ),
  };
}
