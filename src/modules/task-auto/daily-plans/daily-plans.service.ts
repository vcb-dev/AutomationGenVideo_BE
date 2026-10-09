import { Injectable, NotFoundException } from "@nestjs/common";
import { DateTime } from "luxon";
import { BrandType, Prisma } from "@prisma/client";

import {
  dailyKpiDate,
  vietnamDateString,
  vietnamDayRangeOf,
} from "../../../utils/date.utils";
import { deadlineWindow } from "../../../utils/task-auto/deadline-window.util";
import { TaskAutoTasksService } from "../tasks/tasks.service";
import { CreateTaskDto } from "../tasks/dto/task.dto";
import {
  CONTENT_REF_FIELD,
  EDITOR_CONTENT_SELECT,
  GLOBAL_CONTENT_SELECT,
  TEAM_CONTENT_SELECT,
  candidateOfRow,
  editorContentCandidate,
  globalContentCandidate,
  loadContentCandidates,
  loadContentUseHistory,
  teamContentCandidate,
} from "./steps/content-pool";
import {
  contentMatchesMarket,
  contentMatchesQuery,
  dedupeContentCopies,
  defaultSearchMarket,
  lineNameFromCaption,
  videoMarketParam,
} from "./steps/system-search";
import { loadConvertedVideoPostIds } from "./steps/win-video-pool";
import {
  CONTENT_HISTORY_LOOKBACK_DAYS,
  ContentCandidate,
  ContentSource,
  WIN_VIDEO_MIN_VIEWS,
  suggestionClaimCutoff,
} from "./types";
import { PlanSearchQueryDto, QuickCreateFromSearchDto } from "./dto/daily-plan.dto";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ScraperAggregateReadService } from "@/modules/scraper-aggregate/scraper-aggregate-read.service";

const SEARCH_PAGE_SIZE = 20;
/** Bấm "Tạo task" 2 lần liên tiếp trên cùng 1 kết quả tìm kiếm → trả lại task vừa tạo thay vì tạo trùng. */
const SEARCH_DUPLICATE_WINDOW_MS = 60_000;

const MAX_CAPTION_TITLE_LENGTH = 120;
const FALLBACK_CAPTION_TITLE = "Content từ video win";

/**
 * Content kho cá nhân tạo từ caption video win: bỏ mọi hashtag (#A1, #K301, #huyk...), lấy dòng đầu
 * làm tiêu đề, cả caption làm nội dung.
 */
export function captionToContent(caption: string | null | undefined): {
  title: string;
  body: string;
} {
  const body = (caption ?? "")
    .replace(/(^|\s)#[^\s#]+/gu, "$1")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const firstLine = body.split("\n").find((line) => line.trim()) ?? "";
  const title =
    firstLine.length > MAX_CAPTION_TITLE_LENGTH
      ? `${firstLine.slice(0, MAX_CAPTION_TITLE_LENGTH - 1).trimEnd()}…`
      : firstLine;
  return { title: title || FALLBACK_CAPTION_TITLE, body };
}

type PlanForSearch = {
  id: string;
  team_id: string;
  content_line_id: string;
  deadline: Date;
  team: { brand_type: BrandType; market: string };
};

const SUGGESTION_SELECT = {
  id: true,
  kind: true,
  rank: true,
  used_at: true,
  video_platform: true,
  video_post_id: true,
  video_url: true,
  video_caption: true,
  video_thumbnail_url: true,
  video_views: true,
  video_published_at: true,
  video_page_name: true,
  content: { select: GLOBAL_CONTENT_SELECT },
  team_content: { select: TEAM_CONTENT_SELECT },
  editor_content: { select: EDITOR_CONTENT_SELECT },
  task: { select: { id: true, status: true } },
} satisfies Prisma.DailyLinePlanSuggestionSelect;

type SuggestionRow = Prisma.DailyLinePlanSuggestionGetPayload<{ select: typeof SUGGESTION_SELECT }>;

function formatSuggestion(s: SuggestionRow, claimCutoff: Date) {
  const content = s.kind === "CONTENT" ? candidateOfRow(s) : null;
  return {
    id: s.id,
    kind: s.kind,
    rank: s.rank,
    // Đã gắn task, hoặc đang được tạo (giữ chỗ chưa quá hạn) — task bị xoá thì gợi ý dùng lại được
    used: !!s.task || (!!s.used_at && s.used_at > claimCutoff),
    task: s.task,
    content: content && {
      source: content.source,
      id: content.id,
      code: content.code,
      title: content.title,
      is_win: content.isWin,
      win_views: content.winViews,
    },
    video:
      s.kind === "WIN_VIDEO"
        ? {
            platform: s.video_platform,
            post_id: s.video_post_id,
            url: s.video_url,
            caption: s.video_caption,
            thumbnail_url: s.video_thumbnail_url,
            views: s.video_views,
            published_at: s.video_published_at,
            page_name: s.video_page_name,
          }
        : null,
  };
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Khoảng ngày kế hoạch (YYYY-MM-DD giờ VN, null = không giới hạn đầu đó) theo bộ lọc ngày của FE. */
export function resolvePlanRange(
  q: { date?: string; from?: string; to?: string; all?: string },
  today: string,
): { from: string | null; to: string | null } {
  if (q.date) return { from: q.date, to: q.date };
  if (q.all === "true") return { from: null, to: null };
  if (q.from || q.to) return { from: q.from ?? null, to: q.to ?? null };
  return { from: today, to: today };
}

@Injectable()
export class DailyPlansService {
  constructor(
    private prisma: PrismaService,
    private tasks: TaskAutoTasksService,
    private scraperRead: ScraperAggregateReadService,
  ) {}

  /**
   * Kế hoạch ngày của chính người gọi theo bộ lọc ngày (mặc định hôm nay giờ VN).
   * - `totals`: mỗi (team, tuyến) 1 dòng cộng dồn chỉ tiêu các ngày trong khoảng.
   * - `plans`: chỉ khi khoảng đúng 1 ngày — kế hoạch chi tiết kèm gợi ý.
   * "Đã làm" đếm từ ngày kế hoạch đầu (không từ đầu khoảng lọc) để không cộng task của ngày chưa có kế hoạch.
   */
  async getMyPlans(userId: string, query: { date?: string; from?: string; to?: string; all?: string } = {}) {
    const { from, to } = resolvePlanRange(query, vietnamDateString());
    const single = from !== null && from === to;
    const planDateFilter: Prisma.DateTimeFilter = {
      ...(from && { gte: dailyKpiDate(from) }),
      ...(to && { lte: dailyKpiDate(to) }),
    };
    const rows = await this.prisma.dailyLinePlan.findMany({
      where: { user_id: userId, ...(from || to ? { plan_date: planDateFilter } : {}) },
      orderBy: [{ content_line: { name: "asc" } }, { plan_date: "asc" }, { created_at: "asc" }],
      select: {
        id: true,
        plan_date: true,
        target: true,
        monthly_target: true,
        deadline: true,
        // market: FE lấy mặc định bộ lọc thị trường khi tìm trong hệ thống
        team: { select: { id: true, name: true, market: true } },
        content_line: { select: { id: true, name: true } },
      },
    });
    const planDates = [...new Set(rows.map((r) => toDateString(r.plan_date)))].sort();
    const empty = { from, to, plan_date: single ? from : null, plan_dates: planDates, plans: [], totals: [] };
    if (!rows.length) return empty;

    const window = {
      gte: vietnamDayRangeOf(planDates[0])!.gte,
      lt: vietnamDayRangeOf(planDates[planDates.length - 1])!.lt,
    };
    const doneRows = await this.prisma.task.groupBy({
      by: ["team_id", "content_line_id"],
      where: {
        assignee_id: userId,
        team_id: { in: [...new Set(rows.map((r) => r.team.id))] },
        content_line_id: { in: [...new Set(rows.map((r) => r.content_line.id))] },
        status: { not: "CANCELLED" },
        ...deadlineWindow(window),
      },
      _count: { _all: true },
    });
    const key = (teamId: string | null, lineId: string | null) => `${teamId}|${lineId}`;
    const doneBy = new Map(doneRows.map((d) => [key(d.team_id, d.content_line_id), d._count._all]));

    const totals = new Map<string, { team: (typeof rows)[number]["team"]; content_line: (typeof rows)[number]["content_line"]; target: number; days: number }>();
    for (const r of rows) {
      const k = key(r.team.id, r.content_line.id);
      const t = totals.get(k) ?? { team: r.team, content_line: r.content_line, target: 0, days: 0 };
      t.target += r.target;
      t.days++;
      totals.set(k, t);
    }
    const totalRows = [...totals].map(([k, t]) => {
      const done = doneBy.get(k) ?? 0;
      return { ...t, done, remaining: Math.max(0, t.target - done) };
    });
    if (!single) return { ...empty, totals: totalRows };

    // 1 ngày: mỗi (team, tuyến) đúng 1 kế hoạch (unique user+team+ngày+tuyến) → gắn gợi ý.
    const suggestions = await this.prisma.dailyLinePlanSuggestion.findMany({
      where: { plan_id: { in: rows.map((r) => r.id) } },
      orderBy: { rank: "asc" },
      select: { ...SUGGESTION_SELECT, plan_id: true },
    });
    const claimCutoff = suggestionClaimCutoff();
    return {
      ...empty,
      totals: totalRows,
      plans: rows.map((p) => {
        const done = doneBy.get(key(p.team.id, p.content_line.id)) ?? 0;
        return {
          id: p.id,
          team: p.team,
          content_line: p.content_line,
          target: p.target,
          done,
          remaining: Math.max(0, p.target - done),
          monthly_target: p.monthly_target,
          deadline: p.deadline,
          suggestions: suggestions.filter((s) => s.plan_id === p.id).map((s) => formatSuggestion(s, claimCutoff)),
        };
      }),
    };
  }

  /**
   * Tạo task từ các gợi ý (chỉ gợi ý thuộc kế hoạch của chính mình): content có sẵn → task gắn content
   * đó; video win → tạo content kho cá nhân từ caption (bỏ hashtag) rồi tạo task. Task đi qua
   * tasks.service create() như tạo tay: loại EXTRA, người nhận = mình, tuyến + hạn chót theo kế hoạch.
   */
  async quickCreate(userId: string, roles: string[], suggestionIds: string[]) {
    const ids = [...new Set(suggestionIds)];
    const suggestions = await this.prisma.dailyLinePlanSuggestion.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        kind: true,
        content_id: true,
        team_content_id: true,
        editor_content_id: true,
        video_post_id: true,
        video_url: true,
        video_caption: true,
        used_at: true,
        task_id: true,
        plan: {
          select: {
            user_id: true,
            team_id: true,
            content_line_id: true,
            deadline: true,
            team: { select: { brand_type: true, market: true } },
          },
        },
      },
    });
    const byId = new Map(suggestions.map((s) => [s.id, s]));

    const created: { suggestion_id: string; task_id: string }[] = [];
    const failed: { suggestion_id: string; message: string }[] = [];
    for (const id of ids) {
      const s = byId.get(id);
      if (!s || s.plan.user_id !== userId) {
        failed.push({ suggestion_id: id, message: "Không tìm thấy gợi ý trong kế hoạch của bạn" });
        continue;
      }
      // Giữ chỗ trước khi tạo — bấm 2 lần / 2 tab cùng lúc chỉ 1 lần tạo được task. Giữ chỗ quá hạn mà
      // chưa gắn task (lần trước hỏng giữa chừng / task đã bị xoá) thì giữ chỗ lại được.
      const claimed = s.task_id
        ? { count: 0 }
        : await this.prisma.dailyLinePlanSuggestion.updateMany({
            where: {
              id,
              task_id: null,
              OR: [{ used_at: null }, { used_at: { lt: suggestionClaimCutoff() } }],
            },
            data: { used_at: new Date() },
          });
      if (!claimed.count) {
        failed.push({ suggestion_id: id, message: "Gợi ý này đã được tạo task" });
        continue;
      }

      let newContentId: string | null = null;
      try {
        let contentRef: Pick<CreateTaskDto, "content_id" | "team_content_id" | "editor_content_id">;
        if (s.kind === "CONTENT") {
          contentRef = {
            content_id: s.content_id ?? undefined,
            team_content_id: s.team_content_id ?? undefined,
            editor_content_id: s.editor_content_id ?? undefined,
          };
        } else {
          const content = await this.findOrCreateVideoContent(
            userId,
            { post_id: s.video_post_id, url: s.video_url, caption: s.video_caption },
            s.plan.team,
            s.plan.content_line_id,
          );
          if (content.created) newContentId = content.id;
          contentRef = { editor_content_id: content.id };
        }
        const task = await this.tasks.create(
          {
            team_id: s.plan.team_id,
            ...contentRef,
            content_line_id: s.plan.content_line_id,
            assignee_id: userId,
            deadline: s.plan.deadline.toISOString(),
          },
          userId,
          roles,
        );
        // Task đã tạo xong là tính — lượt chia chạy lại đúng lúc này có thể đã thay gợi ý, khi đó chỉ
        // không gắn được task vào gợi ý (không báo lỗi, không dọn content mà task đang dùng).
        await this.prisma.dailyLinePlanSuggestion
          .updateMany({ where: { id }, data: { task_id: task.id } })
          .catch(() => null);
        created.push({ suggestion_id: id, task_id: task.id });
      } catch (err) {
        // Chỉ tới đây khi CHƯA tạo được task → nhả giữ chỗ, dọn content vừa tạo từ video
        await this.prisma.dailyLinePlanSuggestion
          .updateMany({ where: { id, task_id: null }, data: { used_at: null } })
          .catch(() => null);
        if (newContentId) {
          await this.prisma.editorContent.delete({ where: { id: newContentId } }).catch(() => null);
        }
        failed.push({
          suggestion_id: id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { created, failed };
  }

  // ── Tìm trong toàn hệ thống (ngoài gợi ý) ─────────────────────────────────────────────────

  /**
   * Tìm content trong các kho người đó được dùng (kho cá nhân của mình, kho team của kế hoạch, kho
   * tổng) hoặc video win Facebook trên mọi kênh nội bộ — mặc định lọc theo tuyến của kế hoạch.
   */
  async searchForPlan(userId: string, planId: string, query: PlanSearchQueryDto) {
    const plan = await this.loadOwnPlan(userId, planId);
    const page = query.page ?? 1;
    const q = (query.q ?? "").trim();
    const lineId = query.line === "all" ? null : query.line || plan.content_line_id;
    const market = query.market ?? defaultSearchMarket(plan.team);
    const lines = await this.prisma.contentLine.findMany({ select: { id: true, name: true } });
    const lineById = new Map(lines.map((l) => [l.id, l]));

    if (query.kind === "video") {
      const lineName = lineId ? lineById.get(lineId)?.name : undefined;
      if (lineId && !lineName) return { items: [], total: 0, has_more: false, market };
      const res = await this.scraperRead.ownedChannelVideos({
        platform: "facebook",
        min_plays: String(WIN_VIDEO_MIN_VIEWS),
        q: q || undefined,
        content_line: lineName,
        market: videoMarketParam(market, plan.team.brand_type),
        sort: "plays",
        page: String(page),
        page_size: String(SEARCH_PAGE_SIZE),
      });
      const converted = await loadConvertedVideoPostIds(
        this.prisma,
        [userId],
        res.videos.map((v) => v.post_id),
      );
      const mine = converted.get(userId) ?? new Set<string>();
      return {
        items: res.videos.map((v) => ({
          platform: v.platform,
          post_id: v.post_id,
          url: v.url,
          caption: v.description,
          thumbnail_url: v.thumbnail_url || null,
          views: v.play_count,
          published_at: v.date_posted,
          page_name: v.author_name || null,
          line_name: lineNameFromCaption(v.description),
          in_my_warehouse: mine.has(v.post_id),
        })),
        total: res.count,
        has_more: page < res.total_pages,
        market,
      };
    }

    const [candidates, history] = await Promise.all([
      loadContentCandidates(this.prisma, {
        teamId: plan.team_id,
        brandType: plan.team.brand_type,
        editorIds: [userId],
      }),
      loadContentUseHistory(
        this.prisma,
        [userId],
        DateTime.now().minus({ days: CONTENT_HISTORY_LOOKBACK_DAYS }).toJSDate(),
      ),
    ]);
    const used = history.get(userId) ?? new Map<string, Date>();
    const matched = dedupeContentCopies(
      candidates.filter(
        (c) =>
          (!lineId || c.contentLineId === lineId) &&
          contentMatchesMarket(c, market) &&
          contentMatchesQuery(c, q),
      ),
    ).sort(
      (a, b) =>
        Number(b.isWin) - Number(a.isWin) ||
        a.tier - b.tier ||
        (a.title ?? "").localeCompare(b.title ?? "", "vi"),
    );
    const slice = matched.slice((page - 1) * SEARCH_PAGE_SIZE, page * SEARCH_PAGE_SIZE);
    return {
      items: slice.map((c) => ({
        source: c.source,
        id: c.id,
        code: c.code,
        title: c.title,
        line: c.contentLineId ? lineById.get(c.contentLineId) ?? null : null,
        market: c.market,
        is_win: c.isWin,
        win_views: c.winViews,
        // Lần gần nhất chính mình làm content này (60 ngày) — vẫn cho tạo, chỉ để người dùng biết
        last_used_at: c.keys.reduce<Date | null>((last, k) => {
          const d = used.get(k);
          return d && (!last || d > last) ? d : last;
        }, null),
      })),
      total: matched.length,
      has_more: page * SEARCH_PAGE_SIZE < matched.length,
      market,
    };
  }

  /**
   * Tạo task từ 1 kết quả tìm kiếm: content trong kho → task gắn content đó; video win → content kho
   * cá nhân từ caption (bỏ hashtag) rồi tạo task. Tuyến của task theo content (video: hashtag #A1..),
   * không có thì theo kế hoạch; hạn chót theo kế hoạch. Trùng với 1 gợi ý của kế hoạch thì gắn luôn.
   */
  async quickCreateFromSearch(
    userId: string,
    roles: string[],
    planId: string,
    dto: QuickCreateFromSearchDto,
  ): Promise<{ task_id: string; reused: boolean }> {
    const plan = await this.loadOwnPlan(userId, planId);

    let contentRef: Pick<CreateTaskDto, "content_id" | "team_content_id" | "editor_content_id">;
    let lineId: string;
    let newContentId: string | null = null;
    if (dto.kind === "CONTENT") {
      const content = await this.loadAccessibleContent(userId, plan, dto.source!, dto.content_id!);
      contentRef = { [CONTENT_REF_FIELD[content.source]]: content.id };
      lineId = content.contentLineId ?? plan.content_line_id;
    } else {
      const video = await this.findWinVideo(dto.post_id!);
      const lineName = lineNameFromCaption(video.caption);
      const line = lineName
        ? await this.prisma.contentLine.findFirst({
            where: { name: { equals: lineName, mode: "insensitive" } },
            select: { id: true },
          })
        : null;
      lineId = line?.id ?? plan.content_line_id;
      const content = await this.findOrCreateVideoContent(userId, video, plan.team, lineId);
      if (content.created) newContentId = content.id;
      contentRef = { editor_content_id: content.id };
    }

    const recent = await this.prisma.task.findFirst({
      where: {
        assignee_id: userId,
        ...contentRef,
        created_at: { gte: new Date(Date.now() - SEARCH_DUPLICATE_WINDOW_MS) },
      },
      select: { id: true },
    });
    if (recent) return { task_id: recent.id, reused: true };

    let taskId: string;
    try {
      const task = await this.tasks.create(
        {
          team_id: plan.team_id,
          ...contentRef,
          content_line_id: lineId,
          assignee_id: userId,
          deadline: plan.deadline.toISOString(),
        },
        userId,
        roles,
      );
      taskId = task.id;
    } catch (err) {
      if (newContentId) {
        await this.prisma.editorContent.delete({ where: { id: newContentId } }).catch(() => null);
      }
      throw err;
    }

    // Kết quả tìm kiếm trùng 1 gợi ý chưa dùng của kế hoạch → gắn task để gợi ý không còn "Tạo task"
    const suggestion = await this.prisma.dailyLinePlanSuggestion.findFirst({
      where: {
        plan_id: plan.id,
        task_id: null,
        ...(dto.kind === "CONTENT" ? contentRef : { video_post_id: dto.post_id }),
      },
      select: { id: true },
    });
    if (suggestion) {
      await this.prisma.dailyLinePlanSuggestion
        .updateMany({ where: { id: suggestion.id, task_id: null }, data: { task_id: taskId, used_at: new Date() } })
        .catch(() => null);
    }
    return { task_id: taskId, reused: false };
  }

  private async loadOwnPlan(userId: string, planId: string): Promise<PlanForSearch> {
    const plan = await this.prisma.dailyLinePlan.findFirst({
      where: { id: planId, user_id: userId },
      select: {
        id: true,
        team_id: true,
        content_line_id: true,
        deadline: true,
        team: { select: { brand_type: true, market: true } },
      },
    });
    if (!plan) throw new NotFoundException("Không tìm thấy kế hoạch ngày của bạn");
    return plan;
  }

  /** Content chỉ dùng được nếu ở kho cá nhân của chính mình, kho team của kế hoạch hoặc kho tổng. */
  private async loadAccessibleContent(
    userId: string,
    plan: PlanForSearch,
    source: ContentSource,
    id: string,
  ): Promise<ContentCandidate> {
    const notArchived = { not: "ARCHIVED" as const };
    let content: ContentCandidate | null = null;
    if (source === "editor") {
      const row = await this.prisma.editorContent.findFirst({
        where: { id, user_id: userId, status: notArchived },
        select: EDITOR_CONTENT_SELECT,
      });
      content = row && editorContentCandidate(row);
    } else if (source === "team") {
      const row = await this.prisma.teamContent.findFirst({
        where: { id, team_id: plan.team_id, status: notArchived },
        select: TEAM_CONTENT_SELECT,
      });
      content = row && teamContentCandidate(row);
    } else {
      const row = await this.prisma.content.findFirst({
        where: { id, status: notArchived },
        select: GLOBAL_CONTENT_SELECT,
      });
      content = row && globalContentCandidate(row);
    }
    if (!content) {
      throw new NotFoundException("Không tìm thấy content hoặc bạn không được dùng content này");
    }
    return content;
  }

  /** Video Facebook kênh nội bộ đạt ngưỡng win — tra lại ở BE, không tin caption/link từ client. */
  private async findWinVideo(
    postId: string,
  ): Promise<{ post_id: string; url: string | null; caption: string | null }> {
    const rows = await this.prisma.$queryRaw<
      { post_id: string; url: string | null; caption: string | null }[]
    >`
      SELECT v.post_id, NULLIF(v.permalink_url, '') AS url, v.caption
      FROM video_management_ownedvideocontent v
      JOIN video_management_managedfacebookpage mp ON mp.id = v.managed_page_id AND mp.is_active = true
      WHERE v.post_id = ${postId} AND v.view_count >= ${BigInt(WIN_VIDEO_MIN_VIEWS)}
      LIMIT 1
    `;
    if (!rows.length) throw new NotFoundException("Không tìm thấy video win này");
    return rows[0];
  }

  /**
   * Content kho cá nhân cho 1 video win — dùng lại content người đó đã tạo từ đúng video này (nếu
   * có), không thì tạo mới từ caption đã bỏ hashtag.
   */
  private async findOrCreateVideoContent(
    userId: string,
    video: { post_id: string | null; url: string | null; caption: string | null },
    team: { brand_type: BrandType; market: string },
    contentLineId: string,
  ): Promise<{ id: string; created: boolean }> {
    if (video.post_id) {
      const existing = await this.prisma.editorContent.findFirst({
        where: {
          user_id: userId,
          reference_video_post_id: video.post_id,
          status: { not: "ARCHIVED" },
        },
        select: { id: true },
      });
      if (existing) return { id: existing.id, created: false };
    }
    const { title, body } = captionToContent(video.caption);
    const content = await this.prisma.editorContent.create({
      data: {
        user_id: userId,
        added_by_id: userId,
        brand_type: team.brand_type,
        market: team.market,
        title,
        body,
        content_line_id: contentLineId,
        reference_video_url: video.url,
        reference_video_post_id: video.post_id,
      },
      select: { id: true },
    });
    return { id: content.id, created: true };
  }
}
