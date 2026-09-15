import { Prisma } from "@prisma/client";

export function deadlineWindow(
  range: { gte: Date; lt: Date } | null,
): Prisma.TaskWhereInput {
  if (!range) return {};
  return { OR: [{ deadline: range }, { deadline: null, created_at: range }] };
}
