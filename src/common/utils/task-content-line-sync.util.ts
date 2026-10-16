import { Prisma } from '@prisma/client'

/** Field trên Task trỏ về content nguồn (mỗi task chỉ set tối đa 1 trong 3). */
export type TaskContentRefField = 'content_id' | 'editor_content_id' | 'team_content_id'

/**
 * Task.content_line_id là bản chụp tuyến của content lúc tạo task — đổi tuyến content sau đó không tự lan sang task.
 * Gọi ngay sau khi đổi tuyến content. Chỉ cập nhật task còn "theo" content (tuyến null hoặc bằng tuyến cũ);
 * task đặt tuyến riêng giữ nguyên. newLineId = null không xoá tuyến đã có của task.
 * @returns số task đã cập nhật
 */
export async function syncTaskContentLine(
  db: Prisma.TransactionClient,
  field: TaskContentRefField,
  contentId: string,
  oldLineId: string | null,
  newLineId: string | null,
): Promise<number> {
  if (!newLineId || newLineId === oldLineId) return 0
  const { count } = await db.task.updateMany({
    where: {
      [field]: contentId,
      OR: [{ content_line_id: null }, ...(oldLineId ? [{ content_line_id: oldLineId }] : [])],
    } as Prisma.TaskWhereInput,
    data: { content_line_id: newLineId },
  })
  return count
}
