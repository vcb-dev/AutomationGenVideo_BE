import { Candidate, PoolContent, PoolProduct } from "../types";

/**
 * Tạo toàn bộ cặp (content × product) theo thứ tự content-outer.
 * Thứ tự trong candidates phản ánh độ "tươi" của content.
 */
export function buildCandidates(
  contents: PoolContent[],
  products: PoolProduct[],
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const content of contents) {
    for (const product of products) {
      candidates.push({
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
  return candidates;
}

/**
 * Chọn tối đa `need` cặp từ danh sách candidates, tôn trọng quota theo
 * content-line và product-line. Nếu fillStrategy = "CAPACITY" thì lấp đầy
 * phần còn lại bằng bất kỳ cặp nào chưa được chọn.
 */
export function selectPairsForEditor(
  candidates: Candidate[],
  contentQuota: Map<string, number>,
  productQuota: Map<string, number>,
  need: number,
  fillStrategy: "CAPACITY" | "RATIO",
): Candidate[] {
  const selected: Candidate[] = [];
  const chosen = new Set<string>();
  const remP = new Map(productQuota);
  const contentConstrained = contentQuota.size > 0;
  const productConstrained = productQuota.size > 0;

  const pairKey = (c: Candidate) =>
    `${c.contentSource}:${c.contentId}:${c.productSource}:${c.productId}`;

  const take = (c: Candidate) => {
    selected.push(c);
    chosen.add(pairKey(c));
    need--;
    if (productConstrained && c.productLineId) {
      remP.set(c.productLineId, (remP.get(c.productLineId) ?? 0) - 1);
    }
  };

  if (contentConstrained) {
    for (const [lineId, slots] of contentQuota) {
      const lineCandidates = candidates.filter(
        (c) => c.contentLineId === lineId,
      );
      let taken = 0;

      if (productConstrained) {
        for (const c of lineCandidates) {
          if (taken >= slots || need === 0) break;
          if (chosen.has(pairKey(c))) continue;
          if (c.productLineId != null && (remP.get(c.productLineId) ?? 0) > 0) {
            take(c);
            taken++;
          }
        }
      }

      for (const c of lineCandidates) {
        if (taken >= slots || need === 0) break;
        if (chosen.has(pairKey(c))) continue;
        take(c);
        taken++;
      }
    }
  } else if (productConstrained) {
    for (const c of candidates) {
      if (need === 0) break;
      if (chosen.has(pairKey(c))) continue;
      if (c.productLineId != null && (remP.get(c.productLineId) ?? 0) > 0)
        take(c);
    }
  }

  if (fillStrategy === "CAPACITY" && need > 0) {
    for (const c of candidates) {
      if (need === 0) break;
      if (chosen.has(pairKey(c))) continue;
      take(c);
    }
  }

  return selected;
}
