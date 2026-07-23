import { ProductPoolItem } from "../types";

export type EmptyWarehouseNoticeMeta = {
  videosNeededToday: number;
  productKpi: {
    planned: number;
    pushedThisMonth: number;
    remaining: number;
    pendingProducts?: { id: string; name: string }[];
  } | null;
  contentLines: { id: string; name: string; count: number }[];
};

export type EmptyWarehouseNotice = {
  editorId: string;
  title: string;
  body: string;
  meta: EmptyWarehouseNoticeMeta;
};

/**
 * Xây thông báo "kho tháng rỗng" cho 1 editor không có bất kỳ cặp content×product nào để
 * tạo task (cả 3 lane — đẩy SP, sáng tạo, lấp đầy — đều rỗng). Tái sử dụng nguyên các số liệu
 * đã tính trong assignTasksForTeam (remainingDaily, pushNeed, contentQuota, lịch sử pushedProductIds),
 * không tính lại theo công thức khác.
 */
export function buildEmptyWarehouseNotice(args: {
  editorId: string;
  remainingDaily: number;
  productPlanned: number;
  pushedProductIds: Set<string>;
  pushProducts: ProductPoolItem[];
  contentQuota: Map<string, number>;
  contentLineNames: Map<string, string>;
}): EmptyWarehouseNotice | null {
  const {
    editorId,
    remainingDaily,
    productPlanned,
    pushedProductIds,
    pushProducts,
    contentQuota,
    contentLineNames,
  } = args;
  if (remainingDaily <= 0) return null;

  const pushedThisMonth = pushedProductIds.size;
  const remaining = Math.max(0, productPlanned - pushedThisMonth);

  // Chỉ liệt kê tên sản phẩm cụ thể khi kho SẢN PHẨM còn hàng (tức lý do rỗng là kho CONTENT) —
  // nếu kho sản phẩm cũng rỗng thì không có SKU cụ thể nào để nêu tên, chỉ báo số lượng còn thiếu.
  const productKpi =
    remaining > 0
      ? {
          planned: productPlanned,
          pushedThisMonth,
          remaining,
          ...(pushProducts.length > 0
            ? {
                pendingProducts: pushProducts.slice(0, remaining).map((p) => ({
                  id: p.id,
                  name: p.name ?? "(Sản phẩm chưa đặt tên)",
                })),
              }
            : {}),
        }
      : null;

  const contentLines = [...contentQuota.entries()]
    .filter(([, count]) => count > 0)
    .map(([id, count]) => ({ id, name: contentLineNames.get(id) ?? "Khác", count }));

  const summaryLine = contentLines.length
    ? `Cần làm ${remainingDaily} video hôm nay (${contentLines
        .map((l) => `${l.name}: ${l.count}`)
        .join(", ")}).`
    : `Cần làm ${remainingDaily} video hôm nay.`;

  return {
    editorId,
    title: "Không có task tự động hôm nay — kho tháng đang trống",
    body: `${summaryLine} Kho tháng chưa có content/sản phẩm để tạo task tự động.`,
    meta: { videosNeededToday: remainingDaily, productKpi, contentLines },
  };
}
