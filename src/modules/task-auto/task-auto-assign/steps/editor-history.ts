import { PrismaService } from "@/common/prisma/prisma.service";
import { EditorAssignmentHistory } from "../types";

export type CandidateContentIds = {
  global: string[];
  team: string[];
  personal: string[];
};

/**
 * Tải lịch sử phân công của từng editor:
 *  - assignedPairKeys/assignedContentKeys (all-time dedup): chỉ cần xét các task
 *    có content trùng với pool ứng viên của lượt chạy hôm nay — content nào không
 *    còn trong pool thì không bao giờ được so khớp bởi isNewContent/pairKeyOf,
 *    nên lọc theo candidateContentIds ở SQL không đổi kết quả, chỉ tránh quét
 *    toàn bộ lịch sử (không giới hạn thời gian) của editor mỗi lần chạy.
 *  - pushedProductIds/pushedProductIdsBeforeToday: chỉ cần trong tháng hiện tại,
 *    lọc thẳng bằng assigned_at >= monthStart thay vì kéo hết rồi lọc ở JS.
 * Tính cả task tạo tay (EXTRA) — task giao tay cũng không bị chia lại.
 */
export async function loadEditorAssignmentHistory(
  prisma: PrismaService,
  editorIds: string[],
  monthStart: Date,
  todayStart: Date,
  teamId: string,
  candidateContentIds: CandidateContentIds,
): Promise<Map<string, EditorAssignmentHistory>> {
  const result = new Map<string, EditorAssignmentHistory>();
  const ensure = (editorId: string) => {
    if (!result.has(editorId)) {
      result.set(editorId, {
        assignedPairKeys: new Set(),
        assignedContentKeys: new Set(),
        pushedProductIds: new Set(),
        pushedProductIdsBeforeToday: new Set(),
      });
    }
    return result.get(editorId)!;
  };

  const contentOr = [
    ...(candidateContentIds.global.length > 0
      ? [{ content_id: { in: candidateContentIds.global } }]
      : []),
    ...(candidateContentIds.team.length > 0
      ? [{ team_content_id: { in: candidateContentIds.team } }]
      : []),
    ...(candidateContentIds.personal.length > 0
      ? [{ editor_content_id: { in: candidateContentIds.personal } }]
      : []),
  ];

  const [dedupTasks, pushTasks] = await Promise.all([
    contentOr.length > 0
      ? prisma.task.findMany({
          where: {
            assignee_id: { in: editorIds },
            status: { not: "CANCELLED" },
            OR: contentOr,
          },
          select: {
            assignee_id: true,
            content_id: true,
            editor_content_id: true,
            team_content_id: true,
            product_id: true,
            editor_product_id: true,
            team_product_id: true,
          },
        })
      : Promise.resolve([]),
    prisma.task.findMany({
      where: {
        assignee_id: { in: editorIds },
        team_id: teamId,
        status: { not: "CANCELLED" },
        assigned_at: { gte: monthStart },
        team_product_id: { not: null },
      },
      select: {
        assignee_id: true,
        team_product_id: true,
        assigned_at: true,
      },
    }),
  ]);

  for (const t of dedupTasks) {
    const history = ensure(t.assignee_id!);

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
  }

  // Đếm SP riêng biệt: SP kho team = SP đẩy theo kế hoạch
  for (const t of pushTasks) {
    const history = ensure(t.assignee_id!);
    history.pushedProductIds.add(t.team_product_id!);
    if (t.assigned_at! < todayStart) {
      history.pushedProductIdsBeforeToday.add(t.team_product_id!);
    }
  }

  return result;
}
