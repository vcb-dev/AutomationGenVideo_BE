import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { TaskStatus } from "@prisma/client";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { TaskPublishedLinkStatsService } from "./task-published-link-stats.service";
import { extractHashtags } from "../../instagram-owned-accounts/instagram-owned-accounts.service";
import {
  CandidateTask,
  CandidateVideo,
  ChannelContext,
  DAY_MS,
  MatchPlatform,
  extractKCode,
  isWithinWindow,
  normalizeHashtag,
  pickWinner,
  scoreCandidate,
  statusFromReason,
} from "./task-video-match.util";

/**
 * Job hằng ngày: khớp video kênh nội bộ (FB owned pages + IG owned accounts) với task rồi TỰ
 * gắn link vào `Task.published_links` (cron `refreshMonthlyPublishedLinkStats` 08:15 làm mới
 * traffic sau). Team của video suy theo: (1) page_id/username → huyk_channels (name/handle) →
 * team; (2) `#K<code>` trong caption → team. Mọi quyết định (kể cả KHÔNG gắn) ghi vào
 * `task_video_matches` để không xét lại và để audit.
 */
@Injectable()
export class TaskVideoMatchService {
  private readonly logger = new Logger(TaskVideoMatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly linkStats: TaskPublishedLinkStatsService,
  ) {}

  async runDailyMatch(opts: { sinceDays?: number; maxVideos?: number } = {}) {
    const sinceDays = opts.sinceDays ?? 21;
    const maxVideos = opts.maxVideos ?? 800;
    const since = new Date(Date.now() - sinceDays * DAY_MS);
    // Chỉ MATCHED là chốt; UNMATCHED/SKIPPED_AMBIGUOUS xét lại trong RETRY_DAYS ngày (editor có
    // thể gắn sản phẩm / nhập tiêu đề sau khi duyệt, lúc đó mới đủ tín hiệu tách).
    const RETRY_DAYS = 10;
    const retryFloor = new Date(Date.now() - RETRY_DAYS * DAY_MS);

    const [priorMatches, fbVideos, igVideos] = await Promise.all([
      this.prisma.taskVideoMatch.findMany({
        where: { created_at: { gte: new Date(since.getTime() - 14 * DAY_MS) } },
        select: { platform: true, post_id: true, status: true, created_at: true },
      }),
      this.loadFacebookVideos(since),
      this.loadInstagramVideos(since),
    ]);
    const processed = new Set(
      priorMatches
        .filter((r) => r.status === "MATCHED" || r.created_at < retryFloor)
        .map((r) => `${r.platform}:${r.post_id}`),
    );

    const videos = [...fbVideos, ...igVideos]
      .filter((v) => !processed.has(`${v.platform}:${v.postId}`))
      .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())
      .slice(0, maxVideos);

    if (!videos.length) {
      this.logger.log("[VIDEO-MATCH] Không có video mới nào cần xét");
      return { considered: 0, matched: 0, unmatched: 0, ambiguous: 0 };
    }

    const [resolver, tasks] = await Promise.all([
      this.buildChannelResolver(),
      this.loadCandidateTasks(since),
    ]);
    // 1 task ≈ 1 video MỖI NỀN TẢNG (video đăng cả FB lẫn IG). Khoá theo `${taskId}:${platform}`
    // để không chồng 2 video auto cùng nền tảng vào cùng task trong một lượt.
    const claimedTasks = new Set<string>();

    let matched = 0;
    let unmatched = 0;
    let ambiguous = 0;

    for (const video of videos) {
      try {
        const outcome = await this.matchOne(
          video,
          tasks,
          resolver,
          claimedTasks,
        );
        if (outcome === "MATCHED") matched++;
        else if (outcome === "SKIPPED_AMBIGUOUS") ambiguous++;
        else unmatched++;
      } catch (err: any) {
        unmatched++;
        this.logger.warn(
          `[VIDEO-MATCH] ${video.platform}:${video.postId} lỗi: ${err.message}`,
        );
      }
    }

    this.logger.log(
      `[VIDEO-MATCH] Xong: xét ${videos.length}, gắn ${matched}, nhập nhằng ${ambiguous}, bỏ ${unmatched}`,
    );
    return { considered: videos.length, matched, unmatched, ambiguous };
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
    resolver: ChannelResolver,
    claimedTasks: Set<string>,
  ): Promise<string> {
    // Task nào đã chứa sẵn link này (editor nhập tay / app đăng bài tự thêm)?
    const already = tasks.find((t) => taskAlreadyHasVideo(t, video));
    if (already) {
      await this.recordMatch(
        video,
        already.id,
        0,
        { source: "already-linked" },
        "MATCHED",
      );
      return "MATCHED";
    }

    const ctx = resolver.resolve(video);
    const inWindow = tasks.filter((t) => isWithinWindow(video, t.candidate));
    const scored = inWindow.map((t) => ({
      task: t.candidate,
      ...scoreCandidate(video, t.candidate, ctx),
    }));
    const winner = pickWinner(scored);
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
        return "SKIPPED_AMBIGUOUS";
      }

      claimedTasks.add(claimKey);
      await this.attachLink(winner.taskId, video);
      await this.recordMatch(
        video,
        winner.taskId,
        winner.score,
        winner.matchedBy,
        "MATCHED",
      );
      return "MATCHED";
    }

    await this.recordMatch(
      video,
      null,
      winner.score,
      { reason: winner.reason, topScore: winner.score },
      status,
    );
    return status;
  }

  private async attachLink(taskId: string, video: CandidateVideo) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { published_links: true },
    });
    const links = Array.isArray(task?.published_links)
      ? (task!.published_links as any[])
      : [];
    if (links.some((l) => l?.url === video.url)) return;

    const platformLabel =
      video.platform === "FACEBOOK" ? "Facebook" : "Instagram";

    let stats: unknown;
    try {
      stats = await this.linkStats.fetchStatsForLink(platformLabel, video.url);
    } catch {
      // Bỏ qua — cron 08:15 sẽ cào lại.
    }

    const entry: Record<string, unknown> = {
      id: randomUUID(),
      platform: platformLabel,
      url: video.url,
      source: "auto-match",
    };
    if (stats) entry.stats = stats;

    await this.prisma.task.update({
      where: { id: taskId },
      data: { published_links: [...links, entry] as any },
    });
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
        matched_by: matchedBy as any,
        status,
      },
      update: {
        task_id: taskId,
        url: video.url,
        score,
        matched_by: matchedBy as any,
        status,
      },
    });
  }

  // ─── Loaders ─────────────────────────────────────────────────────────────

  private async loadFacebookVideos(since: Date): Promise<CandidateVideo[]> {
    const rows = await this.prisma.video_management_ownedvideocontent.findMany({
      where: { published_at: { gte: since }, permalink_url: { not: null } },
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

  private async loadInstagramVideos(since: Date): Promise<CandidateVideo[]> {
    const rows = await this.prisma.scraperInstagramReel.findMany({
      where: { date_posted: { gte: since }, profile: { is_owned: true } },
      select: {
        post_id: true,
        url: true,
        description: true,
        hashtags: true,
        date_posted: true,
        profile: { select: { username: true, full_name: true } },
      },
    });
    return rows.map((r) => ({
      platform: "INSTAGRAM" as MatchPlatform,
      postId: r.post_id,
      url: r.url,
      caption: r.description || "",
      hashtags: (r.hashtags?.length
        ? r.hashtags
        : extractHashtags(r.description || "")
      ).map(normalizeHashtag),
      publishedAt: r.date_posted,
      channelKey: r.profile?.username || "",
      channelNameFallback: r.profile?.full_name || "",
    }));
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
    // 2 dòng cùng tên/handle: ưu tiên dòng có team hơn dòng chỉ có owner.
    const put = (map: Map<string, TeamRef>, k: string, ref: TeamRef) => {
      const prev = map.get(k);
      if (!prev || (!prev.teamId && ref.teamId)) map.set(k, ref);
    };
    for (const c of chRows) {
      const ref: TeamRef = {
        teamId: c.team_id ?? null,
        ownerId: c.owner_id ?? null,
      };
      if (c.name) put(byName, normName(c.name), ref);
      const handles = [
        normName(c.channel_id),
        handleFromLink(c.link_channel),
      ].filter((h): h is string => !!h);
      for (const h of handles) put(byHandle, h, ref);
    }

    // page_id / username → team qua huyk_channels
    const pageTeam = new Map<string, TeamRef>();
    for (const pg of pages) {
      const ref =
        byName.get(normName(pg.name)) ||
        byHandle.get(normName(pg.username)) ||
        byHandle.get(pg.page_id);
      if (ref) pageTeam.set(pg.page_id, ref);
    }

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
        if (!ref) {
          const kc = extractKCode(video.caption);
          const teamId = kc ? kcodeTeam.get(kc) : undefined;
          return {
            teamIdFromChannel: teamId ?? null,
            channelOwnerId: null,
          };
        }
        return {
          teamIdFromChannel: ref.teamId,
          channelOwnerId: ref.ownerId,
        };
      },
    };
  }

  private async loadCandidateTasks(since: Date): Promise<LoadedTask[]> {
    // Mốc nộp/duyệt/hạn có thể sớm hơn lúc video đăng — nới thêm 7 ngày (cửa sổ khớp chỉ ±2 ngày).
    const floor = new Date(since.getTime() - 7 * DAY_MS);
    const rows = await this.prisma.task.findMany({
      where: {
        status: { in: [TaskStatus.SUBMITTED, TaskStatus.APPROVED] },
        OR: [
          { submitted_at: { gte: floor } },
          { reviewed_at: { gte: floor } },
          { deadline: { gte: floor } },
        ],
      },
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
        product: { select: { sku: true } },
        editor_product: { select: { sku: true } },
        team_product: { select: { sku: true } },
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
          submittedAt: r.submitted_at,
          reviewedAt: r.reviewed_at,
          deadline: r.deadline,
        } satisfies CandidateTask,
      };
    });
  }
}

interface LoadedTask {
  id: string;
  publishedLinks: any[];
  candidate: CandidateTask;
}

interface TeamRef {
  teamId: string | null;
  ownerId: string | null;
}

interface ChannelResolver {
  resolve(video: CandidateVideo): ChannelContext;
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

function shortcodeFromUrl(url: string): string | null {
  const m = url.match(/\/(?:reel|reels|p|tv)\/([^/?#]+)/i);
  return m ? m[1] : null;
}

function longDigitRun(url: string): string | null {
  const runs = url.match(/\d{8,}/g);
  return runs ? runs.sort((a, b) => b.length - a.length)[0] : null;
}
