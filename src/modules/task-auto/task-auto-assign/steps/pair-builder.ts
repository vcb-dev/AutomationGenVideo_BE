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
 * Chọn tối đa `need` cặp từ danh sách, tôn trọng quota theo content-line
 * và product-line. Nếu fillStrategy = "CAPACITY" thì lấp đầy phần còn lại
 * bằng bất kỳ cặp nào chưa được chọn.
 */
export function selectAssignmentsForEditor(
  candidates: AssignmentPair[],
  contentQuota: Map<string, number>,
  productQuota: Map<string, number>,
  need: number,
  fillStrategy: "CAPACITY" | "RATIO",
): AssignmentPair[] {
  const selected: AssignmentPair[] = [];
  const selectedPairKeys = new Set<string>();
  const remainingProductQuota = new Map(productQuota);
  const hasContentQuota = contentQuota.size > 0;
  const hasProductQuota = productQuota.size > 0;

  const pairKey = (p: AssignmentPair) =>
    `${p.contentSource}:${p.contentId}:${p.productSource}:${p.productId}`;

  const take = (p: AssignmentPair) => {
    selected.push(p);
    selectedPairKeys.add(pairKey(p));
    need--;
    if (hasProductQuota && p.productLineId) {
      remainingProductQuota.set(p.productLineId, (remainingProductQuota.get(p.productLineId) ?? 0) - 1);
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
          if (p.productLineId != null && (remainingProductQuota.get(p.productLineId) ?? 0) > 0) {
            take(p);
            taken++;
          }
        }
      }

      for (const p of lineCandidates) {
        if (taken >= slots || need === 0) break;
        if (selectedPairKeys.has(pairKey(p))) continue;
        take(p);
        taken++;
      }
    }
  } else if (hasProductQuota) {
    for (const p of candidates) {
      if (need === 0) break;
      if (selectedPairKeys.has(pairKey(p))) continue;
      if (p.productLineId != null && (remainingProductQuota.get(p.productLineId) ?? 0) > 0)
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
