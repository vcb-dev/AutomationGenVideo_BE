import { AssignmentPair, ContentPoolItem, ProductPoolItem } from "../types";

/**
 * Tạo toàn bộ cặp (content × product) theo thứ tự content-outer.
 * Thứ tự phản ánh độ "tươi" của content.
 */
export function buildContentProductPairs(
  contents: ContentPoolItem[],
  products: ProductPoolItem[],
): AssignmentPair[] {
  const pairs: AssignmentPair[] = [];
  for (const content of contents) {
    for (const product of products) {
      pairs.push({
        contentId: content.id,
        contentSource: content.source,
        productId: product.id,
        productSource: product.source,
        contentLineId: content.content_line_id,
        productLineId: product.product_line_id,
        priorityScore: product.priority_score,
      });
    }
  }
  return pairs;
}

/**
 * Chọn tối đa `need` cặp cho lane đẩy SP theo kế hoạch.
 * Sản phẩm luôn từ kho team (caller đã sắp SP chưa đẩy trong tháng lên đầu);
 * vòng 1 lấy tối đa 1 cặp cho mỗi sản phẩm để tối đa số SP riêng biệt trong ngày,
 * vòng 2 cho phép dùng lại sản phẩm, vòng 3 lấp đầy bỏ qua quota (kể cả productStock —
 * đây là lane overflow hợp lệ khi mọi SP đã đủ target_quantity nhưng editor còn thiếu việc).
 */
export function selectPushAssignments(
  contents: ContentPoolItem[],
  products: ProductPoolItem[],
  need: number,
  assignedPairKeys: Set<string>,
  contentQuota: Map<string, number>,
  productQuota: Map<string, number>,
  productStock: Map<string, number> = new Map(),
): AssignmentPair[] {
  const selected: AssignmentPair[] = [];
  const selectedPairKeys = new Set<string>();
  const remainingContentQuota = new Map(contentQuota);
  const remainingProductQuota = new Map(productQuota);
  const remainingStock = new Map(productStock);
  const hasContentQuota = contentQuota.size > 0;
  const hasProductQuota = productQuota.size > 0;

  const key = (c: ContentPoolItem, p: ProductPoolItem) =>
    `${c.source}:${c.id}:${p.source}:${p.id}`;

  const take = (c: ContentPoolItem, p: ProductPoolItem) => {
    selected.push({
      contentId: c.id,
      contentSource: c.source,
      productId: p.id,
      productSource: p.source,
      contentLineId: c.content_line_id,
      productLineId: p.product_line_id,
      priorityScore: p.priority_score,
    });
    selectedPairKeys.add(key(c, p));
    need--;
    if (c.content_line_id != null) {
      remainingContentQuota.set(
        c.content_line_id,
        (remainingContentQuota.get(c.content_line_id) ?? 0) - 1,
      );
    }
    if (p.product_line_id != null) {
      remainingProductQuota.set(
        p.product_line_id,
        (remainingProductQuota.get(p.product_line_id) ?? 0) - 1,
      );
    }
    if (remainingStock.has(p.id)) {
      remainingStock.set(p.id, Math.max(0, remainingStock.get(p.id)! - 1));
    }
  };

  const productAllowed = (p: ProductPoolItem) =>
    (!hasProductQuota ||
      (p.product_line_id != null &&
        (remainingProductQuota.get(p.product_line_id) ?? 0) > 0)) &&
    (remainingStock.get(p.id) ?? Infinity) > 0;
  const contentAllowed = (c: ContentPoolItem) =>
    !hasContentQuota ||
    (c.content_line_id != null &&
      (remainingContentQuota.get(c.content_line_id) ?? 0) > 0);

  // Vòng 1: mỗi sản phẩm tối đa 1 cặp — ưu tiên phủ nhiều SP riêng biệt
  // Vòng 2: cho phép dùng lại sản phẩm với content khác
  for (const onePerProduct of [true, false]) {
    for (const p of products) {
      if (need === 0) return selected;
      if (!productAllowed(p)) continue;
      for (const c of contents) {
        if (!contentAllowed(c)) continue;
        const k = key(c, p);
        if (assignedPairKeys.has(k) || selectedPairKeys.has(k)) continue;
        take(c, p);
        if (onePerProduct || !productAllowed(p)) break;
        if (need === 0) return selected;
      }
    }
  }

  // Vòng 3: lấp đầy bỏ qua quota (CAPACITY)
  for (const p of products) {
    if (need === 0) break;
    for (const c of contents) {
      if (need === 0) break;
      const k = key(c, p);
      if (assignedPairKeys.has(k) || selectedPairKeys.has(k)) continue;
      take(c, p);
    }
  }

  return selected;
}

/**
 * Chọn tối đa `need` cặp từ danh sách, tôn trọng quota theo content-line
 * và product-line, cũng như productStock (target_quantity còn lại của sản phẩm
 * cá nhân — vắng mặt trong map nghĩa là không giới hạn, vd sản phẩm global).
 * Nếu fillStrategy = "CAPACITY" thì lấp đầy phần còn lại bằng bất kỳ cặp nào
 * chưa được chọn, kể cả sản phẩm đã hết productStock (overflow hợp lệ).
 */
export function selectAssignmentsForEditor(
  candidates: AssignmentPair[],
  contentQuota: Map<string, number>,
  productQuota: Map<string, number>,
  need: number,
  fillStrategy: "CAPACITY" | "RATIO",
  productStock: Map<string, number> = new Map(),
): AssignmentPair[] {
  const selected: AssignmentPair[] = [];
  const selectedPairKeys = new Set<string>();
  const remainingProductQuota = new Map(productQuota);
  const remainingStock = new Map(productStock);
  const hasContentQuota = contentQuota.size > 0;
  const hasProductQuota = productQuota.size > 0;

  const pairKey = (p: AssignmentPair) =>
    `${p.contentSource}:${p.contentId}:${p.productSource}:${p.productId}`;
  const stockAllowed = (p: AssignmentPair) =>
    (remainingStock.get(p.productId) ?? Infinity) > 0;

  const take = (p: AssignmentPair) => {
    selected.push(p);
    selectedPairKeys.add(pairKey(p));
    need--;
    if (hasProductQuota && p.productLineId) {
      remainingProductQuota.set(
        p.productLineId,
        (remainingProductQuota.get(p.productLineId) ?? 0) - 1,
      );
    }
    if (remainingStock.has(p.productId)) {
      remainingStock.set(p.productId, Math.max(0, remainingStock.get(p.productId)! - 1));
    }
  };

  if (hasContentQuota) {
    for (const [lineId, slots] of contentQuota) {
      const lineCandidates = candidates.filter(
        (p) => p.contentLineId === lineId,
      );
      let taken = 0;

      if (hasProductQuota) {
        for (const p of lineCandidates) {
          if (taken >= slots || need === 0) break;
          if (selectedPairKeys.has(pairKey(p))) continue;
          if (
            p.productLineId != null &&
            (remainingProductQuota.get(p.productLineId) ?? 0) > 0 &&
            stockAllowed(p)
          ) {
            take(p);
            taken++;
          }
        }
      }

      for (const p of lineCandidates) {
        if (taken >= slots || need === 0) break;
        if (selectedPairKeys.has(pairKey(p))) continue;
        if (!stockAllowed(p)) continue;
        take(p);
        taken++;
      }
    }
  } else if (hasProductQuota) {
    for (const p of candidates) {
      if (need === 0) break;
      if (selectedPairKeys.has(pairKey(p))) continue;
      if (
        p.productLineId != null &&
        (remainingProductQuota.get(p.productLineId) ?? 0) > 0 &&
        stockAllowed(p)
      )
        take(p);
    }
  }

  // Phase tôn trọng stock nhưng bỏ qua line-quota — cần thiết vì khi editor
  // không có content/product-line allocation nào (hasContentQuota/hasProductQuota
  // đều false), 2 nhánh trên bị bỏ qua hoàn toàn và selection sẽ rơi thẳng
  // xuống fill CAPACITY cuối — nếu không có phase này, productStock sẽ luôn
  // bị bỏ qua với các editor dạng đó.
  if (need > 0) {
    for (const p of candidates) {
      if (need === 0) break;
      if (selectedPairKeys.has(pairKey(p))) continue;
      if (!stockAllowed(p)) continue;
      take(p);
    }
  }

  if (fillStrategy === "CAPACITY" && need > 0) {
    for (const p of candidates) {
      if (need === 0) break;
      if (selectedPairKeys.has(pairKey(p))) continue;
      take(p);
    }
  }

  return selected;
}
