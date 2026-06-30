import { WeightedAllocation } from "../types";

/**
 * Phân bổ `total` theo tỷ lệ weight, làm tròn bằng thuật toán largest-remainder
 * để tổng luôn bằng đúng `total`.
 */
export function allocateByWeight(
  total: number,
  items: WeightedAllocation[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (total <= 0 || !items.length) return out;

  const sumW = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
  if (sumW <= 0) return out;

  const rows = items.map((i) => {
    const exact = (total * Math.max(0, i.weight)) / sumW;
    return {
      key: i.key,
      floor: Math.floor(exact),
      rem: exact - Math.floor(exact),
    };
  });

  const left = total - rows.reduce((s, r) => s + r.floor, 0);
  rows.sort((a, b) => b.rem - a.rem || (a.key < b.key ? -1 : 1));
  for (let i = 0; i < left; i++) rows[i].floor++;
  for (const r of rows) out.set(r.key, r.floor);

  return out;
}
