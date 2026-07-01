import { PrismaService } from "@/common/prisma/prisma.service";
import { EditorAssignmentHistory } from "../types";

/**
 * Tải lịch sử phân công của từng editor (all-time dedup, content đã dùng,
 * số task team product trong tháng) trong một lần query.
 */
export async function loadEditorAssignmentHistory(
  prisma: PrismaService,
  editorIds: string[],
  monthStart: Date,
  teamId: string,
): Promise<Map<string, EditorAssignmentHistory>> {
  const tasks = await prisma.task.findMany({
    where: {
      assignee_id: { in: editorIds },
      task_type: { not: "EXTRA" },
      status: { not: "CANCELLED" },
    },
    select: {
      assignee_id: true,
      team_id: true,
      content_id: true,
      editor_content_id: true,
      team_content_id: true,
      product_id: true,
      editor_product_id: true,
      team_product_id: true,
      assigned_at: true,
    },
  });

  const result = new Map<string, EditorAssignmentHistory>();

  for (const t of tasks) {
    const editorId = t.assignee_id!;
    if (!result.has(editorId)) {
      result.set(editorId, {
        assignedPairKeys: new Set(),
        assignedContentKeys: new Set(),
        teamProductTasksThisMonth: 0,
      });
    }
    const history = result.get(editorId)!;

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
      history.assignedPairKeys.add(`${contentKey}:${productKey}`);
    }
    if (contentKey) {
      history.assignedContentKeys.add(contentKey);
    }
    if (t.team_product_id && t.assigned_at != null && t.assigned_at >= monthStart && t.team_id === teamId) {
      history.teamProductTasksThisMonth++;
    }
  }

  return result;
}
