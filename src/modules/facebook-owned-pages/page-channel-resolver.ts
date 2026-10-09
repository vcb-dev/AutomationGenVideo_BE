/**
 * Ghép page Facebook nội bộ với kênh trong `huyk_channels` (không có FK, chỉ khớp qua chữ: page_id →
 * username → tên) để biết page thuộc team nào và ai cầm. Nhiều kênh cùng khoá thì chỉ dùng các dòng ưu tiên
 * cao nhất; nếu chúng vẫn trỏ sang nhiều team/chủ khác nhau thì coi là mơ hồ, không ghép.
 */

export interface ResolverChannel {
  platform: string | null;
  name: string;
  channel_id: string | null;
  link_channel: string | null;
  team_id: string | null;
  owner_id: string | null;
}

export interface ResolverPage {
  page_id: string;
  name: string;
  username: string | null;
}

export interface PageChannelRef {
  teamId: string | null;
  ownerId: string | null;
}

const norm = (s: string | null | undefined): string =>
  (s || '').normalize('NFC').trim().toLowerCase();

/** Đoạn path đầu tiên của link không phải handle mà là loại trang (bài viết, share, kênh YouTube...). */
const NOT_A_HANDLE = ['profile.php', 'share', 'reel', 'reels', 'p', 'tv', 'channel', 'c', 'user', 'watch', 'shorts'];

/**
 * Bóc handle/username hoặc numeric profile id từ link_channel của huyk_channels.
 * Threads/TikTok/YouTube viết handle sau dấu @ (threads.com/@abc) — bỏ @ để so với username.
 */
export function handleFromLink(link: string | null | undefined): string | null {
  const l = norm(link);
  if (!l) return null;
  const path = l.match(/(?:facebook|instagram|threads|tiktok|youtube)\.(?:com|net)\/@?([a-z0-9._-]+)/i);
  if (path && path[1] && !NOT_A_HANDLE.includes(path[1])) {
    return path[1];
  }
  const numeric = l.match(/[?&]id=(\d+)/);
  return numeric ? numeric[1] : null;
}

/** channel_id người nhập tay đôi khi kèm @ hoặc khoảng trắng đầu (" huyk.abc", "@huyk_abc"). */
const normHandle = (s: string | null | undefined): string => norm(s).replace(/^@/, '');

function rank(c: ResolverChannel, preferPlatform: string): number {
  return (norm(c.platform) === preferPlatform ? 2 : 0) + (c.team_id ? 1 : 0);
}

type ChannelIndex = Map<string, ResolverChannel[]>;

function addIndex(index: ChannelIndex, key: string, channel: ResolverChannel): void {
  const rows = index.get(key) ?? [];
  rows.push(channel);
  index.set(key, rows);
}

/**
 * Hợp nhất các dòng cùng khoá. Chỉ trả field khi tất cả dòng ưu tiên cao nhất thống nhất;
 * nhờ vậy hai page/kênh trùng tên nhưng thuộc hai team không bị ghép theo dòng DB đầu tiên.
 */
function resolveRows(rows: ResolverChannel[] | undefined, preferPlatform: string): PageChannelRef | null {
  if (!rows?.length) return null;
  const bestRank = Math.max(...rows.map((row) => rank(row, preferPlatform)));
  const best = rows.filter((row) => rank(row, preferPlatform) === bestRank);
  const teams = [...new Set(best.map((row) => row.team_id).filter((id): id is string => !!id))];
  const owners = [...new Set(best.map((row) => row.owner_id).filter((id): id is string => !!id))];
  const ref = {
    teamId: teams.length === 1 ? teams[0] : null,
    ownerId: owners.length === 1 ? owners[0] : null,
  };
  return ref.teamId || ref.ownerId ? ref : null;
}

/**
 * page_id → { team, người cầm kênh }; page không khớp kênh nào thì không có trong map.
 * Dùng được cho profile IG/Threads/TikTok/YouTube: truyền username/channel_id làm `page_id` kèm `preferPlatform`.
 */
export function buildPageChannelMap(
  pages: ResolverPage[],
  channels: ResolverChannel[],
  preferPlatform = 'facebook',
): Map<string, PageChannelRef> {
  const byName: ChannelIndex = new Map();
  const byHandle: ChannelIndex = new Map();

  for (const c of channels) {
    if (!c.team_id && !c.owner_id) continue;
    if (c.name) addIndex(byName, norm(c.name), c);
    for (const h of new Set([normHandle(c.channel_id), handleFromLink(c.link_channel)])) {
      if (h) addIndex(byHandle, h, c);
    }
  }

  const result = new Map<string, PageChannelRef>();
  for (const pg of pages) {
    const hit =
      resolveRows(byHandle.get(normHandle(pg.page_id)), preferPlatform) ||
      (pg.username ? resolveRows(byHandle.get(normHandle(pg.username)), preferPlatform) : null) ||
      resolveRows(byName.get(norm(pg.name)), preferPlatform);
    if (hit) result.set(pg.page_id, hit);
  }
  return result;
}
