// Bóc video ID từ URL YouTube (task published-links). Thuần string/URL, không gọi API. Vẫn tự
// đọc path youtu.be/{id} phòng khi resolveShortLink() ở tầng gọi fail/timeout.
export function extractYoutubeVideoId(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^(www|m|music)\./i, "").toLowerCase();

  if (host === "youtu.be") {
    const id = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/")[0];
    return id || null;
  }

  if (host !== "youtube.com") return null;

  const vParam = parsed.searchParams.get("v");
  if (vParam) return vParam;

  const segments = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  // /shorts/{id}, /embed/{id}, /live/{id}, /v/{id}
  if (["shorts", "embed", "live", "v"].includes(segments[0]) && segments[1]) {
    return segments[1];
  }

  return null;
}
