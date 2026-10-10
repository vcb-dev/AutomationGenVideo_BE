import { unaccent } from "../../common/utils/unaccent.util";

/**
 * Chấm điểm heuristic khớp video kênh nội bộ (FB/IG) với task. Phần thuần, test được
 * (`scoreCandidate` + `pickWinner`); I/O ở `task-video-match.service.ts`. Ngưỡng và tín hiệu
 * rút từ 112 cặp task↔video người dùng đã tự gắn link.
 *
 * Bắt buộc để gắn link: HOOK (câu mở caption) khớp TIÊU ĐỀ content — khớp MỘT PHẦN là đủ (xem
 * `titleCoverage`), không cần trùng hoàn toàn. #SKU / hashtag đặc thù chỉ cộng điểm — cùng
 * editor + cùng sản phẩm + cùng tuyến/tuần cho nhiều task trùng SKU nên #SKU một mình gắn sai.
 * Ngoại lệ duy nhất: #SKU trỏ về ĐÚNG MỘT task của chủ kênh, đăng cách mốc task ≤ 1 ngày (xem
 * `SKU_PATH_MAX_DAYS`). Nguyên tắc: THÀ BỎ SÓT CÒN HƠN GẮN SAI — thiếu căn cứ thì để trống.
 */

/** line(+3) + team(+4) + timing(+3) = 9: mức tối thiểu để coi là "có thể". */
export const MATCH_THRESHOLD = 9;
/** Khi có nhiều ứng viên: hạng nhất phải hơn hạng nhì ngần này (một tín hiệu phân biệt thật). */
export const MATCH_MIN_GAP = 4;
/** Cửa sổ thời gian quanh mốc nộp task (±5 ngày). Điểm timing chỉ cộng khi lệch ≤ 2 ngày. */
export const MATCH_WINDOW_BEFORE_DAYS = 5;
export const MATCH_WINDOW_AFTER_DAYS = 5;
/**
 * Cửa sổ MỞ RỘNG ±10 ngày, có điều kiện: chỉ được gắn khi hook chứa TRỌN tiêu đề (hook.full) và tiêu
 * đề đủ dài (≥ FAR_WINDOW_MIN_TITLE_SYLLABLES âm tiết có nghĩa) — tiêu đề ngắn kiểu tên sản phẩm dễ
 * khớp nhiều task ở xa.
 */
export const MATCH_FAR_WINDOW_DAYS = 10;
export const FAR_WINDOW_MIN_TITLE_SYLLABLES = 5;
/** Hook phải trùng tiêu đề content ít nhất ngần này. 0.6 lọt cặp chỉ trùng từ đệm khi tiêu đề ngắn. */
export const HOOK_OVERLAP_MIN = 0.75;
/**
 * Nhánh thứ 2 cho tiêu đề NGẮN (editor hay đặt 2–3 từ: "Lắc tay tennis") mà `tokenOverlapRatio`
 * luôn trả 0 vì < 4 từ có nghĩa: đủ nếu hook chứa ngần này phần từ có nghĩa của tiêu đề…
 */
export const TITLE_COVERAGE_MIN = 0.6;
/** …và trùng ít nhất ngần này từ (1 từ chung như "vàng"/"nhẫn" là quá chung). */
export const TITLE_MIN_HITS = 2;
/**
 * Hook chứa (gần) TRỌN tiêu đề ⇒ cộng thêm `HOOK_FULL_MATCH_BONUS` — đủ bằng MATCH_MIN_GAP để thắng
 * task chỉ trùng phần khuôn ("3 sự thật về…").
 */
export const HOOK_FULL_MATCH_MIN = 0.95;
export const HOOK_FULL_MATCH_BONUS = 4;
/**
 * Đường thay cho tuyến + hook: #SKU caption khớp ĐÚNG MỘT task (tính cả task đã có link — xem
 * `skuTakenElsewhere` của `pickWinner`), đúng chủ kênh, đăng cách mốc task ≤ ngần này ngày. Dành cho
 * caption gắn nhầm tuyến và tiêu đề không giống caption.
 */
export const SKU_PATH_MAX_DAYS = 1;

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
  /** Tên sản phẩm (editor/team/global) — chỉ lớp AI dùng, heuristic không chấm. */
  productNames?: string[];
  submittedAt: Date | null;
  reviewedAt: Date | null;
  deadline: Date | null;
}

export interface ChannelContext {
  /** team suy ra từ kênh của video, null nếu không dò được. */
  teamIdFromChannel: string | null;
  /** owner_id kênh trong huyk_channels (nếu khớp đúng 1 dòng). */
  channelOwnerId: string | null;
  /** Kênh và #K-code trỏ về 2 team khác nhau — không dùng team làm tín hiệu khi có xung đột. */
  channelTeamConflict?: boolean;
}

export interface CandidateScore {
  score: number;
  matchedBy: Record<string, unknown>;
}

/**
 * Khi Quản lý kênh đã xác định được chủ kênh, chỉ task giao cho đúng người đó mới được quyền
 * tranh match. Đây là guardrail cứng, không phải điểm cộng: dữ liệu thật cho thấy một tiêu đề
 * gần giống có thể kéo bài sang task của người khác dù task đúng có cùng kênh/tuyến/thời gian.
 */
export function enforceChannelOwnerGuard<
  T extends { task: Pick<CandidateTask, "assigneeId"> },
>(
  scored: T[],
  ctx: ChannelContext,
): { candidates: T[]; applied: boolean } {
  if (!ctx.channelOwnerId) return { candidates: scored, applied: false };
  return {
    candidates: scored.filter(
      (candidate) => candidate.task.assigneeId === ctx.channelOwnerId,
    ),
    applied: true,
  };
}

export type PickReason =
  | "MATCHED"
  | "NO_CANDIDATE"
  | "BELOW_THRESHOLD"
  | "AMBIGUOUS"
  | "WEAK_SIGNAL";

export interface PickResult {
  taskId: string | null;
  /** Ứng viên đứng đầu để audit khi không đủ điều kiện tự gắn. */
  candidateTaskId: string | null;
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

/** Dãy số dài nhất (≥ 8 chữ số) của link FB — id video/reel, đủ dài để không khớp nhầm. */
export function longDigitRun(url: string | null | undefined): string | null {
  const runs = (url || "").match(/\d{8,}/g);
  return runs ? runs.sort((a, b) => b.length - a.length)[0] : null;
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

/**
 * Từ đệm khi so tiêu đề theo âm tiết GIỮ DẤU — bản có dấu để "là" (đệm) không nuốt "lá" (chủ đề),
 * "đang" không nuốt "đằng".
 */
const TITLE_FILLERS = new Set(
  (
    "là và có của cho không được những một các đang khi với trên như hay lại vào ra này đó " +
    "thì mà ở đã sẽ bị rất cũng nhé nha ạ cách mẹo đơn giản điều gì the and for you"
  ).split(" "),
);
const TITLE_FILLERS_PLAIN = new Set([...TITLE_FILLERS].map((s) => unaccent(s)));

/** Âm tiết GIỮ DẤU (NFC, thường) theo đúng thứ tự — giữ cả âm tiết ngắn để xét liền kề. */
function syllables(text: string): string[] {
  return (text || "")
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Trùng hệt, hoặc một bên gõ KHÔNG DẤU ("qua" ~ "quá") và trùng khi bỏ dấu. */
function sameSyllable(a: string, b: string): boolean {
  if (a === b) return true;
  const pa = unaccent(a);
  const pb = unaccent(b);
  return pa === pb && (pa === a || pb === b);
}

function isTitleFiller(s: string): boolean {
  return TITLE_FILLERS.has(s) || (unaccent(s) === s && TITLE_FILLERS_PLAIN.has(s));
}

/**
 * Hook chứa nguyên một cụm 2 âm tiết liền nhau của tiêu đề ("dây chuyền", "lắc tay") có ít nhất
 * một âm tiết không phải từ đệm. Chặn trùng rời rạc ngẫu nhiên: "quốc thạch" ≠ "đổ thạch Trung Quốc".
 */
function sharesTitlePhrase(h: string[], t: string[]): boolean {
  for (let i = 0; i + 1 < t.length; i++) {
    if (isTitleFiller(t[i]) && isTitleFiller(t[i + 1])) continue;
    for (let j = 0; j + 1 < h.length; j++) {
      if (sameSyllable(t[i], h[j]) && sameSyllable(t[i + 1], h[j + 1])) return true;
    }
  }
  return false;
}

/**
 * Phần âm tiết của TIÊU ĐỀ (trừ từ đệm, TÍNH CẢ âm tiết ngắn "cỏ"/"lá"/"4" — thường chính là phần
 * phân biệt: "nhẫn xoay cỏ 4 lá" ≠ "nhẫn xoay răng cưa") xuất hiện trong hook. Không đòi tối
 * thiểu 4 từ như `tokenOverlapRatio`. 0 nếu trùng < `TITLE_MIN_HITS` âm tiết hoặc không có cụm
 * nào liền nhau.
 */
export function titleCoverage(hook: string, title: string): number {
  const h = syllables(hook);
  const t = syllables(title);
  const T = [...new Set(t.filter((s) => !isTitleFiller(s)))];
  const hit = T.filter((s) => h.some((x) => sameSyllable(s, x))).length;
  if (hit < TITLE_MIN_HITS || !sharesTitlePhrase(h, t)) return 0;
  return hit / T.length;
}

/** Số âm tiết có nghĩa (trừ từ đệm, không trùng lặp) của tiêu đề. */
export function titleSyllableCount(title: string): number {
  return new Set(syllables(title).filter((s) => !isTitleFiller(s))).size;
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

/** Trong cửa sổ mở rộng ±MATCH_FAR_WINDOW_DAYS (điều kiện gắn xem `scoreCandidate`/`pickWinner`). */
export function isWithinFarWindow(
  video: CandidateVideo,
  task: CandidateTask,
): boolean {
  const anchor = taskAnchor(task);
  if (!anchor) return false;
  return (
    Math.abs(video.publishedAt.getTime() - anchor.getTime()) <=
    MATCH_FAR_WINDOW_DAYS * DAY_MS
  );
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

  // 3. Thời gian — ground truth: p50 = 0, 100% trong ±2 ngày. Lệch 2–5 ngày vẫn trong cửa sổ
  //    (isWithinWindow) nhưng không được cộng điểm.
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

  // 5. Hook (câu mở caption) ↔ tiêu đề content — phải trùng TỪ MANG CHỦ ĐỀ (ngưỡng + STOPWORDS).
  //    Khớp một phần là đủ: trùng nhiều (tiêu đề dài) HOẶC hook chứa phần lớn tiêu đề (tiêu đề ngắn).
  const hook = captionHook(video.caption);
  const hookOverlap = tokenOverlapRatio(hook, task.contentTitle);
  const coverage = titleCoverage(hook, task.contentTitle);
  if (hookOverlap >= HOOK_OVERLAP_MIN || coverage >= TITLE_COVERAGE_MIN) {
    score += 4;
    const full = Math.max(hookOverlap, coverage) >= HOOK_FULL_MATCH_MIN;
    if (full) score += HOOK_FULL_MATCH_BONUS;
    matchedBy.hook = {
      overlap: Math.round(hookOverlap * 100) / 100,
      coverage: Math.round(coverage * 100) / 100,
      ...(full ? { full: true } : {}),
    };
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

  // 9. Ngoài cửa sổ ±5 (nhưng trong ±10): chỉ được gắn khi hook chứa TRỌN tiêu đề đủ dài.
  if (anchor && !isWithinWindow(video, task)) {
    const hookInfo = matchedBy.hook as { full?: boolean } | undefined;
    matchedBy.farWindow = {
      days:
        Math.round(
          ((video.publishedAt.getTime() - anchor.getTime()) / DAY_MS) * 10,
        ) / 10,
      allowed:
        hookInfo?.full === true &&
        titleSyllableCount(task.contentTitle) >= FAR_WINDOW_MIN_TITLE_SYLLABLES,
    };
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
 * Ngoại lệ: đường #SKU (`SKU_PATH_MAX_DAYS`) thay cho tuyến + hook. `skuTakenElsewhere`: #SKU của
 * video còn khớp task đã có link (không nằm trong `scored`) ⇒ SKU không còn là định danh duy nhất.
 */
export function pickWinner(
  scored: {
    task: CandidateTask;
    score: number;
    matchedBy: Record<string, unknown>;
  }[],
  opts: { skuTakenElsewhere?: boolean } = {},
): PickResult {
  const empty = {
    taskId: null,
    candidateTaskId: null,
    score: 0,
    matchedBy: {} as Record<string, unknown>,
  };
  if (!scored.length) return { ...empty, reason: "NO_CANDIDATE" };

  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const topOverall = sorted[0];

  if (topOverall.score < MATCH_THRESHOLD) {
    return {
      ...empty,
      candidateTaskId: topOverall.task.id,
      score: topOverall.score,
      matchedBy: topOverall.matchedBy,
      reason: "BELOW_THRESHOLD",
    };
  }

  // Chỉ ứng viên TỰ NÓ đủ guardrail mới được tranh hạng — task không có hook (chắc chắn không thể
  // thắng) không được đứng nhì nhờ team+tuyến+thời gian rồi làm ứng viên đúng bị AMBIGUOUS.
  const byContent = (candidate: (typeof sorted)[number]) => {
    const mb = candidate.matchedBy;
    const hasChannelAnchor = mb.team === true || mb.channelOwner === true;
    const far = mb.farWindow as { allowed?: boolean } | undefined;
    return (
      candidate.score >= MATCH_THRESHOLD &&
      hasChannelAnchor &&
      mb.contentLine != null &&
      mb.hook != null &&
      (!far || far.allowed === true)
    );
  };
  const skuHolders = sorted.filter(
    (candidate) => ((candidate.matchedBy.sku as string[] | undefined) ?? []).length > 0,
  );
  const skuOnly =
    !opts.skuTakenElsewhere && skuHolders.length === 1 ? skuHolders[0] : null;
  const bySku = (candidate: (typeof sorted)[number]) => {
    if (candidate !== skuOnly) return false;
    const mb = candidate.matchedBy;
    const days = (mb.timing as { days?: number } | undefined)?.days;
    return (
      candidate.score >= MATCH_THRESHOLD &&
      mb.channelOwner === true &&
      typeof days === "number" &&
      days <= SKU_PATH_MAX_DAYS
    );
  };
  const eligible = sorted.filter((c) => byContent(c) || bySku(c));

  if (!eligible.length) {
    return {
      ...empty,
      candidateTaskId: topOverall.task.id,
      score: topOverall.score,
      matchedBy: topOverall.matchedBy,
      reason: "WEAK_SIGNAL",
    };
  }

  const top = eligible[0];
  const mb = byContent(top) ? top.matchedBy : { ...top.matchedBy, skuPath: true };

  if (eligible.length === 1) {
    return {
      taskId: top.task.id,
      candidateTaskId: top.task.id,
      score: top.score,
      matchedBy: mb,
      reason: "MATCHED",
    };
  }

  const gap = top.score - eligible[1].score;
  if (gap >= MATCH_MIN_GAP) {
    return {
      taskId: top.task.id,
      candidateTaskId: top.task.id,
      score: top.score,
      matchedBy: mb,
      reason: "MATCHED",
    };
  }

  return {
    ...empty,
    candidateTaskId: top.task.id,
    score: top.score,
    matchedBy: mb,
    reason: "AMBIGUOUS",
  };
}

export function statusFromReason(reason: PickReason): string {
  if (reason === "MATCHED") return "MATCHED";
  if (reason === "AMBIGUOUS") return "SKIPPED_AMBIGUOUS";
  return "UNMATCHED";
}

// ─── Lớp AI (DeepSeek qua AI service) — chỉ xét video heuristic đã bỏ trống ─────────────

/** Số task tối đa gửi AI cho 1 video — người nhiều task có thể có > 8 task cùng tuyến trong ±5 ngày. */
export const AI_MAX_CANDIDATES = 15;
/** Chỉ nhận phán quyết AI khi tự tin ≥ ngần này. */
export const AI_DEFAULT_MIN_CONFIDENCE = 0.85;

/**
 * off: không gọi AI · suggest: chỉ lưu gợi ý vào audit · apply: gợi ý đủ tự tin thì gắn link.
 * Nút trên UI chỉ bật/tắt (apply/off); suggest còn giữ cho test so độ chính xác.
 */
export type AiMatchMode = "off" | "suggest" | "apply";

/**
 * Độ gần về chữ giữa caption và task (tiêu đề + tên sản phẩm + đầu kịch bản): tỷ lệ âm tiết có nghĩa
 * của hook xuất hiện bên task (so không dấu). Chỉ dùng để XẾP danh sách gửi AI, không phải để chấm.
 */
export function textAffinity(caption: string, task: CandidateTask): number {
  const hook = [...new Set(syllables(captionHook(caption)).filter((s) => !isTitleFiller(s)))];
  if (!hook.length) return 0;
  const taskText = [
    task.contentTitle,
    ...(task.productNames ?? []),
    (task.scriptContent || "").slice(0, 400),
  ].join(" ");
  const bag = new Set(syllables(taskText).map((s) => unaccent(s)));
  return hook.filter((s) => bag.has(unaccent(s))).length / hook.length;
}

/**
 * Ứng viên gửi AI: vẫn bắt buộc 2 mỏ neo như heuristic (tuyến + team/chủ kênh) và nằm trong cửa sổ
 * ±5 ngày — AI chỉ thay phần "nội dung có khớp không", KHÔNG mở rộng phạm vi. Task không có chữ nào
 * (tiêu đề/kịch bản/tên sản phẩm) thì AI cũng không có gì để so ⇒ loại. Xếp theo độ gần về chữ rồi
 * mới tới điểm heuristic, để task đúng không bị cắt khi người đó có nhiều task.
 */
export function aiShortlist<
  T extends {
    task: CandidateTask;
    score: number;
    matchedBy: Record<string, unknown>;
  },
>(scored: T[], max = AI_MAX_CANDIDATES, caption = ""): T[] {
  return scored
    .filter((candidate) => {
      const mb = candidate.matchedBy;
      const hasChannelAnchor = mb.team === true || mb.channelOwner === true;
      const task = candidate.task;
      const hasText = Boolean(
        task.contentTitle?.trim() ||
          task.scriptContent?.trim() ||
          task.productNames?.some((name) => name?.trim()),
      );
      return (
        hasChannelAnchor &&
        mb.contentLine != null &&
        mb.farWindow == null &&
        hasText
      );
    })
    .map((candidate) => ({ candidate, affinity: textAffinity(caption, candidate.task) }))
    .sort((a, b) => b.affinity - a.affinity || b.candidate.score - a.candidate.score)
    .slice(0, max)
    .map(({ candidate }) => candidate);
}

export interface AiVerdict {
  taskId: string | null;
  confidence: number;
  reason?: string;
}

export type AiRejectReason =
  | "NO_PICK"
  | "NOT_IN_SHORTLIST"
  | "LOW_CONFIDENCE"
  | "DUPLICATE_TITLE"
  | "SKU_POINTS_ELSEWHERE"
  | "SKU_CONFLICT";

/** Âm tiết có nghĩa (không dấu) của tiêu đề — để so tiêu đề gần trùng. */
const titleBag = (title: string | null | undefined): Set<string> =>
  new Set(
    syllables(title || "")
      .filter((s) => !isTitleFiller(s))
      .map((s) => unaccent(s)),
  );

/**
 * Hai tiêu đề gần trùng (task nhân bản): phần chung ≥ 75% tiêu đề DÀI hơn. Chia cho tiêu đề ngắn thì
 * "3 sự thật về vàng" thành "gần trùng" "3 sự thật về chiếc cúp…" chỉ nhờ phần khuôn.
 */
export function nearDuplicateTitles(a: string, b: string): boolean {
  const A = titleBag(a);
  const B = titleBag(b);
  if (!A.size || !B.size) return false;
  let shared = 0;
  for (const s of A) if (B.has(s)) shared++;
  return shared / Math.max(A.size, B.size) >= 0.75;
}

const SKU_BASE_RE = /^([a-z]+)(\d+)/;

/**
 * #SKU caption và SKU task CÙNG HỌ MÃ (cùng tiền tố chữ, cùng số chữ số) mà khác số ⇒ hai sản phẩm khác
 * nhau (vd caption #ST0026 ↔ task st0025). Khác họ mã (n0006 ↔ nm101-4) thì không kết luận được.
 */
export function skuFamilyConflict(captionSkus: string[], taskSkus: string[]): boolean {
  if (!captionSkus.length || !taskSkus.length) return false;
  if (skuMatches(captionSkus, taskSkus).length) return false;
  for (const c of captionSkus) {
    const cm = c.match(SKU_BASE_RE);
    if (!cm) continue;
    for (const t of taskSkus) {
      const tm = t.toLowerCase().match(SKU_BASE_RE);
      if (tm && tm[1] === cm[1] && tm[2].length === cm[2].length && tm[2] !== cm[2]) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Kiểm lại phán quyết AI trước khi dùng: task phải nằm trong danh sách đã gửi, đủ tự tin, KHÔNG có
 * task khác trong danh sách trùng hệt tiêu đề (task nhân bản), và #SKU của caption không trùng đúng SKU
 * của MỘT TASK KHÁC trong danh sách. Không chặn chỉ vì SKU lệch (hai hệ mã, vd n0006 ↔ nm101-4).
 */
export function acceptAiVerdict(
  verdict: AiVerdict | null | undefined,
  shortlist: (Pick<CandidateTask, "id" | "contentTitle" | "productSkus"> & {
    /** Task đã có link cùng nền tảng — đã nhận video của nó nên không còn là đối thủ "nhân bản". */
    occupied?: boolean;
  })[],
  minConfidence: number,
  caption = "",
): { taskId: string | null; rejected?: AiRejectReason } {
  if (!verdict?.taskId) return { taskId: null, rejected: "NO_PICK" };
  const picked = shortlist.find((task) => task.id === verdict.taskId);
  if (!picked) return { taskId: null, rejected: "NOT_IN_SHORTLIST" };
  const confidence = Number(verdict.confidence);
  if (!Number.isFinite(confidence) || confidence < minConfidence) {
    return { taskId: null, rejected: "LOW_CONFIDENCE" };
  }
  const captionSkus = extractSkuTags(caption);
  const pickedSkuHit =
    captionSkus.length > 0 &&
    skuMatches(captionSkus, picked.productSkus ?? []).length > 0;
  // Task nhân bản / gần trùng tiêu đề còn trống: AI không có căn cứ chọn 1 trong 2 — trừ khi #SKU của
  // caption trùng đúng task được chọn.
  if (
    !pickedSkuHit &&
    shortlist.some(
      (task) =>
        task.id !== picked.id &&
        !task.occupied &&
        nearDuplicateTitles(task.contentTitle, picked.contentTitle),
    )
  ) {
    return { taskId: null, rejected: "DUPLICATE_TITLE" };
  }
  if (skuFamilyConflict(captionSkus, picked.productSkus ?? [])) {
    return { taskId: null, rejected: "SKU_CONFLICT" };
  }
  if (captionSkus.length) {
    const skuTasks = shortlist.filter(
      (task) => skuMatches(captionSkus, task.productSkus ?? []).length > 0,
    );
    if (skuTasks.length && !skuTasks.some((task) => task.id === picked.id)) {
      return { taskId: null, rejected: "SKU_POINTS_ELSEWHERE" };
    }
  }
  return { taskId: picked.id };
}
