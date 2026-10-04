// Port thuần TS của clean_facebook_url/extract_handle_from_url (rapidapi_facebook.py cũ).
// Thuần string/URL transform, không cần gọi AI hay 3rd-party nào.

import { resolveShortLink } from '../../common/utils/resolve-short-link.util';

// Đoạn path đầu của URL Facebook mà KHÔNG phải tên rút gọn của page. Giữ khớp với
// _NON_PAGE_SEGMENTS bên AI (video_management/services/facebook_page_url.py).
const NON_PAGE_SEGMENTS = new Set([
  'profile.php',
  'p',
  'people',
  'pages',
  'pg',
  'share',
  'watch',
  'reel',
  'reels',
  'groups',
  'events',
  'hashtag',
  'stories',
  'story.php',
  'permalink.php',
  'photo',
  'photo.php',
]);

export function isFacebookPageHandle(handle: string | null | undefined): boolean {
  return !!handle && !NON_PAGE_SEGMENTS.has(handle.toLowerCase());
}

function parseFacebookUrl(rawUrl: string): URL | null {
  if (!rawUrl) return null;
  let urlStr = rawUrl.trim();
  if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
    urlStr = `https://${urlStr}`;
  }
  try {
    return new URL(urlStr);
  } catch {
    return null;
  }
}

// Đưa mọi dạng link của một page về URL gốc của page đó, để người dùng copy link ở tab
// nào (Reels, Video, Giới thiệu, một video cụ thể...) cũng thêm được kênh:
//   facebook.com/<page>/reels/            → facebook.com/<page>/
//   facebook.com/<page>/videos/123/       → facebook.com/<page>/
//   facebook.com/pg/<page>/about/         → facebook.com/<page>/
//   facebook.com/p/<Tên>-<id>/ và facebook.com/people/<Tên>/<id>/ (page không có tên rút
//   gọn) giữ nguyên dạng gốc, bỏ đoạn tab phía sau.
// Link không thuộc một page (watch, reel, groups...) giữ nguyên path để tầng gọi báo lỗi.
export function cleanFacebookUrl(rawUrl: string): string {
  const parsed = parseFacebookUrl(rawUrl);
  if (!parsed) return '';
  const segments = parsed.pathname.split('/').filter(Boolean);
  const first = (segments[0] || '').toLowerCase();

  if (first === 'profile.php') {
    const pid = parsed.searchParams.get('id');
    if (pid) return `https://www.facebook.com/profile.php?id=${pid}`;
  }
  if (first === 'p' && segments[1] && /-\d+$/.test(segments[1])) {
    return `https://www.facebook.com/p/${segments[1]}/`;
  }
  if (first === 'people' && segments[1] && /^\d+$/.test(segments[2] || '')) {
    return `https://www.facebook.com/people/${segments[1]}/${segments[2]}/`;
  }
  if (first === 'pg' && isFacebookPageHandle(segments[1])) {
    return `https://www.facebook.com/${segments[1]}/`;
  }
  if (isFacebookPageHandle(segments[0])) {
    return `https://www.facebook.com/${segments[0]}/`;
  }

  return `https://www.facebook.com${parsed.pathname.replace(/\/+$/, '')}/`;
}

export function extractHandleFromUrl(url: string): string {
  const parsed = parseFacebookUrl(url);
  if (!parsed) return '';
  const path = parsed.pathname.replace(/^\/+|\/+$/g, '');
  if (!path || path.includes('/')) return '';
  return isFacebookPageHandle(path) ? path : '';
}

// ID số của page/profile không có tên rút gọn — đây là định danh duy nhất của nó trong URL:
//   profile.php?id=<id>, /p/<Tên>-<id>/, /people/<Tên>/<id>/
// Trả '' với URL dạng tên rút gọn (đã có handle) hoặc URL không thuộc page.
export function extractFacebookPageNumericId(url: string): string {
  const parsed = parseFacebookUrl(url);
  if (!parsed) return '';
  const segments = parsed.pathname.split('/').filter(Boolean);
  const first = (segments[0] || '').toLowerCase();

  if (first === 'profile.php') {
    const pid = parsed.searchParams.get('id') || '';
    return /^\d+$/.test(pid) ? pid : '';
  }
  if (first === 'p') {
    const m = (segments[1] || '').match(/-(\d+)$/);
    return m ? m[1] : '';
  }
  if (first === 'people') {
    return /^\d+$/.test(segments[2] || '') ? segments[2] : '';
  }
  return '';
}

// Link "Chia sẻ" một PAGE (facebook.com/share/<mã>/, không có chữ r|v|p như link bài) —
// Facebook chặn bot nên không đọc được page đích; tầng gọi báo người dùng mở link rồi copy
// URL trên thanh địa chỉ.
export function isFacebookPageShareLink(url: string): boolean {
  return /facebook\.com\/share\/(?![a-z]\/)[^/?#]+/i.test(url);
}

// Facebook ID hợp lệ: số thuần (dạng cũ) HOẶC "pfbid..." — chuỗi opaque Facebook dùng
// cho link "bài đăng" hiện đại (từ nút Copy Link trên post) từ ~2022, vd
// facebook.com/{page}/posts/pfbid02q5F.../ — không phải số nên regex số thuần bỏ sót.
// pfbid dùng thẳng được làm object ID cho Graph API GET, không cần giải mã.
function isFacebookObjectId(id: string): boolean {
  return /^\d+$/.test(id) || /^pfbid[\w-]+$/i.test(id);
}

// Bóc post_id (+ page handle nếu có) từ permalink 1 bài viết/video cụ thể — khác
// extractHandleFromUrl (chỉ xử lý URL cấp page, path 1 segment). Dùng cho tính năng
// tự kéo tương tác theo URL người dùng dán tay (video-library / task published-links).
// Thuần string/URL transform như 2 hàm trên — link rút gọn (fb.watch) phải resolve
// bằng resolveShortLink() ở tầng gọi trước khi đưa vào đây.
export function extractPostIdFromUrl(url: string): { postId: string | null; pageHandle: string | null } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { postId: null, pageHandle: null };
  }

  const vParam = parsed.searchParams.get('v');
  if (vParam && isFacebookObjectId(vParam)) return { postId: vParam, pageHandle: null };

  const storyFbid = parsed.searchParams.get('story_fbid');
  if (storyFbid && isFacebookObjectId(storyFbid)) {
    const pageParam = parsed.searchParams.get('id');
    return { postId: storyFbid, pageHandle: pageParam && isFacebookObjectId(pageParam) ? pageParam : null };
  }

  const segments = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);

  if (segments[0] === 'reel' && segments[1] && isFacebookObjectId(segments[1])) {
    return { postId: segments[1], pageHandle: null };
  }

  if (segments.length >= 3) {
    const [maybePage, kind, maybeId] = segments;
    if (['videos', 'posts', 'photos'].includes(kind) && isFacebookObjectId(maybeId)) {
      return { postId: maybeId, pageHandle: maybePage };
    }
  }

  return { postId: null, pageHandle: null };
}

// Bóc ID Reels công khai từ link facebook.com/reel/{id}. Reels là Video NODE THUẦN — Graph API
// từ chối field kiểu Page Post (shares/insights) với 400 "(#100) nonexisting field", nên nơi
// cào số liệu phải route sang fetchVideoNodeMetrics. ID này LẤY TỪ URL (khác nửa sau của
// post_id nội bộ {page}_{obj}). Trả null cho link không phải /reel/{id} để giữ đường Page Post.
export function extractFacebookReelId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (segments[0] === 'reel' && segments[1] && /^\d+$/.test(segments[1])) {
    return segments[1];
  }
  return null;
}

const FACEBOOK_SHARE_PATH_RE = /facebook\.com\/share\/[a-z]\/[^/?#]+/i;

export function isFacebookShareLink(url: string): boolean {
  return FACEBOOK_SHARE_PATH_RE.test(url);
}

// Facebook "share link" (nút Share > Copy Link trên app/web, dạng facebook.com/share/r
// (reel) | /share/v (video) | /share/p (post) /{code}/) không redirect bằng HTTP 3xx
// chuẩn — www.facebook.com chặn thẳng request kiểu bot (server trả 400 "Sorry, something
// went wrong" ngay cả khi có UA trình duyệt hợp lệ). Bản mobile web (m.facebook.com) thì
// KHÔNG chặn — trả 200 kèm HTML có sẵn href tới URL đích thật (/reel/{id}, /{page}/videos/{id}...)
// nên parse trực tiếp từ body thay vì trông chờ redirect chuẩn như resolveShortLink().
export async function resolveFacebookShareLink(rawUrl: string): Promise<string> {
  let mobileUrl: string;
  try {
    const u = new URL(rawUrl);
    u.hostname = 'm.facebook.com';
    mobileUrl = u.toString();
  } catch {
    return rawUrl;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(mobileUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    clearTimeout(timeout);
    const html = await res.text();
    const match = html.match(
      /https:\/\/(?:www|m)\.facebook\.com\/(?:reel\/\d+|[^/"'\s]+\/(?:videos|posts|photos)\/[^"'\s]+)/i,
    );
    return match ? match[0].replace('m.facebook.com', 'www.facebook.com') : rawUrl;
  } catch {
    return rawUrl;
  }
}

// Link người dùng dán để THÊM PAGE: fb.watch (redirect chuẩn) và link chia sẻ bài/reel/video
// (facebook.com/share/r|v|p/...) đều trỏ tới một video — resolve ra URL thật để
// cleanFacebookUrl lấy được page chủ video (facebook.com/<page>/videos/<id> → <page>).
export async function resolveFacebookPageInput(input: string): Promise<string> {
  const url = await resolveShortLink(input);
  return isFacebookShareLink(url) ? resolveFacebookShareLink(url) : url;
}

export interface FacebookPageMeta {
  name: string;
  avatarUrl: string;
  profileId: string;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractMetaTag(html: string, property: string): string {
  const match = html.match(new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i'))
    || html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${property}["']`, 'i'));
  return match ? match[1] : '';
}

export async function fetchFacebookPageMeta(pageUrl: string): Promise<FacebookPageMeta> {
  const cleanUrl = cleanFacebookUrl(pageUrl);
  const handle = extractHandleFromUrl(cleanUrl);
  const fallback: FacebookPageMeta = {
    name: handle || 'Facebook Page',
    avatarUrl: '',
    profileId: handle ? `tmp_${handle}` : `tmp_${Date.now()}${Math.floor(Math.random() * 1e6)}`,
  };

  if (!cleanUrl) return fallback;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(cleanUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept-Language': 'vi,en;q=0.9',
      },
    });
    clearTimeout(timeout);

    if (res.status === 200) {
      const html = await res.text();
      const rawImage = extractMetaTag(html, 'og:image');
      const rawTitle = extractMetaTag(html, 'og:title');

      let name = rawTitle ? decodeHtmlEntities(rawTitle).replace(/\s*\|.*$/, '').trim() : '';
      if (!name) name = handle || 'Facebook Page';

      const avatarUrl = rawImage ? rawImage.replace(/&amp;/g, '&') : '';
      let profileId = fallback.profileId;

      if (avatarUrl) {
        const mediaMatch = avatarUrl.match(/media_id=([0-9]+)/);
        if (mediaMatch) {
          profileId = mediaMatch[1];
        }
      }

      return { name, avatarUrl, profileId };
    }
  } catch {
    // Fallback on timeout or network error
  }

  return fallback;
}
