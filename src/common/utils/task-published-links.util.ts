import { ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { extractYoutubeVideoId } from '../../utils/task-auto/youtube-url.util'

export type PublishedLinkEntry = {
  id?: string
  platform: string
  url: string
  stats?: unknown
  [key: string]: unknown
}

const MAX_WRITE_ATTEMPTS = 5

export function asPublishedLinks(value: unknown): PublishedLinkEntry[] {
  return Array.isArray(value) ? (value as PublishedLinkEntry[]) : []
}

/** Khoá nhận diện 1 link — số liệu cào cho link nào chỉ gắn lại đúng link đó (cùng id + nền tảng + url). */
export function publishedLinkKey(link: PublishedLinkEntry): string {
  return `${link.id ?? ''}|${link.platform}|${link.url}`
}

/**
 * Gắn số liệu vừa cào (khoá theo publishedLinkKey) vào danh sách link MỚI NHẤT. Link bị xoá hoặc
 * sửa url trong lúc cào thì không còn khớp khoá nên tự bị bỏ qua. Không gắn được link nào → null.
 */
export function withFetchedStats(
  links: PublishedLinkEntry[],
  fetched: Map<string, unknown>,
): PublishedLinkEntry[] | null {
  let applied = false
  const next = links.map((link) => {
    const key = publishedLinkKey(link)
    if (!fetched.has(key)) return link
    applied = true
    return { ...link, stats: fetched.get(key) }
  })
  return applied ? next : null
}

type LinkPlatform = 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK' | 'YOUTUBE' | 'THREADS'

const LINK_PLATFORMS: Record<
  LinkPlatform,
  { label: string; hosts: string[]; aliases: string[]; videoId: (u: URL) => string | null }
> = {
  FACEBOOK: { label: 'Facebook', hosts: ['facebook.com', 'fb.com', 'fb.watch'], aliases: ['FB'], videoId: facebookVideoId },
  INSTAGRAM: { label: 'Instagram', hosts: ['instagram.com'], aliases: ['IG'], videoId: instagramShortcode },
  TIKTOK: { label: 'TikTok', hosts: ['tiktok.com'], aliases: ['TIK TOK', 'TT'], videoId: tiktokVideoId },
  YOUTUBE: { label: 'YouTube', hosts: ['youtube.com', 'youtu.be'], aliases: ['YT'], videoId: youtubeVideoId },
  THREADS: { label: 'Threads', hosts: ['threads.net', 'threads.com'], aliases: [], videoId: threadsPostCode },
}

const LINK_PLATFORM_KEYS = Object.keys(LINK_PLATFORMS) as LinkPlatform[]
const FB_OBJECT_ID = /^(\d{6,}|pfbid\w+)$/i
/** Link rút gọn/chia sẻ chưa giải được — mã trong khoá là mã chia sẻ, không phải mã video thật. */
const SHORT_PREFIX = 'short-'

function segmentsOf(u: URL): string[] {
  return u.pathname.split('/').filter(Boolean)
}

function facebookVideoId(u: URL): string | null {
  const segs = segmentsOf(u)
  if (u.hostname.endsWith('fb.watch')) return segs[0] ? SHORT_PREFIX + segs[0] : null
  for (const param of ['v', 'story_fbid']) {
    const value = u.searchParams.get(param)
    if (value && FB_OBJECT_ID.test(value)) return value
  }
  if (segs[0] === 'share') {
    const code = segs.length >= 3 ? segs[2] : segs[1]
    return code && code.length > 2 ? SHORT_PREFIX + code : null
  }
  if ((segs[0] === 'reel' || segs[0] === 'reels') && FB_OBJECT_ID.test(segs[1] ?? '')) return segs[1]
  const kind = segs.findIndex((s) => s === 'videos' || s === 'posts' || s === 'permalink')
  if (kind >= 0) {
    const id = segs.slice(kind + 1).reverse().find((s) => FB_OBJECT_ID.test(s))
    if (id) return id
  }
  // facebook.com/{id} hoặc /{page_id}_{post_id} — dạng app đăng bài tự ghi (schedule.service)
  const bare = segs.length === 1 ? segs[0].match(/^(?:\d+_)?(\d{8,})$/) : null
  return bare ? bare[1] : null
}

function instagramShortcode(u: URL): string | null {
  const segs = segmentsOf(u)
  const kind = segs.findIndex((s) => ['reel', 'reels', 'p', 'tv'].includes(s))
  const code = kind === 0 || kind === 1 ? segs[kind + 1] : undefined
  return code && /^[\w-]{5,}$/.test(code) ? code : null
}

function tiktokVideoId(u: URL): string | null {
  const segs = segmentsOf(u)
  if (/^(vt|vm)\./.test(u.hostname)) return segs[0] ? SHORT_PREFIX + segs[0] : null
  if (segs[0] === 't') return segs[1] ? SHORT_PREFIX + segs[1] : null
  const kind = segs.findIndex((s) => s === 'video' || s === 'photo')
  if (kind >= 0 && /^\d{6,}$/.test(segs[kind + 1] ?? '')) return segs[kind + 1]
  const mobile = segs[0] === 'v' ? segs[1]?.match(/^(\d{6,})(?:\.html)?$/) : null
  if (mobile) return mobile[1]
  const itemId = u.searchParams.get('item_id')
  return itemId && /^\d{6,}$/.test(itemId) ? itemId : null
}

function youtubeVideoId(u: URL): string | null {
  const id = extractYoutubeVideoId(u.href)
  return id && /^[\w-]{11}$/.test(id) ? id : null
}

function threadsPostCode(u: URL): string | null {
  const segs = segmentsOf(u)
  const kind = segs.indexOf('post')
  const code = kind >= 0 ? segs[kind + 1] : undefined
  return code && /^[\w-]{5,}$/.test(code) ? code : null
}

function parseLinkUrl(raw: unknown): URL | null {
  try {
    const u = new URL(String(raw ?? '').trim())
    return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u : null
  } catch {
    return null
  }
}

function bareHost(u: URL): string {
  return u.hostname.replace(/^www\./, '')
}

function platformOfHost(host: string): LinkPlatform | null {
  return LINK_PLATFORM_KEYS.find((p) => LINK_PLATFORMS[p].hosts.some((h) => host === h || host.endsWith(`.${h}`))) ?? null
}

function platformOfName(name: string): LinkPlatform | null {
  const n = name.trim().toUpperCase()
  return LINK_PLATFORM_KEYS.find((p) => p === n || LINK_PLATFORMS[p].aliases.includes(n)) ?? null
}

export function displayLink(url: string): string {
  return url.length > 60 ? `${url.slice(0, 57)}...` : url
}

/**
 * Khoá "cùng một video" để chống nộp trùng: `FACEBOOK:<id>`, `TIKTOK:<id>`... theo tên miền của URL
 * (không theo nhãn nền tảng — dữ liệu cũ có nhãn sai). Nền tảng lạ → `URL:<host+path+query>`.
 * null = link hỏng hoặc không trỏ vào video cụ thể.
 */
export function publishedVideoKey(url: unknown): string | null {
  const u = parseLinkUrl(url)
  if (!u) return null
  const host = bareHost(u)
  const platform = platformOfHost(host)
  if (!platform) return `URL:${host}${u.pathname.replace(/\/+$/, '')}${u.search}`
  const id = LINK_PLATFORMS[platform].videoId(u)
  return id ? `${platform}:${id}` : null
}

export function isShortVideoKey(key: string): boolean {
  return !key.startsWith('URL:') && key.slice(key.indexOf(':') + 1).startsWith(SHORT_PREFIX)
}

/** Phần định danh của khoá — chuỗi nằm nguyên văn trong URL đã lưu, dùng để lọc thô bằng SQL LIKE. */
export function videoKeySearchToken(key: string): string {
  const id = key.slice(key.indexOf(':') + 1)
  return isShortVideoKey(key) ? id.slice(SHORT_PREFIX.length) : id
}

/** Lý do không nhận link (null = hợp lệ): URL hỏng, sai nền tảng đã chọn, hoặc là link trang/kênh thay vì 1 video. */
export function publishedLinkError(platform: string, url: string): string | null {
  const shown = displayLink(url)
  const u = parseLinkUrl(url)
  if (!u) return `Link "${shown}" không hợp lệ — cần dạng https://...`

  const urlPlatform = platformOfHost(bareHost(u))
  const chosen = platformOfName(platform)
  if (!urlPlatform) {
    return chosen ? `Link "${shown}" không phải link ${LINK_PLATFORMS[chosen].label}` : null
  }

  const { label, videoId } = LINK_PLATFORMS[urlPlatform]
  if (chosen !== urlPlatform) {
    const from = chosen ? LINK_PLATFORMS[chosen].label : `"${platform.trim()}"`
    return `Link "${shown}" là link ${label}, không phải ${from} — chọn nền tảng ${label}`
  }
  if (!videoId(u)) {
    return `Link "${shown}" không trỏ tới một video ${label} cụ thể (đang là link trang/kênh?) — mở đúng video rồi sao chép link của video đó`
  }
  return null
}

/**
 * Sửa Task.published_links mà không đè thay đổi của nơi khác (nhiều nơi cùng đọc → cào → ghi lại cả mảng).
 * Ghi có điều kiện `updated_at` chưa đổi; bị chen ngang thì đọc lại và gọi `mutate` lần nữa, nên `mutate`
 * phải là hàm thuần — cào số liệu xong trước rồi mới gọi. `mutate` trả null = không cần ghi.
 * @returns danh sách sau khi ghi; null nếu task không tồn tại
 */
export async function mutateTaskPublishedLinks(
  db: Prisma.TransactionClient,
  taskId: string,
  mutate: (links: PublishedLinkEntry[]) => PublishedLinkEntry[] | null,
): Promise<{ links: PublishedLinkEntry[]; changed: boolean } | null> {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: { published_links: true, updated_at: true },
    })
    if (!task) return null

    const current = asPublishedLinks(task.published_links)
    const next = mutate(current)
    if (!next) return { links: current, changed: false }

    const { count } = await db.task.updateMany({
      where: { id: taskId, updated_at: task.updated_at },
      data: { published_links: next as Prisma.InputJsonValue },
    })
    if (count === 1) return { links: next, changed: true }
  }
  throw new ConflictException(
    'Link bài đăng của task vừa bị sửa đồng thời ở nơi khác — vui lòng thử lại',
  )
}
