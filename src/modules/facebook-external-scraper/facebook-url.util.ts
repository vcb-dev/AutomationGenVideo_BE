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
