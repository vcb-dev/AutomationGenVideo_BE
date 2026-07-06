import { WeightedAllocation } from "../modules/task-auto/task-auto-assign/types";

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

/**
 * Như `allocateByWeight`, nhưng mỗi key bị chặn cứng bởi `caps` (quota tháng còn lại).
 * Khi một line dùng hết cap, phần dư được chia lại (water-filling) cho các line còn quota,
 * theo đúng tỷ lệ weight ban đầu.
 */
export function allocateWithCaps(
  total: number,
  items: WeightedAllocation[],
  caps: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  if (total <= 0 || !items.length) return out;

  let pool = items
    .filter((i) => i.weight > 0 && (caps.get(i.key) ?? 0) > 0)
    .map((i) => ({ key: i.key, weight: i.weight, cap: caps.get(i.key)! }));
  let left = total;

  while (left > 0 && pool.length > 0) {
    const alloc = allocateByWeight(
      left,
      pool.map((p) => ({ key: p.key, weight: p.weight })),
    );
    const nextPool: typeof pool = [];
    let consumed = 0;
    let anyCapped = false;

    for (const p of pool) {
      const want = alloc.get(p.key) ?? 0;
      if (want >= p.cap) {
        out.set(p.key, (out.get(p.key) ?? 0) + p.cap);
        consumed += p.cap;
        anyCapped = true;
      } else {
        out.set(p.key, (out.get(p.key) ?? 0) + want);
        consumed += want;
        nextPool.push({ ...p, cap: p.cap - want });
      }
    }

    left -= consumed;
    pool = nextPool;
    if (!anyCapped) break;
  }

  return out;
}
