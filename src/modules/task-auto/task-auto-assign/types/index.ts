// ── Constants ─────────────────────────────────────────────────────────────────

export const DEADLINE_CALENDAR_DAYS = 1;
export const DEFAULT_TZ = "Asia/Ho_Chi_Minh";
export const FILL_STRATEGY: "CAPACITY" | "RATIO" = "CAPACITY";

// ── Source types ──────────────────────────────────────────────────────────────

export type PoolSource = "personal" | "team" | "global";

// ── Pool entries ──────────────────────────────────────────────────────────────

export type ContentPoolItem = {
  id: string;
  content_line_id: string | null;
  source: PoolSource;
  source_content_id?: string | null;
};

export type ProductPoolItem = {
  id: string;
  product_line_id: string | null;
  priority_score: number;
  source: PoolSource;
  source_product_id?: string | null;
  // Override cooldown riêng của sản phẩm; null = dùng default_cooldown_days toàn cục
  cooldown_days: number | null;
};

// ── Editor ────────────────────────────────────────────────────────────────────

export type WeightedAllocation = { key: string; weight: number };

export type EditorCapacity = {
  userId: string;
  remainingDaily: number;
  remainingMonthly: number;
  productPlanned: number;
  contentTypeWeights: WeightedAllocation[];
  productTypeWeights: WeightedAllocation[];
  // Quota còn lại trong tháng theo từng content/product line (quantity - đã giao),
  // chỉ có giá trị khi editor có allocation riêng (contentTypeWeights/productTypeWeights > 0)
  contentLineRemaining: Map<string, number>;
  productLineRemaining: Map<string, number>;
};

export type EditorAssignmentHistory = {
  assignedPairKeys: Set<string>;
  assignedContentKeys: Set<string>;
  // SP team riêng biệt đã đẩy trong tháng (đếm theo sản phẩm, không phải số task)
  pushedProductIds: Set<string>;
  // Phần đẩy trước hôm nay — giữ daily target ổn định khi chạy nhiều lần trong ngày
  pushedProductIdsBeforeToday: Set<string>;
  // productKey (personal:id/team:id/global:id) -> assigned_at gần nhất (non-cancelled),
  // dùng để tính cooldown per (editor, product) — xem steps/cooldown.ts
  lastAssignedByProduct: Map<string, Date>;
};

export function emptyEditorAssignmentHistory(): EditorAssignmentHistory {
  return {
    assignedPairKeys: new Set(),
    assignedContentKeys: new Set(),
    pushedProductIds: new Set(),
    pushedProductIdsBeforeToday: new Set(),
    lastAssignedByProduct: new Map(),
  };
}

// ── Assignment ────────────────────────────────────────────────────────────────

export type AssignmentPair = {
  contentId: string;
  contentSource: PoolSource;
  productId: string;
  productSource: PoolSource;
  contentLineId: string | null;
  productLineId: string | null;
  priorityScore: number;
};

export type ScheduledAssignment = { editorId: string; pair: AssignmentPair };

export type TeamResult = { assigned: number; skipped: number };

// ── Product target_quantity (kho tháng) ─────────────────────────────────────────

/**
 * State dùng chung, mutable, phạm vi cả team — build 1 lần trước vòng lặp editor,
 * consume dần khi mỗi editor được chốt assignment (xem steps/product-quota.ts).
 */
export type ProductQuotaState = {
  /** team_product_id -> remaining (target_quantity - tổng task không-huỷ tháng này,
   *  cộng dồn MỌI assignee). Floor tại 0. */
  teamRemaining: Map<string, number>;
  /** team_product_id -> override cho editor gốc — chỉ có khi TeamProduct.source_editor_product_id
   *  trỏ tới 1 editor đã tự warehouse đúng sản phẩm/tháng này (EditorProductWarehouse). */
  originOverride: Map<string, { editorId: string; remaining: number }>;
  /** editorId -> (editor_product_id -> remaining) — thuần cá nhân, cho lane sáng tạo. */
  personalRemaining: Map<string, Map<string, number>>;
};
