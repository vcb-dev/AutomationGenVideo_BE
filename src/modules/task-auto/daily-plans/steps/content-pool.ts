import { BrandType, Prisma } from "@prisma/client";
import { ContentCandidate, ContentSource } from "../types";
import { PrismaService } from "@/common/prisma/prisma.service";

// Kho team / kho tổng có thể không tự lưu data mà trỏ về bản gốc (push từ kho cá nhân/kho team) —
// select kèm bản gốc để resolve tuyến + tiêu đề như tasks.service create() / resolveContentSnapshot.
const WIN_SELECT = { won_at: true, win_video_views: true } as const;

export const GLOBAL_CONTENT_SELECT = {
  id: true,
  code: true,
  title: true,
  market: true,
  content_line_id: true,
  ...WIN_SELECT,
  source_team_content_id: true,
  source_editor_content_id: true,
  source_team_content: {
    select: {
      code: true,
      title: true,
      market: true,
      content_line_id: true,
      source_editor_content_id: true,
      source_editor_content: { select: { code: true, title: true, market: true, content_line_id: true } },
    },
  },
} satisfies Prisma.ContentSelect;

export const TEAM_CONTENT_SELECT = {
  id: true,
  code: true,
  title: true,
  market: true,
  content_line_id: true,
  source_editor_content_id: true,
  source_content_id: true,
  source_editor_content: {
    select: { code: true, title: true, market: true, content_line_id: true, source_content_id: true },
  },
  source_content: { select: { code: true, title: true, market: true, content_line_id: true, ...WIN_SELECT } },
  global_content: { select: { id: true, ...WIN_SELECT } },
} satisfies Prisma.TeamContentSelect;

export const EDITOR_CONTENT_SELECT = {
  id: true,
  user_id: true,
  code: true,
  title: true,
  market: true,
  content_line_id: true,
  source_content_id: true,
  source_content: { select: { code: true, title: true, content_line_id: true, ...WIN_SELECT } },
  global_content: { select: { id: true, ...WIN_SELECT } },
} satisfies Prisma.EditorContentSelect;

type GlobalContentRow = Prisma.ContentGetPayload<{ select: typeof GLOBAL_CONTENT_SELECT }>;
type TeamContentRow = Prisma.TeamContentGetPayload<{ select: typeof TEAM_CONTENT_SELECT }>;
type EditorContentRow = Prisma.EditorContentGetPayload<{ select: typeof EDITOR_CONTENT_SELECT }>;
type WinFields = { won_at: Date | null; win_video_views: bigint | null };

function winOf(...rows: (WinFields | null | undefined)[]): Pick<ContentCandidate, "isWin" | "winViews"> {
  for (const r of rows) {
    if (r && (r.won_at || r.win_video_views != null)) {
      return { isWin: true, winViews: r.win_video_views != null ? Number(r.win_video_views) : null };
    }
  }
  return { isWin: false, winViews: null };
}

function keysOf(...keys: (string | false | null | undefined)[]): string[] {
  return [...new Set(keys.filter((k): k is string => !!k))];
}

// Tiêu đề ngắn hay là tên chung chung ("asmr", "content01", "a1") — chỉ coi trùng tiêu đề là cùng
// content khi đủ dài.
const MIN_TITLE_KEY_LENGTH = 15;

/**
 * Cùng 1 content hay bị nhập lại ở kho khác mà không trỏ về nhau (vd kho cá nhân + kho tổng cùng
 * "quy tắc đeo vòng tay") — trùng tiêu đề (chuẩn hoá) cũng tính là cùng content.
 */
function titleKey(title: string | null | undefined): string | null {
  const t = (title ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
  return t.length >= MIN_TITLE_KEY_LENGTH ? `title:${t}` : null;
}

export function globalContentCandidate(c: GlobalContentRow): ContentCandidate {
  const tc = c.source_team_content;
  const ec = tc?.source_editor_content;
  const title = c.title ?? tc?.title ?? ec?.title ?? null;
  return {
    source: "global",
    id: c.id,
    tier: 2,
    ownerUserId: null,
    // Bản push không tự lưu data vẫn mang market mặc định VIETNAM — lấy theo bản gốc
    market: c.title != null ? c.market : tc?.title != null ? tc.market : ec?.market ?? tc?.market ?? c.market,
    contentLineId: c.content_line_id ?? tc?.content_line_id ?? ec?.content_line_id ?? null,
    code: c.code ?? tc?.code ?? ec?.code ?? null,
    title,
    ...winOf(c),
    keys: keysOf(
      `gc:${c.id}`,
      titleKey(title),
      c.source_team_content_id && `tc:${c.source_team_content_id}`,
      c.source_editor_content_id && `ec:${c.source_editor_content_id}`,
      tc?.source_editor_content_id && `ec:${tc.source_editor_content_id}`,
    ),
  };
}

export function teamContentCandidate(c: TeamContentRow): ContentCandidate {
  const ec = c.source_editor_content;
  const sc = c.source_content;
  const title = c.title ?? ec?.title ?? sc?.title ?? null;
  return {
    source: "team",
    id: c.id,
    tier: 1,
    ownerUserId: null,
    market: c.title != null ? c.market : ec?.market ?? sc?.market ?? c.market,
    contentLineId: c.content_line_id ?? ec?.content_line_id ?? sc?.content_line_id ?? null,
    code: c.code ?? ec?.code ?? sc?.code ?? null,
    title,
    ...winOf(c.global_content, sc),
    keys: keysOf(
      `tc:${c.id}`,
      titleKey(title),
      c.source_editor_content_id && `ec:${c.source_editor_content_id}`,
      c.source_content_id && `gc:${c.source_content_id}`,
      c.global_content && `gc:${c.global_content.id}`,
      ec?.source_content_id && `gc:${ec.source_content_id}`,
    ),
  };
}

export function editorContentCandidate(c: EditorContentRow): ContentCandidate {
  const sc = c.source_content;
  const title = c.title ?? sc?.title ?? null;
  return {
    source: "editor",
    id: c.id,
    tier: 0,
    ownerUserId: c.user_id,
    market: c.market,
    contentLineId: c.content_line_id ?? sc?.content_line_id ?? null,
    code: c.code ?? sc?.code ?? null,
    title,
    ...winOf(c.global_content, sc),
    keys: keysOf(
      `ec:${c.id}`,
      titleKey(title),
      c.source_content_id && `gc:${c.source_content_id}`,
      c.global_content && `gc:${c.global_content.id}`,
    ),
  };
}

/** Field trên Task / DailyLinePlanSuggestion trỏ về content của từng kho. */
export const CONTENT_REF_FIELD: Record<ContentSource, "content_id" | "team_content_id" | "editor_content_id"> = {
  global: "content_id",
  team: "team_content_id",
  editor: "editor_content_id",
};

/** Content gắn trên 1 task / 1 gợi ý (tối đa 1 trong 3 kho) → candidate, null nếu không có. */
export function candidateOfRow(row: {
  content?: GlobalContentRow | null;
  team_content?: TeamContentRow | null;
  editor_content?: EditorContentRow | null;
}): ContentCandidate | null {
  if (row.editor_content) return editorContentCandidate(row.editor_content);
  if (row.team_content) return teamContentCandidate(row.team_content);
  if (row.content) return globalContentCandidate(row.content);
  return null;
}

/**
 * Content đúng brand của team, chưa lưu trữ, mà editor của team được dùng: kho tổng + kho team đó +
 * kho cá nhân của `editorIds` (kho cá nhân người khác / kho team khác không lấy) — mọi tuyến.
 */
export async function loadContentCandidates(
  prisma: PrismaService,
  args: { teamId: string; brandType: BrandType; editorIds: string[] },
): Promise<ContentCandidate[]> {
  const { teamId, brandType, editorIds } = args;
  const notArchived = { not: "ARCHIVED" as const };
  const [globals, teamContents, editorContents] = await Promise.all([
    prisma.content.findMany({
      where: { brand_type: brandType, status: notArchived },
      select: GLOBAL_CONTENT_SELECT,
    }),
    prisma.teamContent.findMany({
      where: { team_id: teamId, brand_type: brandType, status: notArchived },
      select: TEAM_CONTENT_SELECT,
    }),
    editorIds.length
      ? prisma.editorContent.findMany({
          where: { user_id: { in: editorIds }, brand_type: brandType, status: notArchived },
          select: EDITOR_CONTENT_SELECT,
        })
      : Promise.resolve([]),
  ]);

  return [
    ...editorContents.map(editorContentCandidate),
    ...teamContents.map(teamContentCandidate),
    ...globals.map(globalContentCandidate),
  ];
}

/** Như loadContentCandidates nhưng chỉ lấy các tuyến `contentLineIds`, gom theo tuyến. */
export async function loadContentPool(
  prisma: PrismaService,
  args: { teamId: string; brandType: BrandType; editorIds: string[]; contentLineIds: string[] },
): Promise<Map<string, ContentCandidate[]>> {
  const candidates = await loadContentCandidates(prisma, args);
  const lineIds = new Set(args.contentLineIds);
  const byLine = new Map<string, ContentCandidate[]>();
  for (const c of candidates) {
    if (!c.contentLineId || !lineIds.has(c.contentLineId)) continue;
    if (!byLine.has(c.contentLineId)) byLine.set(c.contentLineId, []);
    byLine.get(c.contentLineId)!.push(c);
  }
  return byLine;
}

/**
 * editorId → (khoá content → lần làm gần nhất) kể từ `since`: task chưa huỷ, mọi team, mọi tuyến.
 * Dùng cho luật không lặp content 14 ngày và xếp "lâu chưa làm".
 */
export async function loadContentUseHistory(
  prisma: PrismaService,
  editorIds: string[],
  since: Date,
): Promise<Map<string, Map<string, Date>>> {
  const result = new Map<string, Map<string, Date>>();
  if (!editorIds.length) return result;

  const rows = await prisma.task.findMany({
    where: {
      assignee_id: { in: editorIds },
      status: { not: "CANCELLED" },
      created_at: { gte: since },
      OR: [
        { content_id: { not: null } },
        { team_content_id: { not: null } },
        { editor_content_id: { not: null } },
      ],
    },
    select: {
      assignee_id: true,
      created_at: true,
      content: { select: GLOBAL_CONTENT_SELECT },
      team_content: { select: TEAM_CONTENT_SELECT },
      editor_content: { select: EDITOR_CONTENT_SELECT },
    },
  });

  for (const r of rows) {
    const candidate = candidateOfRow(r);
    if (!r.assignee_id || !candidate) continue;
    if (!result.has(r.assignee_id)) result.set(r.assignee_id, new Map());
    const byKey = result.get(r.assignee_id)!;
    for (const key of candidate.keys) {
      const prev = byKey.get(key);
      if (!prev || prev < r.created_at) byKey.set(key, r.created_at);
    }
  }
  return result;
}
