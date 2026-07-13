import { DateTime } from "luxon";
import { ProductPoolItem } from "../types";

// Trần cửa sổ lookback truy vấn lịch sử cooldown — chặn query quét quá xa nếu ai đó
// lỡ set cooldown_days rất lớn (per-product override hoặc default_cooldown_days).
export const MAX_COOLDOWN_LOOKBACK_DAYS = 60;

export function productKeyOf(product: Pick<ProductPoolItem, "source" | "id">): string {
  return `${product.source}:${product.id}`;
}

export function effectiveCooldownDays(
  override: number | null | undefined,
  defaultDays: number,
): number {
  return override ?? defaultDays;
}

/**
 * true nếu sản phẩm đang trong thời gian cooldown của editor này — tức đã được giao
 * cho editor trong vòng chưa đủ `effectiveCooldownDays` NGÀY LỊCH kể từ lần giao gần nhất.
 * cooldown_days=1 nghĩa là "không giao lại ở ngày kế tiếp", tự do lại từ ngày thứ 3.
 */
export function isOnCooldown(
  product: ProductPoolItem,
  lastAssignedByProduct: Map<string, Date>,
  defaultDays: number,
  today: DateTime,
): boolean {
  const days = effectiveCooldownDays(product.cooldown_days, defaultDays);
  if (days <= 0) return false;
  const last = lastAssignedByProduct.get(productKeyOf(product));
  if (!last) return false;
  const daysSince = today
    .startOf("day")
    .diff(DateTime.fromJSDate(last).startOf("day"), "days").days;
  return daysSince < days;
}
