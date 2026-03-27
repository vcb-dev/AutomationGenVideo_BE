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

  // 1) Cố gắng trích xuất username từ link_channel CHUẨN (ưu tiên)
  const link = (row.link_channel || '').trim();
  if (link) {
    let urlStr = link;
    if (!/^https?:\/\//i.test(urlStr)) urlStr = `https://${urlStr}`;

    try {
      const url = new URL(urlStr);
      let extracted = '';

      if (platform === 'FACEBOOK' && (urlStr.includes('facebook.com') || urlStr.includes('fb.com'))) {
        if (url.pathname.includes('profile.php')) {
          // Lấy numeric ID, URL đầy đủ sẽ được tra từ Channel.link_channel lúc scrape
          const id = url.searchParams.get('id');
          if (id) extracted = id;
        } else if (url.pathname.includes('/groups/')) {
          const parts = url.pathname.split('/groups/');
          if (parts[1]) extracted = parts[1].split('/')[0];
        } else {
          const parts = url.pathname.split('/').filter(Boolean);
          if (parts[0]) extracted = parts[0];
        }
      } 
      else if (platform === 'INSTAGRAM' && urlStr.includes('instagram.com')) {
        const parts = url.pathname.split('/').filter((p) => p && p.toLowerCase() !== 'p' && p.toLowerCase() !== 'reel' && p.toLowerCase() !== 'reels');
        if (parts[0]) extracted = parts[0];
      } 
      else if (platform === 'TIKTOK' && urlStr.includes('tiktok.com')) {
        const parts = url.pathname.split('/').filter(Boolean);
        const at = parts.find((p) => p.startsWith('@'));
        if (at) extracted = at.replace(/^@/, '');
        else if (parts[0]) extracted = parts[0]; // fallback
      }
      else if (platform === 'DOUYIN') {
        const path = url.pathname.replace(/\/+$/, '') || '/';
        const seg = path.split('/').filter(Boolean);
        const idx = seg.indexOf('user');
        if (idx >= 0 && seg[idx + 1]) extracted = seg[idx + 1];
      }
      else if (platform === 'XIAOHONGSHU') {
        const path = url.pathname.replace(/\/+$/, '') || '/';
        const seg = path.split('/').filter(Boolean);
        const m = path.match(/profile\/([a-zA-Z0-9]+)/i);
        if (m) extracted = m[1];
        else if (seg[0] === 'user' && seg[1]) extracted = seg[1];
      }

      if (extracted) {
        // Xóa trailing slash, xóa @
        extracted = extracted.replace(/\/$/, '').replace(/^@/, '');
        if (extracted) {
          return { platform, username: extracted.toLowerCase() };
        }
      }
    } catch {
      /* Invalid URL format, fallback below */
    }
  }

  // 2) Fallback: Dùng channel_id từ Lark (nếu link_channel trống hoặc không trích được)
  const idRaw = (row.channel_id || '').trim().replace(/^@/, '').replace(/\/$/, '');
  if (idRaw) {
    // Basic username validation (prevent full messy sentences instead of IDs)
    if (/^[A-Za-z0-9_.\-]+$/.test(idRaw) && idRaw.length <= 128) {
      return { platform, username: idRaw.toLowerCase() };
    }
  }

  return null;
}
