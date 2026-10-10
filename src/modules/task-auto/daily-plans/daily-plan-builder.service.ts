import { Injectable, Logger } from "@nestjs/common";
import { DateTime } from "luxon";
import { BrandType, Prisma } from "@prisma/client";

import { dailyKpiDate, effectiveAssignmentDate } from "../../../utils/date.utils";
import { loadLineQuotas } from "../task-auto-assign/steps/editor-eligibility";
import { calendarDaysSince } from "../task-auto-assign/steps/cooldown";
import {
  CONTENT_REF_FIELD,
  loadContentPool,
  loadContentUseHistory,
} from "./steps/content-pool";
import {
  loadConvertedVideoPostIds,
  loadMatchedVideoContentKeys,
  loadWinVideoPool,
} from "./steps/win-video-pool";
import {
  CONTENT_HISTORY_LOOKBACK_DAYS,
  CONTENT_REUSE_COOLDOWN_DAYS,
  ContentCandidate,
  DailyPlanRunSummary,
  MIN_SUGGESTIONS,
  PlanDraft,
  SUGGESTIONS_PER_MISSING_VIDEO,
  WinVideoCandidate,
  suggestionClaimCutoff,
} from "./types";
import { PrismaService } from "@/common/prisma/prisma.service";
import { PushService } from "@/common/push/push.service";
import { ScraperAggregateReadService } from "@/modules/scraper-aggregate/scraper-aggregate-read.service";

export type PlanTeam = { id: string; name: string; brand_type: BrandType; market: string | null };
type PlanLine = { id: string; name: string };

/** Số gợi ý mỗi loại cho 1 kế hoạch — 0 khi người đó đã đủ task của ngày. */
export function suggestionCount(remaining: number): number {
  if (remaining <= 0) return 0;
  return Math.max(MIN_SUGGESTIONS, remaining * SUGGESTIONS_PER_MISSING_VIDEO);
}

function latest(keys: string[], byKey: Map<string, Date>): Date | undefined {
  let last: Date | undefined;
  for (const k of keys) {
    const d = byKey.get(k);
    if (d && (!last || d > last)) last = d;
  }
  return last;
}

function maxCount(keys: string[], byKey: Map<string, number>): number {
  return keys.reduce((m, k) => Math.max(m, byKey.get(k) ?? 0), 0);
}

/**
 * Chọn tối đa `need` content cho 1 người. Content người đó đã làm trong 14 ngày bị LOẠI (tính cả bản
 * ở kho khác của cùng content); kho cá nhân chỉ lấy của chính người đó. Trong số còn lại, ưu tiên:
 *   1. content ít được gợi ý cho người khác cùng team trong lượt này — rải content cho cả team
 *   2. content đã từng win
 *   3. kho cá nhân → kho team → kho tổng
 *   4. người đó lâu chưa làm nhất (chưa từng làm lên đầu)
 * Không gợi ý 2 bản của cùng 1 content.
 */
export function pickContentSuggestions(args: {
  pool: ContentCandidate[];
  userId: string;
  need: number;
  lastUsed: Map<string, Date>;
  pickedInRun: Map<string, number>;
  today: DateTime;
  cooldownDays?: number;
}): ContentCandidate[] {
  const { pool, userId, need, lastUsed, pickedInRun, today } = args;
  const cooldownDays = args.cooldownDays ?? CONTENT_REUSE_COOLDOWN_DAYS;
  if (need <= 0) return [];

  const ranked = pool
    .filter((c) => c.ownerUserId == null || c.ownerUserId === userId)
    .map((c) => ({ c, last: latest(c.keys, lastUsed), picked: maxCount(c.keys, pickedInRun) }))
    .filter(({ last }) => !last || calendarDaysSince(last, today) >= cooldownDays)
    .sort(
      (a, b) =>
        a.picked - b.picked ||
        Number(b.c.isWin) - Number(a.c.isWin) ||
        a.c.tier - b.c.tier ||
        (a.last?.getTime() ?? 0) - (b.last?.getTime() ?? 0) ||
        (b.c.winViews ?? 0) - (a.c.winViews ?? 0) ||
        a.c.id.localeCompare(b.c.id),
    );

  const picked: ContentCandidate[] = [];
  const pickedKeys = new Set<string>();
  for (const { c } of ranked) {
    if (picked.length >= need) break;
    if (c.keys.some((k) => pickedKeys.has(k))) continue;
    picked.push(c);
    for (const k of c.keys) pickedKeys.add(k);
  }
  return picked;
}

/**
 * Chọn tối đa `need` video win cho 1 người: bỏ video người đó đã lấy làm content; ưu tiên video ít
 * được gợi ý cho người khác trong lượt → video kênh của team → nhiều view hơn.
 */
export function pickWinVideoSuggestions(args: {
  pool: WinVideoCandidate[];
  need: number;
  excludedPostIds: Set<string>;
  pickedInRun: Map<string, number>;
}): WinVideoCandidate[] {
  const { pool, need, excludedPostIds, pickedInRun } = args;
  if (need <= 0) return [];
  return pool
    .filter((v) => !excludedPostIds.has(v.post_id))
    .sort(
      (a, b) =>
        (pickedInRun.get(a.post_id) ?? 0) - (pickedInRun.get(b.post_id) ?? 0) ||
        Number(b.fromTeam) - Number(a.fromTeam) ||
        b.views - a.views ||
        a.post_id.localeCompare(b.post_id),
    )
    .slice(0, need);
}

/**
 * Kế hoạch ngày cho các tuyến không tự tạo task (mặc định A1/A2/A3/A5): mỗi editor có KPI tuyến đó
 * nhận chỉ tiêu ngày (cùng công thức task A4) + gợi ý content kho / video win. KHÔNG tạo task.
 */
@Injectable()
export class DailyPlanBuilderService {
  private readonly logger = new Logger(DailyPlanBuilderService.name);

  constructor(
    private prisma: PrismaService,
    private pushService: PushService,
    private scraperRead: ScraperAggregateReadService,
  ) {}

  async buildDailyPlans(args: {
    teams: PlanTeam[];
    lineNames: string[];
    now: DateTime;
    month: string;
    deadline: Date;
    runId: string | null;
  }): Promise<DailyPlanRunSummary> {
    const { teams, lineNames, now, month, deadline, runId } = args;
    const planDateStr = effectiveAssignmentDate(now).toFormat("yyyy-MM-dd");
    const lines = await this.findLines(lineNames);
    const summary: DailyPlanRunSummary = {
      plan_date: planDateStr,
      lines: lines.map((l) => l.name),
      plans: 0,
      suggestions: 0,
      teams: {},
    };
    if (!lines.length) return summary;

    const planDate = dailyKpiDate(planDateStr);
    const newPlans: { userId: string; lineName: string; target: number }[] = [];
    for (const team of teams) {
      const drafts = await this.draftTeamPlans(team, lines, now, month);
      const persisted = await this.persistTeamPlans(team.id, lines, planDate, deadline, runId, drafts);
      if (!drafts.length) continue;
      summary.plans += drafts.length;
      summary.suggestions += persisted.suggestions;
      summary.teams[team.id] = {
        team_name: team.name,
        plans: drafts.length,
        suggestions: persisted.suggestions,
      };
      const lineName = new Map(lines.map((l) => [l.id, l.name]));
      for (const d of persisted.created) {
        newPlans.push({ userId: d.userId, lineName: lineName.get(d.contentLineId)!, target: d.target });
      }
    }

    await this.notifyNewPlans(newPlans, planDateStr);
    this.logger.log(
      `Kế hoạch ngày ${planDateStr}: ${summary.plans} kế hoạch, ${summary.suggestions} gợi ý (${summary.lines.join(", ")})`,
    );
    return summary;
  }

  async findLines(lineNames: string[]): Promise<PlanLine[]> {
    if (!lineNames.length) return [];
    return this.prisma.contentLine.findMany({
      where: { OR: lineNames.map((name) => ({ name: { equals: name, mode: "insensitive" as const } })) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  /** Tính kế hoạch (chưa ghi DB) cho mọi editor có KPI các tuyến `lines` trong 1 team. */
  async draftTeamPlans(
    team: PlanTeam,
    lines: PlanLine[],
    now: DateTime,
    month: string,
  ): Promise<PlanDraft[]> {
    const quotas = await loadLineQuotas(this.prisma, team.id, lines.map((l) => l.id), now, month);
    if (!quotas.length) return [];

    const editorIds = [...new Set(quotas.map((q) => q.userId))];
    const linesInUse = lines.filter((l) => quotas.some((q) => q.contentLineId === l.id));
    const [contentPool, history, videoPools] = await Promise.all([
      loadContentPool(this.prisma, {
        teamId: team.id,
        brandType: team.brand_type,
        editorIds,
        contentLineIds: linesInUse.map((l) => l.id),
      }),
      loadContentUseHistory(
        this.prisma,
        editorIds,
        now.minus({ days: CONTENT_HISTORY_LOOKBACK_DAYS }).startOf("day").toJSDate(),
      ),
      Promise.all(
        linesInUse.map(async (l) => [l.id, await loadWinVideoPool(this.scraperRead, team, l.name, now)] as const),
      ),
    ]);

    // Video win đã khớp về task có content → content đó là content win, không tạo content mới từ video.
    const allVideos = videoPools.flatMap(([, videos]) => videos);
    const postIds = allVideos.map((v) => v.post_id);
    const [matchedKeys, converted] = await Promise.all([
      loadMatchedVideoContentKeys(this.prisma, postIds),
      loadConvertedVideoPostIds(this.prisma, editorIds, postIds),
    ]);
    const winViewsByKey = new Map<string, number>();
    for (const v of allVideos) {
      for (const k of matchedKeys.get(v.post_id) ?? []) {
        winViewsByKey.set(k, Math.max(winViewsByKey.get(k) ?? 0, v.views));
      }
    }
    for (const candidates of contentPool.values()) {
      for (const c of candidates) {
        const views = Math.max(0, ...c.keys.map((k) => winViewsByKey.get(k) ?? 0));
        if (views > 0) {
          c.isWin = true;
          c.winViews = Math.max(c.winViews ?? 0, views);
        }
      }
    }
    const videosByLine = new Map<string, WinVideoCandidate[]>(
      videoPools.map(([lineId, videos]) => [lineId, videos.filter((v) => !matchedKeys.has(v.post_id))]),
    );

    const pickedContents = new Map<string, Map<string, number>>();
    const pickedVideos = new Map<string, Map<string, number>>();
    const drafts: PlanDraft[] = [];
    for (const q of quotas) {
      const need = suggestionCount(q.remainingToday);
      if (!pickedContents.has(q.contentLineId)) pickedContents.set(q.contentLineId, new Map());
      if (!pickedVideos.has(q.contentLineId)) pickedVideos.set(q.contentLineId, new Map());
      const contentsInRun = pickedContents.get(q.contentLineId)!;
      const videosInRun = pickedVideos.get(q.contentLineId)!;

      const contents = pickContentSuggestions({
        pool: contentPool.get(q.contentLineId) ?? [],
        userId: q.userId,
        need,
        lastUsed: history.get(q.userId) ?? new Map(),
        pickedInRun: contentsInRun,
        today: now,
      });
      const videos = pickWinVideoSuggestions({
        pool: videosByLine.get(q.contentLineId) ?? [],
        need,
        excludedPostIds: converted.get(q.userId) ?? new Set(),
        pickedInRun: videosInRun,
      });
      for (const c of contents) for (const k of c.keys) contentsInRun.set(k, (contentsInRun.get(k) ?? 0) + 1);
      for (const v of videos) videosInRun.set(v.post_id, (videosInRun.get(v.post_id) ?? 0) + 1);

      drafts.push({
        userId: q.userId,
        teamId: team.id,
        contentLineId: q.contentLineId,
        target: q.dailyTarget,
        monthlyTarget: q.monthlyTarget,
        contents,
        videos,
      });
    }
    return drafts;
  }

  /**
   * Ghi kế hoạch của 1 team cho ngày `planDate`. Chạy lại trong ngày: cập nhật chỉ tiêu, giữ gợi ý đã
   * gắn task / đang được tạo, thay phần còn lại; kế hoạch không còn trong lượt này (hết KPI...) mà
   * chưa có gợi ý nào gắn task thì xoá.
   */
  private async persistTeamPlans(
    teamId: string,
    lines: PlanLine[],
    planDate: Date,
    deadline: Date,
    runId: string | null,
    drafts: PlanDraft[],
  ): Promise<{ suggestions: number; created: PlanDraft[] }> {
    let suggestions = 0;
    const created: PlanDraft[] = [];
    const keptIds: string[] = [];
    // Gợi ý "đã dùng" = đã gắn task, hoặc đang được tạo (giữ chỗ chưa quá hạn) — giữ nguyên khi chạy lại
    const claimCutoff = suggestionClaimCutoff();
    const inUse: Prisma.DailyLinePlanSuggestionWhereInput = {
      OR: [{ task_id: { not: null } }, { used_at: { gte: claimCutoff } }],
    };

    for (const d of drafts) {
      const existing = await this.prisma.dailyLinePlan.findUnique({
        where: {
          user_id_team_id_plan_date_content_line_id: {
            user_id: d.userId,
            team_id: teamId,
            plan_date: planDate,
            content_line_id: d.contentLineId,
          },
        },
        select: {
          id: true,
          suggestions: {
            where: inUse,
            select: {
              rank: true,
              content_id: true,
              team_content_id: true,
              editor_content_id: true,
              video_post_id: true,
            },
          },
        },
      });

      let planId: string;
      if (existing) {
        planId = existing.id;
        await this.prisma.dailyLinePlan.update({
          where: { id: planId },
          data: { target: d.target, monthly_target: d.monthlyTarget, deadline, run_id: runId },
        });
        // Viết tường minh thay vì NOT(inUse): NOT (used_at >= x) với used_at NULL ra NULL → không xoá
        await this.prisma.dailyLinePlanSuggestion.deleteMany({
          where: {
            plan_id: planId,
            task_id: null,
            OR: [{ used_at: null }, { used_at: { lt: claimCutoff } }],
          },
        });
      } else {
        const plan = await this.prisma.dailyLinePlan.create({
          data: {
            user_id: d.userId,
            team_id: teamId,
            plan_date: planDate,
            content_line_id: d.contentLineId,
            target: d.target,
            monthly_target: d.monthlyTarget,
            deadline,
            run_id: runId,
          },
          select: { id: true },
        });
        planId = plan.id;
        created.push(d);
      }
      keptIds.push(planId);

      const used = existing?.suggestions ?? [];
      const usedRefs = new Set(
        used.flatMap((s) => [s.content_id, s.team_content_id, s.editor_content_id, s.video_post_id]),
      );
      let rank = used.reduce((m, s) => Math.max(m, s.rank), 0);
      const rows: Prisma.DailyLinePlanSuggestionCreateManyInput[] = [
        ...d.contents
          .filter((c) => !usedRefs.has(c.id))
          .map((c) => ({
            plan_id: planId,
            kind: "CONTENT" as const,
            rank: ++rank,
            [CONTENT_REF_FIELD[c.source]]: c.id,
          })),
        ...d.videos
          .filter((v) => !usedRefs.has(v.post_id))
          .map((v) => ({
            plan_id: planId,
            kind: "WIN_VIDEO" as const,
            rank: ++rank,
            video_platform: v.platform,
            video_post_id: v.post_id,
            video_url: v.url,
            video_caption: v.caption,
            video_thumbnail_url: v.thumbnail_url,
            video_views: v.views,
            video_published_at: v.published_at,
            video_page_name: v.page_name,
          })),
      ];
      if (rows.length) await this.prisma.dailyLinePlanSuggestion.createMany({ data: rows });
      suggestions += rows.length;
    }

    await this.prisma.dailyLinePlan.deleteMany({
      where: {
        team_id: teamId,
        plan_date: planDate,
        content_line_id: { in: lines.map((l) => l.id) },
        id: { notIn: keptIds },
        suggestions: { none: { task_id: { not: null } } },
      },
    });
    return { suggestions, created };
  }

  /** 1 thông báo / người cho các kế hoạch MỚI (chạy lại trong ngày không báo lại). */
  private async notifyNewPlans(
    plans: { userId: string; lineName: string; target: number }[],
    planDateStr: string,
  ): Promise<void> {
    const byUser = new Map<string, { lineName: string; target: number }[]>();
    for (const p of plans) {
      if (!byUser.has(p.userId)) byUser.set(p.userId, []);
      byUser.get(p.userId)!.push(p);
    }
    if (!byUser.size) return;

    const dayLabel = DateTime.fromISO(planDateStr).toFormat("dd/MM");
    const title = `Kế hoạch ngày ${dayLabel}`;
    const notices = [...byUser].map(([userId, items]) => {
      items.sort((a, b) => a.lineName.localeCompare(b.lineName));
      return {
        user_id: userId,
        type: "DAILY_PLAN",
        title,
        body: `${items.map((i) => `${i.lineName}: ${i.target} video`).join(" · ")} — mở trang Nhiệm vụ để xem gợi ý content và tạo task nhanh.`,
        meta: {
          plan_date: planDateStr,
          lines: items.map((i) => ({ name: i.lineName, target: i.target })),
        } as Prisma.InputJsonValue,
      };
    });
    await this.prisma.notification.createMany({ data: notices });
    for (const n of notices) {
      this.pushService
        .sendToUser(n.user_id, { title: n.title, body: n.body, url: "/dashboard/task-auto/tasks" })
        .catch(() => {});
    }
  }
}
