// Giá trị Reddit chấp nhận cho sắp xếp / khoảng thời gian (khớp SEARCH_SORTS, TIME_RANGES bên AI
// video_management/services/tikhub_reddit.py).
export const REDDIT_SORTS = ['RELEVANCE', 'HOT', 'TOP', 'NEW', 'COMMENTS'] as const;
export const REDDIT_TIME_RANGES = ['all', 'year', 'month', 'week', 'day', 'hour'] as const;

export type RedditSort = (typeof REDDIT_SORTS)[number];
export type RedditTimeRange = (typeof REDDIT_TIME_RANGES)[number];

export function parseRedditSort(raw: unknown): RedditSort | null {
  const value = String(raw ?? '').toUpperCase();
  return (REDDIT_SORTS as readonly string[]).includes(value) ? (value as RedditSort) : null;
}

export function parseRedditTimeRange(raw: unknown): RedditTimeRange | null {
  const value = String(raw ?? '').toLowerCase();
  return (REDDIT_TIME_RANGES as readonly string[]).includes(value) ? (value as RedditTimeRange) : null;
}

/**
 * "r/Jewelry", "/r/jewelry/", "https://www.reddit.com/r/jewelry/top/?t=month", link chia sẻ của app
 * ".../r/jewelry/s/<mã>", hoặc tên trần → "jewelry". '' nếu không ra tên hợp lệ (2–21 ký tự chữ, số,
 * gạch dưới). Khớp normalize_subreddit_name bên AI.
 */
export function normalizeSubredditName(raw: string): string {
  const text = (raw || '').trim();
  const match = text.match(/(?:^|\/)r\/([A-Za-z0-9_]+)/);
  const name = match ? match[1] : text.replace(/^\/+/, '');
  return /^[A-Za-z0-9_]{2,21}$/.test(name) ? name.toLowerCase() : '';
}
