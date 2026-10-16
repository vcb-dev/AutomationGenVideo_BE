import { DateTime } from "luxon";
import { BrandType } from "@prisma/client";
import {
  WIN_VIDEO_LOOKBACK_DAYS,
  WIN_VIDEO_MIN_VIEWS,
  WIN_VIDEO_POOL_SIZE,
  WinVideoCandidate,
} from "../types";
import {
  EDITOR_CONTENT_SELECT,
  GLOBAL_CONTENT_SELECT,
  TEAM_CONTENT_SELECT,
  candidateOfRow,
} from "./content-pool";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ScraperAggregateReadService } from "@/modules/scraper-aggregate/scraper-aggregate-read.service";

/** Bộ lọc thị trường của lưới video (content-filters.ts marketFilter) tương ứng với team. */
export function winVideoMarketOf(team: { brand_type: BrandType; market: string | null }): "vn" | "global" | "doda" {
  if (team.brand_type === "DO_DA") return "doda";
  return (team.market || "VIETNAM").toUpperCase() === "VIETNAM" ? "vn" : "global";
}

type OwnedVideo = Awaited<ReturnType<ScraperAggregateReadService["ownedChannelVideos"]>>["videos"][number];

function toCandidate(v: OwnedVideo, fromTeam: boolean): WinVideoCandidate {
  return {
    platform: v.platform,
    post_id: v.post_id,
    url: v.url,
    caption: v.description ?? "",
    thumbnail_url: v.thumbnail_url || null,
    views: v.play_count,
    published_at: v.date_posted ? new Date(v.date_posted) : null,
    page_name: v.author_name || null,
    fromTeam,
  };
}

/**
 * Video Facebook kênh nội bộ > 10K view trong 90 ngày, caption có hashtag đúng tuyến (#A1...) —
 * cùng nguồn với lưới "Video win" ở Kho content. Lấy video trên kênh của team trước; chưa đủ thì bù
 * video cùng thị trường của các kênh khác (nhiều page chưa ghép được kênh ↔ team).
 */
export async function loadWinVideoPool(
  read: ScraperAggregateReadService,
  team: { id: string; brand_type: BrandType; market: string | null },
  lineName: string,
  now: DateTime,
): Promise<WinVideoCandidate[]> {
  const base = {
    platform: "facebook",
    min_plays: String(WIN_VIDEO_MIN_VIEWS),
    content_line: lineName,
    date_from: now.minus({ days: WIN_VIDEO_LOOKBACK_DAYS }).toFormat("yyyy-MM-dd"),
    sort: "plays",
    page_size: String(WIN_VIDEO_POOL_SIZE),
  };
  const pool = new Map<string, WinVideoCandidate>();
  const teamVideos = await read.ownedChannelVideos({ ...base, team_id: team.id });
  for (const v of teamVideos.videos) pool.set(v.post_id, toCandidate(v, true));
  if (pool.size < WIN_VIDEO_POOL_SIZE) {
    const marketVideos = await read.ownedChannelVideos({ ...base, market: winVideoMarketOf(team) });
    for (const v of marketVideos.videos) {
      if (!pool.has(v.post_id)) pool.set(v.post_id, toCandidate(v, false));
    }
  }
  return [...pool.values()];
}

/**
 * Video win đã được khớp về 1 task có content (task_video_matches) → khoá content của task đó.
 * Những video này đã có content trong kho: gợi ý thẳng content (đánh dấu win) thay vì tạo content mới.
 */
export async function loadMatchedVideoContentKeys(
  prisma: PrismaService,
  postIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (!postIds.length) return result;
  const rows = await prisma.taskVideoMatch.findMany({
    where: { platform: "FACEBOOK", status: "MATCHED", post_id: { in: postIds } },
    select: {
      post_id: true,
      task: {
        select: {
          content: { select: GLOBAL_CONTENT_SELECT },
          team_content: { select: TEAM_CONTENT_SELECT },
          editor_content: { select: EDITOR_CONTENT_SELECT },
        },
      },
    },
  });
  for (const r of rows) {
    const candidate = r.task ? candidateOfRow(r.task) : null;
    if (candidate) result.set(r.post_id, candidate.keys);
  }
  return result;
}

/** editorId → post_id các video win người đó đã lấy làm content kho cá nhân (không gợi ý lại). */
export async function loadConvertedVideoPostIds(
  prisma: PrismaService,
  editorIds: string[],
  postIds: string[],
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  if (!editorIds.length || !postIds.length) return result;
  const rows = await prisma.editorContent.findMany({
    where: { user_id: { in: editorIds }, reference_video_post_id: { in: postIds } },
    select: { user_id: true, reference_video_post_id: true },
  });
  for (const r of rows) {
    if (!r.reference_video_post_id) continue;
    if (!result.has(r.user_id)) result.set(r.user_id, new Set());
    result.get(r.user_id)!.add(r.reference_video_post_id);
  }
  return result;
}
