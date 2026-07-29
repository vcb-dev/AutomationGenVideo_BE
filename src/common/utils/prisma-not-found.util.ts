import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

/**
 * Chạy 1 lệnh Prisma write (update/delete) và convert lỗi P2025 (record not found)
 * thành NotFoundException, thay vì phải SELECT trước để check tồn tại rồi mới write —
 * loại bỏ 1 round-trip DB cho mỗi update/delete.
 */
export async function runOrNotFound<T>(
  fn: () => Promise<T>,
  notFoundMessage: string,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      throw new NotFoundException(notFoundMessage);
    }
    throw err;
  }
}
