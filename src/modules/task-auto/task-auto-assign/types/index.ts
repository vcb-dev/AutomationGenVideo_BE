// ── Constants ─────────────────────────────────────────────────────────────────

export const DEADLINE_CALENDAR_DAYS = 1;
export const DEFAULT_TZ = "Asia/Ho_Chi_Minh";
export const FILL_STRATEGY: "CAPACITY" | "RATIO" = "CAPACITY";

// ── Source types ──────────────────────────────────────────────────────────────

export type ContentSource = "personal" | "team" | "global";
export type ProductSource = "personal" | "team" | "global";

// ── Pool entries ──────────────────────────────────────────────────────────────

export type PoolContent = {
  id: string;
  content_line_id: string | null;
  source: ContentSource;
  source_content_id?: string | null;
};

export type PoolProduct = {
  id: string;
  product_line_id: string | null;
  priority_score: number;
  source: ProductSource;
  source_product_id?: string | null;
};

// ── Editor ────────────────────────────────────────────────────────────────────

export type QuotaItem = { key: string; weight: number };

export type EditorSlot = {
  userId: string;
  remainingDaily: number;
  remainingMonthly: number;
  productPlanned: number;
  contentTypeWeights: QuotaItem[];
  productTypeWeights: QuotaItem[];
};

export type EditorStats = {
  existingPairs: Set<string>;
  usedContentKeys: Set<string>;
  teamProductTaskCount: number;
};

// ── Pairing ───────────────────────────────────────────────────────────────────

export type Candidate = {
  contentId: string;
  contentSource: ContentSource;
  productId: string;
  productSource: ProductSource;
  contentLineId: string | null;
  productLineId: string | null;
  priorityScore: number;
};

export type Pairing = { editorId: string; candidate: Candidate };

export type TeamResult = { assigned: number; skipped: number };
