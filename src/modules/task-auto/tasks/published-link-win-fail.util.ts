import { PublishedLinkStats } from "./task-published-link-stats.service";

// Ngưỡng view tính "win": 1 link bài đăng bất kỳ vượt ngưỡng là WIN (không cộng dồn). Chỉ số
// tự tính, tách biệt EditorKpi.video_win/fail và content-report/ContentVideo.status (nhập tay).
export const VIEW_WIN_THRESHOLD = 10000;

export type PublishedLinkWinFailStatus = "win" | "fail" | "pending";

export interface PublishedLinkLike {
  platform: string;
  /** URL bài đăng — chỉ cần cho pickWinningLink(); classify không dùng tới. */
  url?: string | null;
  stats?: Pick<PublishedLinkStats, "views" | "status"> | null;
}

export interface PublishedLinkWinFailResult {
  status: PublishedLinkWinFailStatus;
  /** View của link CAO NHẤT trong số link đã cào thành công (0 khi pending) — số hiển thị cạnh nhãn. */
  views: number;
}

/**
 * Phân loại 1 task theo view các link đã cào thành công:
 * - "win"     : ít nhất 1 link > VIEW_WIN_THRESHOLD (không cộng dồn)
 * - "fail"    : có link cào được số liệu nhưng không link nào vượt ngưỡng
 * - "pending" : chưa link nào cào được — KHÔNG tính oan thành fail (cào chỉ ~65% thành công)
 */
export function classifyPublishedLinksWinFail(
  links: PublishedLinkLike[] | null | undefined,
): PublishedLinkWinFailResult {
  const successfulViews = (links ?? [])
    .filter((l) => l.stats?.status === "success")
    .map((l) => l.stats?.views ?? 0);

  if (successfulViews.length === 0) {
    return { status: "pending", views: 0 };
  }

  const views = Math.max(...successfulViews);
  return {
    status: views > VIEW_WIN_THRESHOLD ? "win" : "fail",
    views,
  };
}

export interface WinningLink {
  url: string;
  platform: string;
  views: number;
}

/**
 * Link "thắng" của task = link cào thành công có view cao nhất và > VIEW_WIN_THRESHOLD (khớp
 * định nghĩa "win" ở trên). null khi task không "win". Dùng cho luồng tự đẩy content win.
 */
export function pickWinningLink(
  links: PublishedLinkLike[] | null | undefined,
): WinningLink | null {
  let best: WinningLink | null = null;
  for (const l of links ?? []) {
    if (l.stats?.status !== "success") continue;
    const views = l.stats?.views ?? 0;
    if (best && views <= best.views) continue;
    best = {
      url: (l.url ?? "").trim(),
      platform: (l.platform ?? "").trim().toUpperCase(),
      views,
    };
  }
  return best && best.views > VIEW_WIN_THRESHOLD ? best : null;
}

/** Gộp nhiều kết quả classify (nhiều task của cùng 1 người) thành đếm win/fail/pending. */
export function summarizeWinFailCounts(
  statuses: PublishedLinkWinFailStatus[],
): { win: number; fail: number; pending: number } {
  const result = { win: 0, fail: 0, pending: 0 };
  for (const s of statuses) result[s]++;
  return result;
}
