import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Gắn ảnh người mượn vừa tải lên vào phiếu; chỉ nhận ảnh của chính người đó và chưa gắn ở đâu. */
export async function attachRequestPhotos(
  tx: Prisma.TransactionClient,
  args: { requestId: string; uploaderId: string; photoIds: string[]; incidentId?: string },
): Promise<void> {
  const ids = [...new Set(args.photoIds)];
  if (ids.length === 0) return;
  const { count } = await tx.memsRequestPhoto.updateMany({
    where: { id: { in: ids }, uploaded_by: args.uploaderId, request_id: null },
    data: { request_id: args.requestId, incident_id: args.incidentId ?? null },
  });
  if (count !== ids.length) {
    throw new BadRequestException('Có ảnh không hợp lệ hoặc đã gắn vào phiếu khác. Tải lại ảnh rồi gửi lại.');
  }
}
