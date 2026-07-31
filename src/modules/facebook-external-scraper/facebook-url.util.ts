// Port thuần TS của clean_facebook_url/extract_handle_from_url (rapidapi_facebook.py cũ).
// Thuần string/URL transform, không cần gọi AI hay 3rd-party nào.

export function cleanFacebookUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return '';
  }
  const path = parsed.pathname.replace(/\/+$/, '') + '/';

  if (path.includes('profile.php')) {
    const pid = parsed.searchParams.get('id');
    if (pid) return `https://www.facebook.com/profile.php?id=${pid}`;
  }

  return `https://www.facebook.com${path}`;
}

export function extractHandleFromUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  const path = parsed.pathname.replace(/^\/+|\/+$/g, '');
  if (!path || path === 'profile.php') return '';
  if (path.includes('/')) return '';
  return path;
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
