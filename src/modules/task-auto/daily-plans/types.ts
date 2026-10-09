// ── Constants ─────────────────────────────────────────────────────────────────

/** Không gợi ý lại content người đó đã làm trong chừng này NGÀY LỊCH. */
export const CONTENT_REUSE_COOLDOWN_DAYS = 14;
/** Lịch sử task quét để xếp "lâu chưa làm" — rộng hơn cooldown để phân biệt content cũ/chưa từng làm. */
export const CONTENT_HISTORY_LOOKBACK_DAYS = 60;
/** Mỗi loại gợi ý (content kho / video win) lấy gấp đôi số video còn thiếu, tối thiểu 3 để có lựa chọn. */
export const SUGGESTIONS_PER_MISSING_VIDEO = 2;
export const MIN_SUGGESTIONS = 3;
/** Video win = > 10K view, khớp lưới "Video win" ở Kho content (WinVideosGrid min_plays=10001). */
export const WIN_VIDEO_MIN_VIEWS = 10001;
export const WIN_VIDEO_LOOKBACK_DAYS = 90;
export const WIN_VIDEO_POOL_SIZE = 100;
/** Giới hạn số gợi ý tạo task trong 1 request tạo nhanh. */
export const MAX_QUICK_CREATE = 20;
/**
 * Gợi ý đã giữ chỗ (used_at) mà quá chừng này vẫn chưa gắn task = lần tạo đó đã hỏng giữa chừng hoặc
 * task tạo ra đã bị xoá (task_id tự về NULL) → coi như chưa dùng, cho tạo lại.
 */
export const SUGGESTION_CLAIM_TIMEOUT_MS = 2 * 60_000;

export function suggestionClaimCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - SUGGESTION_CLAIM_TIMEOUT_MS);
}

// ── Content ───────────────────────────────────────────────────────────────────

export type ContentSource = "editor" | "team" | "global";

export type ContentRef = { source: ContentSource; id: string };

/** Content trong 1 kho, đã resolve tuyến/tiêu đề qua bản gốc (kho team/kho tổng có thể không tự lưu data). */
export type ContentCandidate = ContentRef & {
  /** 0 = kho cá nhân, 1 = kho team, 2 = kho tổng — ưu tiên kho gần người làm hơn */
  tier: number;
  /** Chủ kho cá nhân — chỉ gợi ý content kho cá nhân cho đúng người đó */
  ownerUserId: string | null;
  /** Thị trường của content (VIETNAM/GLOBAL/THAILAND/...), resolve qua bản gốc như tiêu đề */
  market: string;
  contentLineId: string | null;
  code: string | null;
  title: string | null;
  /** Content đã từng win (đẩy lên kho tổng do view cao, hoặc khớp video win) */
  isWin: boolean;
  winViews: number | null;
  /**
   * Khoá nhận diện "cùng 1 content" qua các kho (ec:/tc:/gc: + id) — content kho cá nhân đẩy lên
   * kho team rồi kho tổng vẫn là 1 content: làm bản nào cũng chặn các bản còn lại.
   */
  keys: string[];
};

// ── Video win ─────────────────────────────────────────────────────────────────

export type WinVideoCandidate = {
  platform: string;
  post_id: string;
  url: string;
  caption: string;
  thumbnail_url: string | null;
  views: number;
  published_at: Date | null;
  page_name: string | null;
  /** Video trên kênh của chính team — ưu tiên hơn video cùng thị trường của team khác */
  fromTeam: boolean;
};

// ── Kế hoạch ─────────────────────────────────────────────────────────────────

export type PlanDraft = {
  userId: string;
  teamId: string;
  contentLineId: string;
  target: number;
  monthlyTarget: number;
  contents: ContentCandidate[];
  videos: WinVideoCandidate[];
};

export type DailyPlanRunSummary = {
  plan_date: string;
  lines: string[];
  plans: number;
  suggestions: number;
  teams: Record<string, { team_name: string; plans: number; suggestions: number }>;
};
