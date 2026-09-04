import { unaccent } from "../../../common/utils/unaccent.util";

/**
 * Chấm điểm heuristic khớp video kênh nội bộ (FB/IG) với task. Phần thuần, test được
 * (`scoreCandidate` + `pickWinner`); I/O ở `task-video-match.service.ts`. Ngưỡng và tín hiệu
 * rút từ 112 cặp task↔video người dùng đã tự gắn link.
 *
 * Bắt buộc để gắn link: HOOK (câu mở caption) khớp TIÊU ĐỀ content. #SKU / hashtag đặc thù chỉ
 * cộng điểm — cùng editor + cùng sản phẩm + cùng tuyến/tuần cho nhiều task trùng SKU nên #SKU
 * một mình gắn sai. Nguyên tắc: THÀ BỎ SÓT CÒN HƠN GẮN SAI — thiếu căn cứ thì để trống.
 */

/** line(+3) + team(+4) + timing(+3) = 9: mức tối thiểu để coi là "có thể". */
export const MATCH_THRESHOLD = 9;
/** Khi có nhiều ứng viên: hạng nhất phải hơn hạng nhì ngần này (một tín hiệu phân biệt thật). */
export const MATCH_MIN_GAP = 4;
/** Cửa sổ thời gian quanh mốc nộp task — ground truth: 100% trong ±2 ngày. */
export const MATCH_WINDOW_BEFORE_DAYS = 2;
export const MATCH_WINDOW_AFTER_DAYS = 2;
/** Hook phải trùng tiêu đề content ít nhất ngần này. 0.6 lọt cặp chỉ trùng từ đệm khi tiêu đề ngắn. */
export const HOOK_OVERLAP_MIN = 0.75;

export const DAY_MS = 86_400_000;

export type MatchPlatform = "FACEBOOK" | "INSTAGRAM";

export interface CandidateVideo {
  platform: MatchPlatform;
  postId: string;
  url: string;
  caption: string;
  hashtags: string[];
  publishedAt: Date;
  /** page_id (FB) hoặc username (IG) — để dò team qua huyk_channels / bảng page→team. */
  channelKey: string;
  /** Tên hiển thị của kênh (IG full_name) — fallback dò huyk_channels.name khi handle không khớp. */
  channelNameFallback?: string;
}

export interface CandidateTask {
  id: string;
  teamId: string;
  assigneeId: string | null;
  /** ContentLine.name ('A1'..'A5'). */
  contentLineName: string | null;
  /** TaskVideoScript.hashtags + hashtag gõ trong kịch bản. */
  scriptHashtags: string[];
  scriptContent: string;
  /** Tiêu đề content (editor/team/global) — so với hook của caption. */
  contentTitle: string;
  /** SKU sản phẩm gắn với task (editor/team/global), đã hạ chữ thường. */
  productSkus: string[];
  submittedAt: Date | null;
  reviewedAt: Date | null;
  deadline: Date | null;
}

export interface ChannelContext {
  /** team suy ra từ kênh của video, null nếu không dò được. */
  teamIdFromChannel: string | null;
  /** owner_id kênh trong huyk_channels (nếu khớp đúng 1 dòng). */
  channelOwnerId: string | null;
}

export interface CandidateScore {
  score: number;
  matchedBy: Record<string, unknown>;
}

export type PickReason =
  | "MATCHED"
  | "NO_CANDIDATE"
  | "BELOW_THRESHOLD"
  | "AMBIGUOUS"
  | "WEAK_SIGNAL";

export interface PickResult {
  taskId: string | null;
  score: number;
  matchedBy: Record<string, unknown>;
  reason: PickReason;
}

const CONTENT_LINE_RE = /#(a[1-5])(?![a-z0-9_])/gi;
const K_CODE_RE = /#k?(\d{2,4})(?![0-9a-z])/i;
const SKU_TAG_RE = /#([a-z]{1,3}\d{3,6}[a-z0-9-]*)/gi;

/** Bóc `#A1..#A5` khỏi caption. Ranh giới sau ký tự để `#A54` không lọt vào A5. */
export function extractContentLines(text: string): string[] {
  const out = new Set<string>();
  for (const m of (text || "").matchAll(CONTENT_LINE_RE))
    out.add(m[1].toUpperCase());
  return [...out];
}

/** `#K401` / `#k404` / `#402` → "K401". Mã cụm kênh của đội nội dung. */
export function extractKCode(text: string): string | null {
  const m = (text || "").match(K_CODE_RE);
  return m ? "K" + m[1] : null;
}

/** `#N0018` `#ML0008` `#D400544-V` → ["n0018","ml0008","d400544-v"] (loại #A1..#A5, #K...). */
export function extractSkuTags(text: string): string[] {
  const out = new Set<string>();
  for (const m of (text || "").matchAll(SKU_TAG_RE)) {
    const s = m[1].toLowerCase();
    if (/^a[1-5]$/.test(s) || /^k\d/.test(s)) continue;
    out.add(s);
  }
  return [...out];
}

/** Phần caption trước hashtag đầu tiên — chính là hook/tiêu đề video. */
export function captionHook(caption: string): string {
  return String(caption || "")
    .split("#")[0]
    .trim();
}

export function normalizeHashtag(raw: string): string {
  return (raw || "").trim().replace(/^#+/, "").toLowerCase();
}

export function stripContentLineTags(tags: string[]): string[] {
  return tags.map(normalizeHashtag).filter((t) => t && !/^a[1-5]$/.test(t));
}

export function intersect(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return [...new Set(a)].filter((x) => setB.has(x));
}

/** SKU khớp: trùng hệt, hoặc một bên là tiền tố bên kia (SKU hay có đuôi -V, -S-WH). */
export function skuMatches(
  captionSkus: string[],
  taskSkus: string[],
): string[] {
  const hits: string[] = [];
  for (const c of captionSkus) {
    for (const t of taskSkus) {
      if (!t || t.length < 4) continue;
      if (c === t || c.startsWith(t) || t.startsWith(c)) {
        hits.push(c);
        break;
      }
    }
  }
  return hits;
}

const STOPWORDS = new Set(
  (
    "the and for you cho khong duoc nhung mot cac dang khi voi tren nhu hay lai vao ra la nay do cua mot " +
    // từ đệm tiếng Việt hay gây "hook giả" ở tiêu đề ngắn (không mang chủ đề)
    "cach meo don gian dieu gi"
  ).split(" "),
);

export function meaningfulTokens(text: string): string[] {
  return unaccent(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Tỷ lệ token chung / bên nhỏ hơn. 0 nếu một bên < 4 token có nghĩa. */
export function tokenOverlapRatio(a: string, b: string): number {
  const A = new Set(meaningfulTokens(a));
  const B = new Set(meaningfulTokens(b));
  if (A.size < 4 || B.size < 4) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.min(A.size, B.size);
}

export function taskAnchor(task: CandidateTask): Date | null {
  return task.submittedAt ?? task.reviewedAt ?? task.deadline ?? null;
}

export function isWithinWindow(
  video: CandidateVideo,
  task: CandidateTask,
): boolean {
  const anchor = taskAnchor(task);
  if (!anchor) return false;
  const lo = video.publishedAt.getTime() - MATCH_WINDOW_BEFORE_DAYS * DAY_MS;
  const hi = video.publishedAt.getTime() + MATCH_WINDOW_AFTER_DAYS * DAY_MS;
  const a = anchor.getTime();
  return a >= lo && a <= hi;
}

export function scoreCandidate(
  video: CandidateVideo,
  task: CandidateTask,
  ctx: ChannelContext,
): CandidateScore {
  let score = 0;
  const matchedBy: Record<string, unknown> = {};

  // 1. Tuyến nội dung — gần như bắt buộc (97% cặp thật)
  const videoLines = extractContentLines(video.caption);
  if (
    task.contentLineName &&
    videoLines.includes(task.contentLineName.trim().toUpperCase())
  ) {
    score += 3;
    matchedBy.contentLine = task.contentLineName.trim().toUpperCase();
  }

  // 2. Kênh → team (huyk_channels.name / bảng page→team / #K-code) — 100% khi giải được
  if (ctx.teamIdFromChannel && ctx.teamIdFromChannel === task.teamId) {
    score += 4;
    matchedBy.team = true;
  }

  // 3. Thời gian — ground truth: p50 = 0, 100% trong ±2 ngày
  const anchor = taskAnchor(task);
  if (anchor) {
    const days =
      Math.abs(video.publishedAt.getTime() - anchor.getTime()) / DAY_MS;
    if (days <= 1) {
      score += 3;
      matchedBy.timing = { days: Math.round(days * 10) / 10 };
    } else if (days <= 2) {
      score += 1;
      matchedBy.timing = { days: Math.round(days * 10) / 10 };
    }
  }

  // 4. SKU sản phẩm trong caption ↔ SKU của task — gần như định danh khi có
  const skuHits = skuMatches(extractSkuTags(video.caption), task.productSkus);
  if (skuHits.length) {
    score += 5;
    matchedBy.sku = skuHits;
  }

  // 5. Hook (câu mở caption) ↔ tiêu đề content — phải trùng TỪ MANG CHỦ ĐỀ (ngưỡng + STOPWORDS)
  const hookOverlap = tokenOverlapRatio(
    captionHook(video.caption),
    task.contentTitle,
  );
  if (hookOverlap >= HOOK_OVERLAP_MIN) {
    score += 4;
    matchedBy.hook = { overlap: Math.round(hookOverlap * 100) / 100 };
  }

  // 6. Hashtag đặc thù (loại tag tuyến) trùng giữa caption và kịch bản
  const specific = intersect(
    stripContentLineTags(video.hashtags),
    stripContentLineTags(task.scriptHashtags),
  );
  if (specific.length) {
    score += Math.min(6, specific.length * 3);
    matchedBy.hashtags = specific;
  }

  // 7. Caption ~ toàn bộ kịch bản (yếu — caption punchy, script dài)
  const capScript = tokenOverlapRatio(video.caption, task.scriptContent);
  if (capScript >= 0.3) {
    score += 2;
    matchedBy.caption = { overlap: Math.round(capScript * 100) / 100 };
  }

  // 8. Chủ kênh (huyk_channels.owner_id) == người nhận task ⇒ mỏ neo ngang team. KHÔNG tự nó là
  //    tín hiệu tách — xem pickWinner.
  if (
    ctx.channelOwnerId &&
    task.assigneeId &&
    ctx.channelOwnerId === task.assigneeId
  ) {
    score += 4;
    matchedBy.channelOwner = true;
  }

  return { score, matchedBy };
}

/**
 * Chọn task thắng. Guardrail cho GHI THẲNG (không có bước duyệt): hạng nhất ≥ MATCH_THRESHOLD,
 * có 2 mỏ neo (tuyến + team-từ-kênh HOẶC chủ-kênh), BẮT BUỘC có hook khớp tiêu đề (mb.hook), và
 * nếu nhiều ứng viên thì phải hơn hạng nhì ≥ MATCH_MIN_GAP. Không đủ ⇒ để trống.
 */
export function pickWinner(
  scored: {
    task: CandidateTask;
    score: number;
    matchedBy: Record<string, unknown>;
  }[],
): PickResult {
  const empty = {
    taskId: null,
    score: 0,
    matchedBy: {} as Record<string, unknown>,
  };
  if (!scored.length) return { ...empty, reason: "NO_CANDIDATE" };

  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const top = sorted[0];

  if (top.score < MATCH_THRESHOLD) {
    return { ...empty, score: top.score, reason: "BELOW_THRESHOLD" };
  }

  const mb = top.matchedBy;
  // Mỏ neo kênh: team-từ-kênh HOẶC chủ-kênh == người nhận task (kênh chỉ có owner vẫn đủ tin).
  const hasChannelAnchor = mb.team === true || mb.channelOwner === true;
  const hasAnchors = hasChannelAnchor && mb.contentLine != null;
  // Hook khớp tiêu đề là bắt buộc — #SKU/hashtag/caption một mình đã gắn sai (xem đầu file).
  const hasTitleMatch = mb.hook != null;
  if (!hasAnchors || !hasTitleMatch) {
    return { ...empty, score: top.score, reason: "WEAK_SIGNAL" };
  }

  if (sorted.length === 1) {
    return {
      taskId: top.task.id,
      score: top.score,
      matchedBy: mb,
      reason: "MATCHED",
    };
  }

  const gap = top.score - sorted[1].score;
  if (gap >= MATCH_MIN_GAP) {
    return {
      taskId: top.task.id,
      score: top.score,
      matchedBy: mb,
      reason: "MATCHED",
    };
  }

  return { ...empty, score: top.score, reason: "AMBIGUOUS" };
}

export function statusFromReason(reason: PickReason): string {
  if (reason === "MATCHED") return "MATCHED";
  if (reason === "AMBIGUOUS") return "SKIPPED_AMBIGUOUS";
  return "UNMATCHED";
}
