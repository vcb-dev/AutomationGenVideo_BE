import { ForbiddenException, Injectable, Logger, Optional } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import { createHash, randomUUID } from "crypto";
import { TaskStatus, UserRole } from "@prisma/client";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { unaccent } from "../../../common/utils/unaccent.util";
import {
  asPublishedLinks,
  mutateTaskPublishedLinks,
  PublishedLinkEntry,
} from "../../../common/utils/task-published-links.util";
import { extractHashtags } from "../../instagram-owned-accounts/instagram-owned-accounts.service";
import { buildPageChannelMap } from "../../facebook-owned-pages/page-channel-resolver";
import { TaskPublishedLinkStatsService } from "../published-links/task-published-link-stats.service";
import { vietnamDayRangeOf } from "../../../utils/date.utils";
import { taskLineConditions } from "../../../utils/task-auto/task-list-query.util";
import {
  AI_DEFAULT_MIN_CONFIDENCE,
  AiMatchMode,
  AiVerdict,
  CandidateTask,
  CandidateVideo,
  ChannelContext,
  DAY_MS,
  MatchPlatform,
  PickResult,
  acceptAiVerdict,
  aiShortlist,
  captionHook,
  enforceChannelOwnerGuard,
  extractKCode,
  extractSkuTags,
  isWithinFarWindow,
  longDigitRun,
  normalizeHashtag,
  pickWinner,
  scoreCandidate,
  skuMatches,
  statusFromReason,
  taskAnchor,
} from "../../../utils/task-auto/task-video-match.util";

/** Tăng số này khi rule thay đổi để các bản ghi bỏ qua của rule cũ được xét lại đúng 1 lần. */
const MATCHER_VERSION = 7;
/** Cron phủ hết cửa sổ 21 ngày (~4.700 video); lượt bấm tay phải xong trong timeout 180s của FE. */
const DEFAULT_MAX_VIDEOS = 6000;
const MANUAL_MAX_VIDEOS = 3000;
/** Trần số ca hỏi AI mỗi lượt (~0.35s/ca ⇒ ~70s): ca còn lại để lượt sau. */
const MAX_AI_CASES_PER_RUN = 200;
export const AI_PROMPT_VERSION = 4;
const AI_CHUNK_SIZE = 10;

export interface AiJudgeCandidate {
  task_id: string;
  title: string;
  script: string;
  product_names: string[];
  product_skus: string[];
  anchor_at: string | null;
  days_from_video: number | null;
  has_platform_link: boolean;
  linked_videos_same_platform: (string | null)[];
}

export interface AiJudgeCase {
  case_id: string;
  video: {
    platform: string;
    caption: string;
    published_at: string;
    transcript?: string | null;
  };
  candidates: AiJudgeCandidate[];
}

export interface AiJudgeResult extends AiVerdict {
  videoTopic?: string;
  taskTopic?: string;
  error?: string;
}

export interface VideoMatchMappedItem {
  platform: MatchPlatform;
  postId: string;
  url: string;
  caption: string;
  publishedAt: Date;
  task: {
    id: string;
    title: string;
    assigneeName: string | null;
    teamName: string | null;
    contentLineName: string | null;
  };
  score: number;
  matchedBy: Record<string, unknown>;
  alreadyLinked: boolean;
}

export interface VideoMatchRunResult {
  considered: number;
  matched: number;
  alreadyLinked: number;
  unmatched: number;
  ambiguous: number;
  mappedItems: VideoMatchMappedItem[];
  existingMappedItems: VideoMatchMappedItem[];
  /** Có khi lớp AI được bật (auto_assign_settings.video_match_ai_enabled) và có ca cần hỏi. */
  ai?: AiPassStats;
}

export interface AiPassStats {
  mode: string;
  /** Ca gửi AI lượt này (không tính ca dùng lại phán quyết cũ). */
  asked: number;
  cached: number;
  /** AI chọn được task đủ tự tin (suggest: chỉ lưu audit; apply: đã gắn hoặc bị chặn vì task đã có link). */
  confident: number;
  attached: number;
  failed: number;
}

export interface VideoMatchRunOptions {
  sinceDays?: number;
  maxVideos?: number;
  dateFrom?: string;
  dateTo?: string;
  teamIds?: string[];
  assigneeId?: string;
  contentLineId?: string;
  productLineId?: string;
  taskType?: "auto" | "extra" | "manual";
  status?: string;
  search?: string;
  searchTarget?: "task" | "video";
}

export interface VideoMatchUser {
  id: string;
  roles: UserRole[];
}

interface VideoMatchOutcome {
  status: "MATCHED" | "UNMATCHED" | "SKIPPED_AMBIGUOUS";
  mappedItem?: VideoMatchMappedItem;
}

@Injectable()
export class TaskVideoMatchAiClient {
  private readonly logger = new Logger(TaskVideoMatchAiClient.name);

  readonly minConfidence = AI_DEFAULT_MIN_CONFIDENCE;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async getMode(): Promise<AiMatchMode> {
    const setting = await this.prisma.autoAssignSetting
      .findUnique({ where: { id: 1 }, select: { video_match_ai_enabled: true } })
      .catch(() => null);
    return setting?.video_match_ai_enabled ? "apply" : "off";
  }

  async judge(
    cases: AiJudgeCase[],
  ): Promise<{ model: string | null; results: Map<string, AiJudgeResult> }> {
    const results = new Map<string, AiJudgeResult>();
    const baseUrl = this.config.get<string>("AI_SERVICE_URL", "http://localhost:8000");
    let usedModel: string | null = null;

    for (let i = 0; i < cases.length; i += AI_CHUNK_SIZE) {
      const chunk = cases.slice(i, i + AI_CHUNK_SIZE);
      try {
        const { data } = await firstValueFrom(
          this.http.post(
            `${baseUrl}/api/task-auto/video-match/judge/`,
            { cases: chunk },
            { timeout: 180_000 },
          ),
        );
        usedModel = data?.model ?? usedModel;
        for (const row of data?.results ?? []) {
          if (!row?.case_id) continue;
          results.set(row.case_id, {
            taskId: row.error ? null : (row.task_id ?? null),
            confidence: Number(row.confidence) || 0,
            reason: row.reason,
            videoTopic: row.video_topic || undefined,
            taskTopic: row.task_topic || undefined,
            ...(row.error ? { error: String(row.error) } : {}),
          });
        }
      } catch (err: any) {
        const message = err?.response?.data?.error || err?.message || "unknown";
        this.logger.warn(`[VIDEO-MATCH][AI] AI service lỗi: ${message}`);
        for (const c of cases.slice(i)) {
          if (!results.has(c.case_id)) {
            results.set(c.case_id, { taskId: null, confidence: 0, error: String(message) });
          }
        }
        break;
      }
    }
    return { model: usedModel, results };
  }
}

/**
 * Job hằng ngày: khớp video kênh nội bộ (chỉ FB owned pages, đã bỏ IG) với task rồi TỰ
 * gắn link vào `Task.published_links` (cron `refreshMonthlyPublishedLinkStats` 08:15 làm mới
 * traffic sau). Team của video suy theo: (1) page_id/username → huyk_channels (name/handle) →
 * team; (2) `#K<code>` trong caption → team. Mọi quyết định (kể cả KHÔNG gắn) ghi vào
 * `task_video_matches` để không xét lại và để audit.
 */
@Injectable()
export class TaskVideoMatchService {
  private readonly logger = new Logger(TaskVideoMatchService.name);
  private activeRun: Promise<VideoMatchRunResult> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly linkStats: TaskPublishedLinkStatsService,
    @Optional() private readonly aiJudge?: TaskVideoMatchAiClient,
  ) {}

  /**
   * Lượt bấm tay luôn bị thu hẹp lại ở server, không tin phạm vi do trình duyệt gửi lên:
   * - ADMIN/MANAGER: đúng bộ lọc đang chọn;
   * - LEADER: chỉ các team mình là leader;
   * - MEMBER: chỉ task/kênh của chính mình, trong các team mình tham gia.
   */
  async runManualMatch(
    opts: VideoMatchRunOptions,
    user?: VideoMatchUser,
  ): Promise<VideoMatchRunResult> {
    if (!user?.id || !Array.isArray(user.roles)) {
      throw new ForbiddenException("Không xác định được tài khoản chạy map");
    }

    opts = { ...opts, maxVideos: opts.maxVideos ?? MANUAL_MAX_VIDEOS };
    if (
      user.roles.includes(UserRole.ADMIN) ||
      user.roles.includes(UserRole.MANAGER)
    ) {
      return this.runDailyMatch(opts);
    }

    if (user.roles.includes(UserRole.LEADER)) {
      const ledTeamIds = (
        await this.prisma.team.findMany({
          where: { leader_id: user.id },
          select: { id: true },
        })
      ).map((team) => team.id);
      return this.runDailyMatch({
        ...opts,
        teamIds: restrictTeamIds(opts.teamIds, ledTeamIds),
      });
    }

    const memberTeamIds = (
      await this.prisma.teamMember.findMany({
        where: { user_id: user.id },
        select: { team_id: true },
      })
    ).map((membership) => membership.team_id);
    return this.runDailyMatch({
      ...opts,
      teamIds: restrictTeamIds(opts.teamIds, memberTeamIds),
      // Thành viên không được gửi assignee_id của người khác để mở rộng phạm vi.
      assigneeId: user.id,
    });
  }

  async runDailyMatch(
    opts: VideoMatchRunOptions = {},
  ): Promise<VideoMatchRunResult> {
    // Cron và nút chạy tay dùng chung service. Nếu trùng thời điểm, chờ lượt đang chạy xong rồi
    // chạy đúng bộ lọc của lượt kế tiếp; không dùng ké kết quả khác phạm vi và không ghi đè JSON.
    if (this.activeRun) {
      try {
        await this.activeRun;
      } catch {
        // Lượt trước lỗi vẫn cho lượt đang chờ tự chạy lại với scope của chính nó.
      }
      return this.runDailyMatch(opts);
    }
    const run = this.executeMatch(opts);
    this.activeRun = run;
    try {
      return await run;
    } finally {
      if (this.activeRun === run) this.activeRun = null;
    }
  }

  private async executeMatch(
    opts: VideoMatchRunOptions = {},
  ): Promise<VideoMatchRunResult> {
    const sinceDays = opts.sinceDays ?? 21;
    const maxVideos = opts.maxVideos ?? DEFAULT_MAX_VIDEOS;
    const fromRange = opts.dateFrom ? vietnamDayRangeOf(opts.dateFrom) : null;
    const toRange = opts.dateTo ? vietnamDayRangeOf(opts.dateTo) : null;
    const since = fromRange?.gte ?? new Date(Date.now() - sinceDays * DAY_MS);
    const before = toRange?.lt;
    // Chỉ MATCHED là chốt; UNMATCHED/SKIPPED_AMBIGUOUS xét lại trong RETRY_DAYS ngày (editor có
    // thể gắn sản phẩm / nhập tiêu đề sau khi duyệt, lúc đó mới đủ tín hiệu tách).
    const RETRY_DAYS = 10;
    const retryFloor = new Date(Date.now() - RETRY_DAYS * DAY_MS);

    // Chỉ map bài Facebook: map cả Instagram làm lượt bấm tay bị timeout.
    const [priorMatches, fbVideos] = await Promise.all([
      this.prisma.taskVideoMatch.findMany({
        where: {
          platform: "FACEBOOK",
          created_at: { gte: new Date(since.getTime() - 14 * DAY_MS) },
        },
        select: {
          platform: true,
          post_id: true,
          status: true,
          created_at: true,
          matched_by: true,
        },
      }),
      this.loadFacebookVideos(since, before),
    ]);
    const processed = new Set(
      priorMatches
        .filter((r) => {
          if (r.status === "MATCHED") return true;
          const version = Number((r.matched_by as any)?.matcherVersion ?? 0);
          // Rule cũ phải được chạy lại một lần, kể cả record đã quá RETRY_DAYS.
          return version === MATCHER_VERSION && r.created_at < retryFloor;
        })
        .map((r) => `${r.platform}:${r.post_id}`),
    );
    // Phán quyết AI đã có (khoá theo inputHash): video chờ xét lại hằng ngày không hỏi lại AI khi
    // video + danh sách ứng viên không đổi.
    const priorAi = new Map<string, AiAudit>();
    for (const r of priorMatches) {
      const ai = (r.matched_by as any)?.ai;
      if (ai?.inputHash) priorAi.set(`${r.platform}:${r.post_id}`, ai);
    }

    // Thứ tự ưu tiên: (0) video CHƯA TỪNG xét → (1) xét bằng rule cũ → (2) xét lại trong RETRY_DAYS, để video
    // xét lại hằng ngày không chiếm hết maxVideos. Trong mỗi nhóm vẫn cũ-trước để bản gốc nhận task trước bản đăng lại.
    const priority = new Map<string, number>();
    for (const r of priorMatches) {
      const version = Number((r.matched_by as any)?.matcherVersion ?? 0);
      priority.set(`${r.platform}:${r.post_id}`, version === MATCHER_VERSION ? 2 : 1);
    }
    const pendingVideos = fbVideos
      .filter((v) => !processed.has(`${v.platform}:${v.postId}`))
      .sort(
        (a, b) =>
          (priority.get(`${a.platform}:${a.postId}`) ?? 0) -
            (priority.get(`${b.platform}:${b.postId}`) ?? 0) ||
          a.publishedAt.getTime() - b.publishedAt.getTime(),
      );

    const tasks = await this.loadCandidateTasks(since, opts);
    // Chỉ task CHƯA có link Facebook được tranh video; task đã có link chỉ dùng để nhận ra video
    // đã gắn sẵn và để hiện lịch sử map.
    const openTasks = tasks.filter(
      (t) => !t.publishedLinks.some((l) => linkPlatformOf(l) === "FACEBOOK"),
    );
    const linkedTasks = tasks.filter((t) => t.publishedLinks.length > 0);
    const openOwners = new Set(openTasks.map((t) => t.candidate.assigneeId));
    const loadedVideos = fbVideos;
    const historyVideos =
      opts.search && opts.searchTarget === "video"
        ? loadedVideos.filter((video) =>
            unaccent(video.caption)
              .toLowerCase()
              .includes(unaccent(opts.search!).toLowerCase()),
          )
        : loadedVideos;
    const existingMappedItems = await this.loadExistingMappedItems(
      tasks,
      historyVideos,
    );
    if (!pendingVideos.length) {
      this.logger.log("[VIDEO-MATCH] Không có video mới nào cần xét");
      return {
        considered: 0,
        matched: 0,
        alreadyLinked: 0,
        unmatched: 0,
        ambiguous: 0,
        mappedItems: [],
        existingMappedItems,
      };
    }

    const [resolver, linkedPosts] = await Promise.all([
      this.buildChannelResolver(),
      // Video FB đã gắn của từng task (page + hook) — cho đường "đăng lại ở page khác".
      this.loadLinkedFacebookPosts(tasks, fbVideos),
    ]);
    const repost: RepostIndex = {
      tasksByOwner: groupByAssignee(tasks),
      posts: linkedPosts,
    };
    // Bộ lọc team/người làm phải áp ngay lên VIDEO, không chỉ task: nếu không, bài ngoài scope
    // vẫn bị xét, chiếm maxVideos và tạo audit UNMATCHED không liên quan tới lượt chạy tay này.
    const videos = pendingVideos
      .filter((video) => {
        const ctx = resolver.resolve(video);
        // Bài đăng lại của video task đã gắn ở page khác vẫn phải xét, dù chủ kênh hết task trống.
        const repostable = Boolean(findRepostTask(video, ctx, repost));
        if (!openTasks.length && !repostable) return false;
        // Chủ kênh không còn task nào chưa gắn link ⇒ không có gì để gắn, khỏi tốn lượt xét.
        if (
          ctx.channelOwnerId &&
          !openOwners.has(ctx.channelOwnerId) &&
          !repostable
        ) {
          return false;
        }
        if (
          opts.teamIds &&
          (!ctx.teamIdFromChannel || !opts.teamIds.includes(ctx.teamIdFromChannel))
        ) {
          return false;
        }
        if (
          opts.assigneeId &&
          ctx.channelOwnerId !== opts.assigneeId
        ) {
          return false;
        }
        if (
          opts.search &&
          opts.searchTarget === "video" &&
          !unaccent(video.caption).toLowerCase().includes(unaccent(opts.search).toLowerCase())
        ) {
          return false;
        }
        return true;
      })
      .slice(0, maxVideos);

    if (!videos.length) {
      this.logger.log("[VIDEO-MATCH] Không có video mới nào trong phạm vi lọc");
      return {
        considered: 0,
        matched: 0,
        alreadyLinked: 0,
        unmatched: 0,
        ambiguous: 0,
        mappedItems: [],
        existingMappedItems,
      };
    }
    // 1 task ≈ 1 video MỖI NỀN TẢNG (video đăng cả FB lẫn IG). Khoá theo `${taskId}:${platform}`
    // để không chồng 2 video auto cùng nền tảng vào cùng task trong một lượt.
    const claimedTasks = new Set<string>();
    const aiMode = (await this.aiJudge?.getMode()) ?? "off";
    // Ca heuristic bỏ trống nhưng còn ứng viên đủ mỏ neo — hỏi AI một lượt sau khi xét hết video.
    const aiQueue: AiPending[] | null = aiMode === "off" ? null : [];

    let matched = 0;
    let alreadyLinked = 0;
    let unmatched = 0;
    let ambiguous = 0;
    const mappedItems: VideoMatchMappedItem[] = [];

    for (const video of videos) {
      try {
        const outcome = await this.matchOne(
          video,
          openTasks,
          linkedTasks,
          resolver,
          claimedTasks,
          aiQueue,
          repost,
        );
        if (outcome.status === "MATCHED") {
          if (outcome.mappedItem) {
            mappedItems.push(outcome.mappedItem);
            if (outcome.mappedItem.alreadyLinked) alreadyLinked++;
            else matched++;
          }
        } else if (outcome.status === "SKIPPED_AMBIGUOUS") ambiguous++;
        else unmatched++;
      } catch (err: any) {
        unmatched++;
        this.logger.warn(
          `[VIDEO-MATCH] ${video.platform}:${video.postId} lỗi: ${err.message}`,
        );
      }
    }

    let ai: AiPassStats | undefined;
    if (aiQueue?.length) {
      try {
        const pass = await this.runAiPass(aiQueue, {
          mode: aiMode,
          tasks,
          claimedTasks,
          priorAi,
          videoIndex: buildVideoIndex(loadedVideos),
        });
        ai = pass.stats;
        mappedItems.push(...pass.mappedItems);
        for (const { from, to } of pass.transitions) {
          if (from === "SKIPPED_AMBIGUOUS") ambiguous--;
          else unmatched--;
          if (to === "MATCHED") matched++;
          else if (to === "SKIPPED_AMBIGUOUS") ambiguous++;
          else unmatched++;
        }
      } catch (err: any) {
        // Lớp AI là phần phụ: lỗi ở đây không được làm hỏng kết quả heuristic đã ghi.
        this.logger.warn(`[VIDEO-MATCH][AI] Bỏ qua lớp AI: ${err.message}`);
      }
    }

    this.logger.log(
      `[VIDEO-MATCH] Xong: xét ${videos.length}, gắn mới ${matched}, đã có link ${alreadyLinked}, nhập nhằng ${ambiguous}, bỏ ${unmatched}` +
        (ai
          ? ` | AI(${ai.mode}): hỏi ${ai.asked}, dùng lại ${ai.cached}, tự tin ${ai.confident}, gắn ${ai.attached}, lỗi ${ai.failed}`
          : ""),
    );
    return {
      considered: videos.length,
      matched,
      alreadyLinked,
      unmatched,
      ambiguous,
      mappedItems,
      existingMappedItems,
      ...(ai ? { ai } : {}),
    };
  }

  /** Lịch sử khớp của 1 task (audit). */
  async listMatchesForTask(taskId: string) {
    return this.prisma.taskVideoMatch.findMany({
      where: { task_id: taskId },
      orderBy: { created_at: "desc" },
    });
  }

  // ─── Match 1 video ────────────────────────────────────────────────────────

  private async matchOne(
    video: CandidateVideo,
    tasks: LoadedTask[],
    linkedTasks: LoadedTask[],
    resolver: ChannelResolver,
    claimedTasks: Set<string>,
    aiQueue: AiPending[] | null = null,
    repost: RepostIndex | null = null,
  ): Promise<VideoMatchOutcome> {
    // Task nào đã chứa sẵn link này (editor nhập tay / app đăng bài tự thêm)?
    const already = linkedTasks.find((t) => taskAlreadyHasVideo(t, video));
    if (already) {
      await this.recordMatch(
        video,
        already.id,
        0,
        { source: "already-linked" },
        "MATCHED",
      );
      return {
        status: "MATCHED",
        mappedItem: this.toMappedItem(
          video,
          already,
          0,
          { source: "already-linked" },
          true,
        ),
      };
    }

    // Cùng video chủ kênh đăng lại ở page khác của mình ⇒ theo task đã nhận bản ở page kia. Xét
    // trước chấm điểm để bản đăng lại không bị gắn nhầm sang task khác trùng tiêu đề.
    const repostHit = repost
      ? findRepostTask(video, resolver.resolve(video), repost)
      : null;
    if (repostHit) {
      const matchedBy = {
        source: "repost-other-page",
        fromPage: repostHit.fromPage,
        channelOwner: repostHit.task.candidate.assigneeId,
      };
      claimedTasks.add(`${repostHit.task.id}:${video.platform}`);
      await this.attachLink(repostHit.task.id, video, "auto-match-repost");
      rememberLinkedPost(repost!, repostHit.task.id, video);
      await this.recordMatch(video, repostHit.task.id, 0, matchedBy, "MATCHED");
      return {
        status: "MATCHED",
        mappedItem: this.toMappedItem(video, repostHit.task, 0, matchedBy, false),
      };
    }

    const { candidates, winner } = this.decide(video, tasks, resolver, linkedTasks);
    const status = statusFromReason(winner.reason);

    if (winner.taskId) {
      const loaded = tasks.find((t) => t.id === winner.taskId);
      const claimKey = `${winner.taskId}:${video.platform}`;
      // Chỉ chặn khi task đã có link CÙNG NỀN TẢNG (lượt trước / nhập tay) hoặc vừa nhận 1 video
      // auto cùng nền tảng trong lượt này — link nền tảng khác vẫn cho gắn.
      const samePlatformLinkExists =
        loaded?.publishedLinks.some(
          (l) => linkPlatformOf(l) === video.platform,
        ) ?? false;
      if (claimedTasks.has(claimKey) || samePlatformLinkExists) {
        await this.recordMatch(
          video,
          null,
          winner.score,
          {
            reason: "TASK_ALREADY_HAS_PLATFORM_VIDEO",
            candidateTaskId: winner.taskId,
            platform: video.platform,
          },
          "SKIPPED_AMBIGUOUS",
        );
        return { status: "SKIPPED_AMBIGUOUS" };
      }

      claimedTasks.add(claimKey);
      await this.attachLink(winner.taskId, video);
      if (repost) rememberLinkedPost(repost, winner.taskId, video);
      await this.recordMatch(
        video,
        winner.taskId,
        winner.score,
        winner.matchedBy,
        "MATCHED",
      );
      return {
        status: "MATCHED",
        mappedItem: loaded
          ? this.toMappedItem(
              video,
              loaded,
              winner.score,
              winner.matchedBy,
              false,
            )
          : undefined,
      };
    }

    const audit = {
      reason: winner.reason,
      topScore: winner.score,
      candidateTaskId: winner.candidateTaskId,
      candidateSignals: winner.matchedBy,
    };
    await this.recordMatch(video, null, winner.score, audit, status);
    if (aiQueue) {
      const shortlist = aiShortlist(candidates, undefined, video.caption);
      if (shortlist.length) {
        aiQueue.push({ video, shortlist, status, score: winner.score, audit });
      }
    }
    return { status: status as VideoMatchOutcome["status"] };
  }

  /** Chấm + chọn thuần (không ghi DB) — dùng chung cho lượt thật và script đo trên đáp án. */
  private decide(
    video: CandidateVideo,
    tasks: LoadedTask[],
    resolver: ChannelResolver,
    linkedTasks: LoadedTask[] = [],
  ): { candidates: ScoredCandidate[]; winner: PickResult } {
    const ctx = resolver.resolve(video);
    // Cửa sổ mở rộng ±10 ngày; ứng viên ngoài ±5 chỉ được gắn khi khớp trọn tiêu đề dài (pickWinner).
    const inWindow = tasks.filter((t) => isWithinFarWindow(video, t.candidate));
    // Biết chủ kênh thì chỉ task của người đó được tranh (enforceChannelOwnerGuard) — lọc TRƯỚC khi
    // chấm cho nhanh, kết quả y hệt.
    const pool = ctx.channelOwnerId
      ? inWindow.filter((t) => t.candidate.assigneeId === ctx.channelOwnerId)
      : inWindow;
    const scored = pool.map((t) => ({
      task: t.candidate,
      ...scoreCandidate(video, t.candidate, ctx),
    }));
    const ownerGuard = enforceChannelOwnerGuard(scored, ctx);
    const winner = pickWinner(ownerGuard.candidates, {
      skuTakenElsewhere: skuHeldByFacebookLinkedTask(video, linkedTasks, ctx),
    });
    if (ownerGuard.applied) {
      winner.matchedBy = {
        ...winner.matchedBy,
        channelOwnerGuard: {
          candidatesBefore: inWindow.length,
          candidatesAfter: ownerGuard.candidates.length,
        },
      };
    }
    return { candidates: ownerGuard.candidates, winner };
  }

  // ─── Lớp AI ──────────────────────────────────────────────────────────────

  /**
   * Hỏi AI các ca heuristic bỏ trống. AI chỉ được chọn trong danh sách đã qua mỏ neo cứng; BE
   * kiểm lại (thuộc danh sách + đủ tự tin + task chưa có link cùng nền tảng). suggest: chỉ lưu
   * phán quyết vào `matched_by.ai`; apply: gắn link `source: "auto-match-ai"`.
   */
  private async runAiPass(
    queue: AiPending[],
    run: {
      mode: string;
      tasks: LoadedTask[];
      claimedTasks: Set<string>;
      priorAi: Map<string, AiAudit>;
      videoIndex: Map<string, CandidateVideo>;
    },
  ): Promise<{
    stats: AiPassStats;
    mappedItems: VideoMatchMappedItem[];
    transitions: { from: string; to: string }[];
  }> {
    const stats: AiPassStats = {
      mode: run.mode,
      asked: 0,
      cached: 0,
      confident: 0,
      attached: 0,
      failed: 0,
    };
    const mappedItems: VideoMatchMappedItem[] = [];
    const transitions: { from: string; to: string }[] = [];
    if (!this.aiJudge) return { stats, mappedItems, transitions };

    if (queue.length > MAX_AI_CASES_PER_RUN) {
      // Ca chưa hỏi giữ bản ghi heuristic (không có `ai`) ⇒ lượt sau hỏi.
      queue = queue.slice(0, MAX_AI_CASES_PER_RUN);
    }
    const taskById = new Map(run.tasks.map((t) => [t.id, t]));
    const transcripts = await this.loadTranscripts(queue.map((p) => p.video));
    const built = queue.map((pending) => ({
      pending,
      ...this.buildAiCase(pending, taskById, run.videoIndex, transcripts),
    }));

    const verdicts = new Map<string, AiAudit>();
    const toAsk: AiJudgeCase[] = [];
    const hashByKey = new Map<string, string>();
    for (const b of built) {
      const prior = run.priorAi.get(b.payload.case_id);
      if (prior?.inputHash === b.inputHash) {
        verdicts.set(b.payload.case_id, prior);
        stats.cached++;
      } else {
        toAsk.push(b.payload);
        hashByKey.set(b.payload.case_id, b.inputHash);
      }
    }
    if (toAsk.length) {
      stats.asked = toAsk.length;
      const { model, results } = await this.aiJudge.judge(toAsk);
      for (const c of toAsk) {
        const r = results.get(c.case_id);
        if (!r || r.error) {
          stats.failed++;
          continue;
        }
        verdicts.set(c.case_id, {
          taskId: r.taskId,
          confidence: r.confidence,
          reason: r.reason,
          videoTopic: r.videoTopic,
          taskTopic: r.taskTopic,
          model,
          inputHash: hashByKey.get(c.case_id)!,
          promptVersion: AI_PROMPT_VERSION,
          judgedAt: new Date().toISOString(),
        });
      }
    }

    const minConfidence = this.aiJudge.minConfidence;
    for (const { pending, payload } of built) {
      const verdict = verdicts.get(payload.case_id);
      // AI lỗi: giữ nguyên bản ghi heuristic (không có `ai`) ⇒ lượt sau hỏi lại.
      if (!verdict) continue;
      const { video } = pending;
      const { taskId: accepted, rejected } = acceptAiVerdict(
        verdict,
        pending.shortlist.map((c) => ({
          ...c.task,
          occupied:
            run.claimedTasks.has(`${c.task.id}:${video.platform}`) ||
            (taskById
              .get(c.task.id)
              ?.publishedLinks.some((l) => linkPlatformOf(l) === video.platform) ??
              false),
        })),
        minConfidence,
        video.caption,
      );
      const ai = {
        ...verdict,
        accepted: Boolean(accepted),
        ...(rejected && rejected !== "NO_PICK" ? { rejected } : {}),
        mode: run.mode,
      };
      if (accepted) stats.confident++;

      if (run.mode !== "apply" || !accepted) {
        await this.recordMatch(
          video,
          null,
          pending.score,
          { ...pending.audit, ai },
          pending.status,
        );
        continue;
      }

      const loaded = taskById.get(accepted);
      const claimKey = `${accepted}:${video.platform}`;
      const occupied =
        run.claimedTasks.has(claimKey) ||
        (loaded?.publishedLinks.some(
          (l) => linkPlatformOf(l) === video.platform,
        ) ??
          false);
      if (occupied) {
        await this.recordMatch(
          video,
          null,
          pending.score,
          {
            reason: "TASK_ALREADY_HAS_PLATFORM_VIDEO",
            candidateTaskId: accepted,
            platform: video.platform,
            heuristic: pending.audit,
            ai,
          },
          "SKIPPED_AMBIGUOUS",
        );
        if (pending.status !== "SKIPPED_AMBIGUOUS") {
          transitions.push({ from: pending.status, to: "SKIPPED_AMBIGUOUS" });
        }
        continue;
      }

      run.claimedTasks.add(claimKey);
      await this.attachLink(accepted, video, "auto-match-ai");
      const matchedBy = { source: "ai", heuristic: pending.audit, ai };
      await this.recordMatch(video, accepted, pending.score, matchedBy, "MATCHED");
      stats.attached++;
      transitions.push({ from: pending.status, to: "MATCHED" });
      if (loaded) {
        mappedItems.push(
          this.toMappedItem(video, loaded, pending.score, matchedBy, false),
        );
      }
    }
    return { stats, mappedItems, transitions };
  }

  private buildAiCase(
    pending: Pick<AiPending, "video" | "shortlist">,
    taskById: Map<string, LoadedTask>,
    videoIndex: Map<string, CandidateVideo>,
    transcripts: Map<string, string>,
  ): { payload: AiJudgeCase; inputHash: string } {
    const { video } = pending;
    const candidates = pending.shortlist.map(({ task }) => {
      const anchor = taskAnchor(task);
      const loaded = taskById.get(task.id);
      const sameplatform = (loaded?.publishedLinks ?? []).filter(
        (l) => linkPlatformOf(l) === video.platform,
      );
      return {
        task_id: task.id,
        title: task.contentTitle,
        script: (task.scriptContent || "").slice(0, 600),
        product_names: (task.productNames ?? []).filter(Boolean),
        product_skus: task.productSkus,
        anchor_at: anchor ? anchor.toISOString() : null,
        days_from_video: anchor
          ? Math.round(
              ((anchor.getTime() - video.publishedAt.getTime()) / DAY_MS) * 10,
            ) / 10
          : null,
        has_platform_link: sameplatform.length > 0,
        linked_videos_same_platform: sameplatform.map((l) => {
          const linked = videoIndex.get(videoTokenOfLink(l, video.platform) ?? "");
          return linked ? captionHook(linked.caption) : null;
        }),
      };
    });
    const payload: AiJudgeCase = {
      case_id: `${video.platform}:${video.postId}`,
      video: {
        platform: video.platform,
        caption: video.caption,
        published_at: video.publishedAt.toISOString(),
        transcript: transcripts.get(`${video.platform}:${video.postId}`) ?? null,
      },
      candidates,
    };
    const inputHash = createHash("sha1")
      .update(JSON.stringify({ v: AI_PROMPT_VERSION, payload }))
      .digest("hex");
    return { payload, inputHash };
  }

  /** Phụ đề FB đã cào (owned_video_scripts, nguồn 'phu_de') — lời thoại giúp AI hiểu chủ đề. */
  private async loadTranscripts(
    videos: CandidateVideo[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const fb = videos.filter((v) => v.platform === "FACEBOOK").map((v) => v.postId);
    if (!fb.length) return out;
    const rows = await this.prisma.ownedVideoScript.findMany({
      where: { platform: "facebook", nguon: "phu_de", post_id: { in: fb } },
      select: { post_id: true, noi_dung: true },
    });
    for (const r of rows) out.set(`FACEBOOK:${r.post_id}`, r.noi_dung);
    return out;
  }

  private toMappedItem(
    video: CandidateVideo,
    task: LoadedTask,
    score: number,
    matchedBy: Record<string, unknown>,
    alreadyLinked: boolean,
  ): VideoMatchMappedItem {
    return {
      platform: video.platform,
      postId: video.postId,
      url: video.url,
      caption: video.caption.slice(0, 280),
      publishedAt: video.publishedAt,
      task: {
        id: task.id,
        title: task.candidate.contentTitle || "Task không có tiêu đề",
        assigneeName: task.assigneeName,
        teamName: task.teamName,
        contentLineName: task.candidate.contentLineName,
      },
      score,
      matchedBy,
      alreadyLinked,
    };
  }

  private async attachLink(
    taskId: string,
    video: CandidateVideo,
    source = "auto-match",
  ) {
    // Đọc trước chỉ để khỏi cào số liệu cho link đã có; quyết định gắn hay không nằm ở lượt ghi.
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { published_links: true },
    });
    const hasUrl = (links: PublishedLinkEntry[]) => links.some((l) => l?.url === video.url);
    if (hasUrl(asPublishedLinks(task?.published_links))) return;

    const platformLabel =
      video.platform === "FACEBOOK" ? "Facebook" : "Instagram";

    let stats: unknown;
    try {
      stats = await this.linkStats.fetchStatsForLink(platformLabel, video.url);
    } catch {
      // Bỏ qua — cron 08:15 sẽ cào lại.
    }

    const entry: PublishedLinkEntry = {
      id: randomUUID(),
      platform: platformLabel,
      url: video.url,
      source,
    };
    if (stats) entry.stats = stats;

    // Thêm vào bản MỚI NHẤT — không đè link user vừa nộp trong lúc đang cào số liệu ở trên.
    const result = await mutateTaskPublishedLinks(this.prisma, taskId, (current) =>
      hasUrl(current) ? null : [...current, entry],
    );
    if (!result) throw new Error(`Task ${taskId} không còn tồn tại`);
    if (!result.changed) return;
    this.logger.log(
      `[VIDEO-MATCH] 🔗 Gắn ${platformLabel} vào task ${taskId}: ${video.url}`,
    );
  }

  private async recordMatch(
    video: CandidateVideo,
    taskId: string | null,
    score: number,
    matchedBy: Record<string, unknown>,
    status: string,
  ) {
    const audit = { ...matchedBy, matcherVersion: MATCHER_VERSION };
    await this.prisma.taskVideoMatch.upsert({
      where: {
        platform_post_id: { platform: video.platform, post_id: video.postId },
      },
      create: {
        task_id: taskId,
        platform: video.platform,
        post_id: video.postId,
        url: video.url,
        score,
        matched_by: audit as any,
        status,
      },
      update: {
        task_id: taskId,
        url: video.url,
        score,
        matched_by: audit as any,
        status,
      },
    });
  }

  // ─── Loaders ─────────────────────────────────────────────────────────────

  private async loadFacebookVideos(
    since: Date,
    before?: Date,
  ): Promise<CandidateVideo[]> {
    const rows = await this.prisma.video_management_ownedvideocontent.findMany({
      where: {
        published_at: { gte: since, ...(before ? { lt: before } : {}) },
        permalink_url: { not: null },
      },
      select: {
        post_id: true,
        caption: true,
        published_at: true,
        permalink_url: true,
        managed_page: { select: { page_id: true } },
      },
    });
    return rows
      .filter((r) => r.permalink_url)
      .map((r) => ({
        platform: "FACEBOOK" as MatchPlatform,
        postId: r.post_id,
        url: r.permalink_url as string,
        caption: r.caption || "",
        hashtags: extractHashtags(r.caption || ""),
        publishedAt: r.published_at,
        channelKey: r.managed_page?.page_id || "",
      }));
  }

  /**
   * Video Facebook đã gắn trong từng task → { page, hook }. Tra theo id số trong URL trên video đã
   * nạp; link cũ hơn cửa sổ thì tra đúng permalink trong DB. Không tra được (link nhập tay dạng
   * share...) ⇒ page/hook null — task đó không đi đường đăng lại (không biết đã có bản ở page nào).
   */
  private async loadLinkedFacebookPosts(
    tasks: LoadedTask[],
    videos: CandidateVideo[],
  ): Promise<Map<string, FbLinkedPost[]>> {
    const byToken = new Map<string, CandidateVideo>();
    for (const v of videos) {
      const token = longDigitRun(v.url);
      if (token) byToken.set(token, v);
    }
    const fbUrls = (t: LoadedTask) =>
      t.publishedLinks
        .filter((l) => linkPlatformOf(l) === "FACEBOOK")
        .map((l) => String(l?.url || ""))
        .filter(Boolean);
    const missing = [
      ...new Set(
        tasks.flatMap(fbUrls).filter((url) => {
          const token = longDigitRun(url);
          return !(token && byToken.has(token));
        }),
      ),
    ];
    const byUrl = new Map<string, { page: string; caption: string }>();
    if (missing.length) {
      const rows = await this.prisma.video_management_ownedvideocontent.findMany({
        where: { permalink_url: { in: missing } },
        select: {
          permalink_url: true,
          caption: true,
          managed_page: { select: { page_id: true } },
        },
      });
      for (const r of rows) {
        if (r.permalink_url && r.managed_page?.page_id) {
          byUrl.set(r.permalink_url, {
            page: r.managed_page.page_id,
            caption: r.caption || "",
          });
        }
      }
    }

    const out = new Map<string, FbLinkedPost[]>();
    for (const t of tasks) {
      const urls = fbUrls(t);
      if (!urls.length) continue;
      out.set(
        t.id,
        urls.map((url) => {
          const token = longDigitRun(url);
          const v = token ? byToken.get(token) : undefined;
          const hit = v ? { page: v.channelKey, caption: v.caption } : byUrl.get(url);
          return hit?.page
            ? { page: hit.page, hook: repostHookKey(hit.caption) }
            : { page: null, hook: null };
        }),
      );
    }
    return out;
  }

  /**
   * Bảng tra kênh → { team, chủ kênh }. `huyk_channels.name`/handle là nguồn chính;
   * `#K<code>` bootstrap từ đó để phủ page không có trong huyk_channels.
   */
  private async buildChannelResolver(): Promise<ChannelResolver> {
    const [chRows, pages, recent] = await Promise.all([
      this.prisma.channel.findMany({
        // Cần kênh đã gán team (suy ra team của video) HOẶC chủ kênh (== người nhận task).
        where: { OR: [{ team_id: { not: null } }, { owner_id: { not: null } }] },
        select: {
          platform: true,
          name: true,
          channel_id: true,
          link_channel: true,
          team_id: true,
          owner_id: true,
        },
      }),
      this.prisma.video_management_managedfacebookpage.findMany({
        select: { page_id: true, name: true, username: true },
      }),
      // #K<code> → team: majority vote trên video 45 ngày gần đây (cần >= 3 phiếu, >= 80% nhất quán)
      this.prisma.video_management_ownedvideocontent.findMany({
        where: { published_at: { gte: new Date(Date.now() - 45 * DAY_MS) } },
        select: { caption: true, managed_page: { select: { page_id: true } } },
      }),
    ]);

    const byName = new Map<string, TeamRef>();
    const byHandle = new Map<string, TeamRef>();
    const ambiguousNames = new Set<string>();
    const ambiguousHandles = new Set<string>();
    // Tên/handle trùng nhưng trỏ sang chủ hoặc team khác là dữ liệu mơ hồ: bỏ hẳn key thay vì
    // phụ thuộc thứ tự query rồi chọn ngẫu nhiên một dòng.
    const put = (
      map: Map<string, TeamRef>,
      ambiguous: Set<string>,
      k: string,
      ref: TeamRef,
    ) => {
      if (ambiguous.has(k)) return;
      const prev = map.get(k);
      if (!prev) {
        map.set(k, ref);
        return;
      }
      const conflicts =
        (!!prev.teamId && !!ref.teamId && prev.teamId !== ref.teamId) ||
        (!!prev.ownerId && !!ref.ownerId && prev.ownerId !== ref.ownerId);
      if (conflicts) {
        map.delete(k);
        ambiguous.add(k);
        return;
      }
      map.set(k, {
        teamId: prev.teamId ?? ref.teamId,
        ownerId: prev.ownerId ?? ref.ownerId,
      });
    };
    for (const c of chRows) {
      const ref: TeamRef = {
        teamId: c.team_id ?? null,
        ownerId: c.owner_id ?? null,
      };
      if (c.name) put(byName, ambiguousNames, normName(c.name), ref);
      const handles = [
        normName(c.channel_id),
        handleFromLink(c.link_channel),
      ].filter((h): h is string => !!h);
      for (const h of handles) put(byHandle, ambiguousHandles, h, ref);
    }

    // page_id / username cụ thể phải được ưu tiên trước tên. Nếu tên trùng nhiều team thì util
    // trả về không khớp, để resolver dùng #K-code thay vì chọn ngẫu nhiên một dòng DB.
    const pageTeam = buildPageChannelMap(pages, chRows);

    const votes = new Map<string, Map<string, number>>();
    for (const v of recent) {
      const kc = extractKCode(v.caption || "");
      const ref = v.managed_page?.page_id
        ? pageTeam.get(v.managed_page.page_id)
        : undefined;
      // Kênh chỉ có owner (chưa gán team) không bỏ phiếu được.
      if (!kc || !ref || !ref.teamId) continue;
      const m = votes.get(kc) ?? new Map<string, number>();
      m.set(ref.teamId, (m.get(ref.teamId) ?? 0) + 1);
      votes.set(kc, m);
    }
    const kcodeTeam = new Map<string, string>();
    for (const [kc, m] of votes) {
      let bestTeam = "";
      let best = 0;
      let total = 0;
      for (const [team, n] of m) {
        total += n;
        if (n > best) {
          best = n;
          bestTeam = team;
        }
      }
      if (total >= 3 && best / total >= 0.8) kcodeTeam.set(kc, bestTeam);
    }

    const withOwner = chRows.filter((c) => c.owner_id).length;
    this.logger.log(
      `[VIDEO-MATCH] resolver: ${pageTeam.size}/${pages.length} page→team, ` +
        `${kcodeTeam.size} #K-code→team, ${withOwner}/${chRows.length} kênh có chủ`,
    );

    return {
      resolve(video: CandidateVideo): ChannelContext {
        const key = (video.channelKey || "").toLowerCase();
        let ref: TeamRef | undefined;
        if (video.platform === "FACEBOOK") {
          ref = pageTeam.get(video.channelKey) || byHandle.get(key);
        } else {
          const nameKey = normName(video.channelNameFallback);
          ref =
            byHandle.get(key) ||
            byName.get(key) ||
            (nameKey ? byName.get(nameKey) : undefined);
        }
        const kc = extractKCode(video.caption);
        const teamFromKCode = kc ? kcodeTeam.get(kc) : undefined;
        const channelTeamConflict = Boolean(
          ref?.teamId && teamFromKCode && ref.teamId !== teamFromKCode,
        );
        return {
          // Hai nguồn bất đồng thì không dùng team làm bằng chứng. Kênh chỉ map được owner hoặc
          // thiếu team vẫn có thể dùng #K-code đã đạt majority 80% để bổ sung.
          teamIdFromChannel: channelTeamConflict
            ? null
            : (ref?.teamId ?? teamFromKCode ?? null),
          channelOwnerId: ref?.ownerId ?? null,
          channelTeamConflict,
        };
      },
    };
  }

  private async loadCandidateTasks(
    since: Date,
    opts: VideoMatchRunOptions = {},
  ): Promise<LoadedTask[]> {
    // Mốc nộp/duyệt/hạn có thể sớm hơn lúc video đăng — nới thêm 12 ngày (cửa sổ mở rộng ±10 ngày).
    const floor = new Date(since.getTime() - 12 * DAY_MS);
    const eligibleStatuses = [TaskStatus.SUBMITTED, TaskStatus.APPROVED].filter(
      (status) => !opts.status || status === opts.status,
    );
    const where: any = {
        status: { in: eligibleStatuses },
        OR: [
          { submitted_at: { gte: floor } },
          { reviewed_at: { gte: floor } },
          { deadline: { gte: floor } },
        ],
      };
    // [] là phạm vi rỗng có chủ đích (ví dụ leader chưa quản lý team nào), tuyệt đối không
    // được hiểu thành "tất cả team".
    if (opts.teamIds) where.team_id = { in: opts.teamIds };
    if (opts.assigneeId) where.assignee_id = opts.assigneeId;
    if (opts.taskType === "auto") where.task_type = "AUTO";
    else if (opts.taskType === "extra") where.task_type = "EXTRA";
    else if (opts.taskType === "manual") where.id = { in: [] };
    const lineConditions = taskLineConditions({
      content_line_id: opts.contentLineId,
      product_line_id: opts.productLineId,
    });
    if (lineConditions.length) where.AND = lineConditions;
    if (opts.search && opts.searchTarget === "task") {
      where.AND = [
        ...(where.AND ?? []),
        {
          OR: [
            { content: { title: { contains: opts.search, mode: "insensitive" } } },
            { editor_content: { title: { contains: opts.search, mode: "insensitive" } } },
            { team_content: { title: { contains: opts.search, mode: "insensitive" } } },
          ],
        },
      ];
    }

    const rows = await this.prisma.task.findMany({
      where,
      select: {
        id: true,
        team_id: true,
        assignee_id: true,
        submitted_at: true,
        reviewed_at: true,
        deadline: true,
        published_links: true,
        content_line: { select: { name: true } },
        video_script: { select: { hashtags: true, content: true } },
        content: { select: { title: true, script: true, body: true } },
        editor_content: { select: { title: true, script: true, body: true } },
        team_content: { select: { title: true, script: true, body: true } },
        product: { select: { sku: true, name: true } },
        editor_product: { select: { sku: true, name: true } },
        team_product: { select: { sku: true, name: true } },
        assignee: { select: { full_name: true } },
        team: { select: { name: true } },
      },
    });

    return rows.map((r) => {
      const scriptText =
        firstNonEmpty(
          r.video_script?.content,
          r.content?.script,
          r.content?.body,
          r.editor_content?.script,
          r.editor_content?.body,
          r.team_content?.script,
          r.team_content?.body,
        ) ?? "";

      const scriptHashtags = [
        ...new Set([
          ...(r.video_script?.hashtags ?? []).map(normalizeHashtag),
          ...extractHashtags(scriptText),
        ]),
      ].filter(Boolean);

      const productSkus = [
        r.editor_product?.sku,
        r.team_product?.sku,
        r.product?.sku,
      ]
        .filter((s): s is string => !!s)
        .map((s) => s.trim().toLowerCase());

      return {
        id: r.id,
        assigneeName: r.assignee?.full_name ?? null,
        teamName: r.team?.name ?? null,
        publishedLinks: Array.isArray(r.published_links)
          ? (r.published_links as any[])
          : [],
        candidate: {
          id: r.id,
          teamId: r.team_id,
          assigneeId: r.assignee_id,
          contentLineName: r.content_line?.name ?? null,
          scriptHashtags,
          scriptContent: scriptText,
          contentTitle:
            r.editor_content?.title ||
            r.team_content?.title ||
            r.content?.title ||
            "",
          productSkus,
          productNames: [
            ...new Set(
              [r.editor_product?.name, r.team_product?.name, r.product?.name]
                .map((name) => name?.trim())
                .filter((name): name is string => !!name),
            ),
          ],
          submittedAt: r.submitted_at,
          reviewedAt: r.reviewed_at,
          deadline: r.deadline,
        } satisfies CandidateTask,
      };
    });
  }

  /** Các link auto-map trước đó vẫn còn thực sự nằm trong task, cùng đúng phạm vi lọc hiện tại. */
  private async loadExistingMappedItems(
    tasks: LoadedTask[],
    videos: CandidateVideo[],
  ): Promise<VideoMatchMappedItem[]> {
    if (!tasks.length || !videos.length) return [];
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const videoByKey = new Map(
      videos.map((video) => [`${video.platform}:${video.postId}`, video]),
    );
    const rows = await this.prisma.taskVideoMatch.findMany({
      where: {
        status: "MATCHED",
        task_id: { in: [...taskById.keys()] },
      },
      select: {
        task_id: true,
        platform: true,
        post_id: true,
        score: true,
        matched_by: true,
      },
      orderBy: { created_at: "desc" },
      take: 500,
    });

    return rows.flatMap((row) => {
      const task = row.task_id ? taskById.get(row.task_id) : undefined;
      const video = videoByKey.get(`${row.platform}:${row.post_id}`);
      const matchedBy = (row.matched_by as Record<string, unknown> | null) ?? {};
      if (
        !task ||
        !video ||
        matchedBy.source === "already-linked" ||
        !taskAlreadyHasVideo(task, video)
      ) {
        return [];
      }
      return [this.toMappedItem(video, task, row.score, matchedBy, true)];
    });
  }
}

interface LoadedTask {
  id: string;
  assigneeName: string | null;
  teamName: string | null;
  publishedLinks: any[];
  candidate: CandidateTask;
}

interface TeamRef {
  teamId: string | null;
  ownerId: string | null;
}

/** Video Facebook đã gắn vào task: page + hook caption (null = không tra ra video gốc). */
interface FbLinkedPost {
  page: string | null;
  hook: string | null;
}

/** Trạng thái đường "đăng lại ở page khác" trong 1 lượt — `posts` cập nhật ngay khi gắn thêm link. */
interface RepostIndex {
  tasksByOwner: Map<string, LoadedTask[]>;
  posts: Map<string, FbLinkedPost[]>;
}

type ScoredCandidate = {
  task: CandidateTask;
  score: number;
  matchedBy: Record<string, unknown>;
};

/** Ca heuristic bỏ trống, chờ hỏi AI. `status`/`score`/`audit` = bản ghi heuristic đã lưu. */
interface AiPending {
  video: CandidateVideo;
  shortlist: ScoredCandidate[];
  status: string;
  score: number;
  audit: Record<string, unknown>;
}

/** Phán quyết AI lưu trong `task_video_matches.matched_by.ai` (kiêm cache theo inputHash). */
interface AiAudit {
  taskId: string | null;
  confidence: number;
  reason?: string;
  videoTopic?: string;
  taskTopic?: string;
  model: string | null;
  inputHash: string;
  promptVersion: number;
  judgedAt: string;
}

interface ChannelResolver {
  resolve(video: CandidateVideo): ChannelContext;
}

function restrictTeamIds(
  requested: string[] | undefined,
  allowed: string[],
): string[] {
  const uniqueAllowed = [...new Set(allowed)];
  if (!requested) return uniqueAllowed;
  const allowedSet = new Set(uniqueAllowed);
  return [...new Set(requested)].filter((teamId) => allowedSet.has(teamId));
}

const normName = (s: string | null | undefined): string =>
  (s || "").trim().toLowerCase();

/** Bóc handle/username hoặc numeric profile id từ link_channel của huyk_channels. */
function handleFromLink(link: string | null | undefined): string | null {
  const l = (link || "").toLowerCase();
  if (!l) return null;
  const path = l.match(/(?:facebook|instagram)\.com\/([a-z0-9._-]+)/i);
  if (
    path &&
    path[1] &&
    !["profile.php", "share", "reel", "reels", "p", "tv"].includes(path[1])
  ) {
    return path[1].replace(/\/.*$/, "");
  }
  const numeric = l.match(/[?&]id=(\d+)/);
  if (numeric) return numeric[1];
  return null;
}

function firstNonEmpty(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals)
    if (typeof v === "string" && v.trim().length >= 40) return v;
  return null;
}

/**
 * Nền tảng của 1 entry trong `published_links`: ưu tiên field `platform` (auto-match ghi
 * "Facebook"/"Instagram", nhập tay là text tự do), fallback dò theo domain của URL.
 */
function linkPlatformOf(entry: any): MatchPlatform | null {
  const p = String(entry?.platform || "")
    .trim()
    .toUpperCase();
  if (p.includes("FACEBOOK") || p === "FB") return "FACEBOOK";
  if (p.includes("INSTAGRAM") || p === "IG") return "INSTAGRAM";
  const url = String(entry?.url || "").toLowerCase();
  if (/(?:^|\/\/|\.)(facebook\.com|fb\.watch|fb\.com)/.test(url)) return "FACEBOOK";
  if (url.includes("instagram.com")) return "INSTAGRAM";
  return null;
}

/**
 * #SKU của video còn khớp task ĐÃ có link Facebook (đã bị loại khỏi danh sách tranh) của cùng chủ
 * kênh trong cửa sổ ⇒ mã không còn trỏ về đúng một task, không cho đi đường #SKU.
 */
function skuHeldByFacebookLinkedTask(
  video: CandidateVideo,
  linkedTasks: LoadedTask[],
  ctx: ChannelContext,
): boolean {
  const skus = extractSkuTags(video.caption);
  if (!skus.length) return false;
  return linkedTasks.some(
    (t) =>
      (!ctx.channelOwnerId || t.candidate.assigneeId === ctx.channelOwnerId) &&
      skuMatches(skus, t.candidate.productSkus).length > 0 &&
      isWithinFarWindow(video, t.candidate) &&
      t.publishedLinks.some((l) => linkPlatformOf(l) === "FACEBOOK"),
  );
}

/** Task đã có link trỏ tới đúng video này chưa (URL trùng, hoặc chứa shortcode/id). */
function taskAlreadyHasVideo(task: LoadedTask, video: CandidateVideo): boolean {
  const idToken =
    video.platform === "INSTAGRAM"
      ? shortcodeFromUrl(video.url)
      : longDigitRun(video.url);
  return task.publishedLinks.some((l) => {
    const url: string = (l?.url || "").toLowerCase();
    if (!url) return false;
    if (url === video.url.toLowerCase()) return true;
    if (idToken && url.includes(idToken.toLowerCase())) return true;
    return false;
  });
}

/** id số (FB) / shortcode (IG) → video — để kể cho AI task đã gắn video nào. */
function buildVideoIndex(videos: CandidateVideo[]): Map<string, CandidateVideo> {
  const index = new Map<string, CandidateVideo>();
  for (const video of videos) {
    const token =
      video.platform === "INSTAGRAM"
        ? shortcodeFromUrl(video.url)
        : longDigitRun(video.url);
    if (token) index.set(`${video.platform}:${token.toLowerCase()}`, video);
  }
  return index;
}

function videoTokenOfLink(entry: any, platform: MatchPlatform): string | null {
  const url = String(entry?.url || "");
  const token =
    platform === "INSTAGRAM" ? shortcodeFromUrl(url) : longDigitRun(url);
  return token ? `${platform}:${token.toLowerCase()}` : null;
}

function shortcodeFromUrl(url: string): string | null {
  const m = url.match(/\/(?:reel|reels|p|tv)\/([^/?#]+)/i);
  return m ? m[1] : null;
}

/** Hook ngắn hơn ngần này ký tự (sau chuẩn hoá) quá chung để coi là "cùng một video". */
const REPOST_HOOK_MIN_LENGTH = 12;

/**
 * Khoá so "cùng một video" giữa 2 page: hook caption (phần trước dấu # đầu tiên), bỏ dấu tiếng Việt,
 * gộp ký tự không phải chữ/số thành 1 khoảng trắng — giữ chữ Thái/Nhật cho page nước ngoài.
 */
function repostHookKey(caption: string): string | null {
  const key = unaccent(captionHook(caption))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
  return key.length >= REPOST_HOOK_MIN_LENGTH ? key : null;
}

/**
 * Một người có thể cầm nhiều page và đăng cùng một video lên từng page. Video là bản đăng lại khi:
 * - biết chủ kênh (2 page chắc chắn cùng một người);
 * - hook caption trùng video đã gắn của ĐÚNG MỘT task của chủ kênh, video đó ở page KHÁC;
 * - task chưa có video nào của page này, và mọi link FB của task đều tra ra page;
 * - video trong cửa sổ ±10 ngày của task.
 * Nhiều task cùng hook ⇒ không đoán, để đường chấm điểm thường xử lý.
 */
function findRepostTask(
  video: CandidateVideo,
  ctx: ChannelContext,
  repost: RepostIndex,
): { task: LoadedTask; fromPage: string } | null {
  if (video.platform !== "FACEBOOK" || !ctx.channelOwnerId || !video.channelKey) {
    return null;
  }
  const hook = repostHookKey(video.caption);
  if (!hook) return null;
  const hits: { task: LoadedTask; fromPage: string }[] = [];
  for (const task of repost.tasksByOwner.get(ctx.channelOwnerId) ?? []) {
    const posts = repost.posts.get(task.id);
    if (!posts?.length) continue;
    if (posts.some((p) => !p.page || p.page === video.channelKey)) continue;
    const source = posts.find((p) => p.hook === hook);
    if (source?.page && isWithinFarWindow(video, task.candidate)) {
      hits.push({ task, fromPage: source.page });
    }
  }
  return hits.length === 1 ? hits[0] : null;
}

/** Ghi nhận link FB vừa gắn trong lượt — bản đăng lại xét sau trong cùng lượt tìm được task. */
function rememberLinkedPost(
  repost: RepostIndex,
  taskId: string,
  video: CandidateVideo,
): void {
  if (video.platform !== "FACEBOOK") return;
  const posts = repost.posts.get(taskId) ?? [];
  posts.push({ page: video.channelKey || null, hook: repostHookKey(video.caption) });
  repost.posts.set(taskId, posts);
}

function groupByAssignee(tasks: LoadedTask[]): Map<string, LoadedTask[]> {
  const out = new Map<string, LoadedTask[]>();
  for (const task of tasks) {
    const owner = task.candidate.assigneeId;
    if (!owner) continue;
    const list = out.get(owner);
    if (list) list.push(task);
    else out.set(owner, [task]);
  }
  return out;
}
