import { PrismaService } from "@/common/prisma/prisma.service";
import { EditorStats } from "../types";

/**
 * Lấy thống kê lịch sử phân công (all-time dedup, content đã dùng, team product
 * count tháng này) cho một batch editors trong một lần query.
 */
export async function batchEditorStats(
  prisma: PrismaService,
  editorIds: string[],
  monthStart: Date,
): Promise<Map<string, EditorStats>> {
  const tasks = await prisma.task.findMany({
    where: {
      assignee_id: { in: editorIds },
      is_extra: false,
      status: { not: "CANCELLED" },
    },
    select: {
      assignee_id: true,
      content_id: true,
      editor_content_id: true,
      team_content_id: true,
      product_id: true,
      editor_product_id: true,
      team_product_id: true,
      assigned_at: true,
    },
  });

  const result = new Map<string, EditorStats>();

  for (const t of tasks) {
    const eid = t.assignee_id!;
    if (!result.has(eid)) {
      result.set(eid, {
        existingPairs: new Set(),
        usedContentKeys: new Set(),
        teamProductTaskCount: 0,
      });
    }
    const stats = result.get(eid)!;

    // Canonical keys: personal → team → global
    const contentKey = t.editor_content_id
      ? `personal:${t.editor_content_id}`
      : t.team_content_id
        ? `team:${t.team_content_id}`
        : t.content_id
          ? `global:${t.content_id}`
          : null;

    const productKey = t.editor_product_id
      ? `personal:${t.editor_product_id}`
      : t.team_product_id
        ? `team:${t.team_product_id}`
        : t.product_id
          ? `global:${t.product_id}`
          : null;

    if (contentKey && productKey) {
      stats.existingPairs.add(`${contentKey}:${productKey}`);
    }
    if (contentKey) {
      stats.usedContentKeys.add(contentKey);
    }
    if (
      t.team_product_id &&
      t.assigned_at != null &&
      t.assigned_at >= monthStart
    ) {
      stats.teamProductTaskCount++;
    }
  }

  return result;
}
