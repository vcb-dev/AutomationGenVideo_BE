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
};

export type EditorAssignmentHistory = {
  assignedPairKeys: Set<string>;
  assignedContentKeys: Set<string>;
  teamProductTasksThisMonth: number;
};

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
