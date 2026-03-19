import { Platform } from '@prisma/client';

/** Map cột "Nền tảng" / text từ Lark → enum Prisma */
export function platformFromLarkString(platformRaw: string | null | undefined): Platform | null {
  if (!platformRaw?.trim()) return null;
  const s = platformRaw.trim().toLowerCase();
  if (s.includes('tiktok') || s.includes('tik tok')) return 'TIKTOK';
  if (s.includes('instagram') || s === 'ig' || s.includes('insta')) return 'INSTAGRAM';
  if (s.includes('facebook') || s.includes('fb ') || s === 'fb') return 'FACEBOOK';
  if (s.includes('douyin') || s.includes('抖音')) return 'DOUYIN';
  if (s.includes('xiaohongshu') || s.includes('redbook') || s.includes('小红书') || s.includes('xhs')) {
    return 'XIAOHONGSHU';
  }
  return null;
}

export type ChannelRowLike = {
  link_channel: string | null;
  platform: string | null;
  channel_id: string | null;
  name: string | null;
};

/**
 * Suy ra platform + username để lưu tracked_channels (khớp logic add tay).
 */
export function resolveTrackedUsername(row: ChannelRowLike): { platform: Platform; username: string } | null {
  const platform = platformFromLarkString(row.platform || undefined);
  if (!platform) return null;

  const idRaw = (row.channel_id || '').trim().replace(/^@/, '');
  if (idRaw && /^[\w._-]+$/.test(idRaw) && idRaw.length <= 128) {
    return { platform, username: idRaw.toLowerCase() };
  }

  const link = (row.link_channel || '').trim();
  if (!link) return null;

  let urlStr = link;
  if (!/^https?:\/\//i.test(urlStr)) urlStr = `https://${urlStr}`;

  try {
    const url = new URL(urlStr);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const seg = path.split('/').filter(Boolean);

    if (platform === 'TIKTOK') {
      const at = seg.find((s) => s.startsWith('@'));
      if (at) return { platform, username: at.replace(/^@/, '').toLowerCase() };
      const m = path.match(/@([\w.]+)/);
      if (m) return { platform, username: m[1].toLowerCase() };
    }

    if (platform === 'INSTAGRAM') {
      const skip = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'tv']);
      if (seg[0] && !skip.has(seg[0].toLowerCase())) {
        return { platform, username: seg[0].replace(/^@/, '').toLowerCase() };
      }
    }

    if (platform === 'FACEBOOK') {
      const idParam = url.searchParams.get('id');
      if (seg[0] === 'profile.php' && idParam) {
        return { platform, username: idParam };
      }
      const skip = new Set(['watch', 'groups', 'share', 'reel', 'reels', 'stories', 'pages']);
      if (seg[0] && !skip.has(seg[0].toLowerCase())) {
        const u = seg[0].split('?')[0].toLowerCase();
        if (u && u !== 'people') return { platform, username: u };
      }
    }

    if (platform === 'DOUYIN') {
      const idx = seg.indexOf('user');
      if (idx >= 0 && seg[idx + 1]) return { platform, username: seg[idx + 1] };
    }

    if (platform === 'XIAOHONGSHU') {
      const m = path.match(/profile\/([a-zA-Z0-9]+)/i);
      if (m) return { platform, username: m[1] };
      if (seg[0] === 'user' && seg[1]) return { platform, username: seg[1] };
    }

    const last = seg[seg.length - 1]?.replace(/^@/, '');
    if (last && /^[\w._-]+$/.test(last) && last.length <= 128) {
      return { platform, username: last.toLowerCase() };
    }
  } catch {
    /* invalid URL */
  }

  return null;
}
