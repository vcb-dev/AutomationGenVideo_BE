import { ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'

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
