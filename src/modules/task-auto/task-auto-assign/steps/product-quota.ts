import { PrismaService } from "@/common/prisma/prisma.service";
import { AssignmentPair, ProductQuotaState } from "../types";

/**
 * Tải trạng thái target_quantity của kho tháng (team + cá nhân) cho 1 team/tháng:
 *  - teamRemaining: chỉ tiêu dùng chung cho cả team theo TeamProductWarehouse.target_quantity,
 *    trừ đi tổng số task không-huỷ tháng này của TẤT CẢ editor cho sản phẩm đó.
 *  - originOverride: nếu 1 TeamProduct có nguồn gốc từ kho cá nhân của 1 editor
 *    (source_editor_product_id) và editor đó cũng đã warehouse đúng sản phẩm/tháng này,
 *    riêng editor gốc dùng chỉ tiêu cá nhân của họ thay vì chỉ tiêu chung của team.
 *  - personalRemaining: chỉ tiêu cá nhân cho sản phẩm ở lane sáng tạo (EditorProductWarehouse),
 *    thuần theo từng editor, không chia sẻ chéo.
 */
export async function loadProductQuotaState(
  prisma: PrismaService,
  teamId: string,
  editorIds: string[],
  month: string,
  monthStart: Date,
): Promise<ProductQuotaState> {
  const teamRows = await prisma.teamProductWarehouse.findMany({
    where: { month, team_product: { team_id: teamId } },
    select: {
      team_product_id: true,
      target_quantity: true,
      team_product: {
        select: {
          source_editor_product_id: true,
          source_editor_product: { select: { user_id: true } },
        },
      },
    },
  });

  const teamProductIds = teamRows.map((r) => r.team_product_id);

  const doneRows =
    teamProductIds.length > 0
      ? await prisma.task.groupBy({
          by: ["team_product_id", "assignee_id"],
          where: {
            team_id: teamId,
            team_product_id: { in: teamProductIds },
            status: { not: "CANCELLED" },
            assigned_at: { gte: monthStart },
          },
          _count: { id: true },
        })
      : [];

  // team_product_id -> tổng done (mọi assignee)
  const totalDoneByProduct = new Map<string, number>();
  // team_product_id -> (assignee_id -> done) — cần cho origin-editor override
  const doneByProductAndAssignee = new Map<string, Map<string, number>>();
  for (const r of doneRows) {
    const productId = r.team_product_id!;
    const assigneeId = r.assignee_id!;
    totalDoneByProduct.set(
      productId,
      (totalDoneByProduct.get(productId) ?? 0) + r._count.id,
    );
    if (!doneByProductAndAssignee.has(productId))
      doneByProductAndAssignee.set(productId, new Map());
    doneByProductAndAssignee.get(productId)!.set(assigneeId, r._count.id);
  }

  const originSourceIds = [
    ...new Set(
      teamRows
        .filter((r) => r.team_product.source_editor_product_id)
        .map((r) => r.team_product.source_editor_product_id!),
    ),
  ];
  const originWarehouseRows =
    originSourceIds.length > 0
      ? await prisma.editorProductWarehouse.findMany({
          where: { month, editor_product_id: { in: originSourceIds } },
          select: { editor_product_id: true, target_quantity: true },
        })
      : [];
  const originTargetByEditorProductId = new Map(
    originWarehouseRows.map((r) => [r.editor_product_id, r.target_quantity]),
  );

  const teamRemaining = new Map<string, number>();
  const originOverride = new Map<string, { editorId: string; remaining: number }>();

  for (const row of teamRows) {
    const productId = row.team_product_id;
    const totalDone = totalDoneByProduct.get(productId) ?? 0;
    teamRemaining.set(productId, Math.max(0, row.target_quantity - totalDone));

    const sourceId = row.team_product.source_editor_product_id;
    const originEditorId = row.team_product.source_editor_product?.user_id;
    const originTarget = sourceId ? originTargetByEditorProductId.get(sourceId) : undefined;
    if (originEditorId && originTarget != null) {
      const originDone =
        doneByProductAndAssignee.get(productId)?.get(originEditorId) ?? 0;
      originOverride.set(productId, {
        editorId: originEditorId,
        remaining: Math.max(0, originTarget - originDone),
      });
    }
  }

  // ── Cá nhân (lane sáng tạo) ────────────────────────────────────────────────
  const personalRows =
    editorIds.length > 0
      ? await prisma.editorProductWarehouse.findMany({
          where: { month, editor_product: { user_id: { in: editorIds } } },
          select: {
            editor_product_id: true,
            target_quantity: true,
            editor_product: { select: { user_id: true } },
          },
        })
      : [];
  const personalProductIds = personalRows.map((r) => r.editor_product_id);
  const personalDoneRows =
    personalProductIds.length > 0
      ? await prisma.task.groupBy({
          by: ["editor_product_id", "assignee_id"],
          where: {
            assignee_id: { in: editorIds },
            editor_product_id: { in: personalProductIds },
            status: { not: "CANCELLED" },
            assigned_at: { gte: monthStart },
          },
          _count: { id: true },
        })
      : [];
  const personalDoneMap = new Map<string, number>(); // `${editorId}:${productId}` -> done
  for (const r of personalDoneRows) {
    personalDoneMap.set(`${r.assignee_id}:${r.editor_product_id}`, r._count.id);
  }

  const personalRemaining = new Map<string, Map<string, number>>();
  for (const row of personalRows) {
    const editorId = row.editor_product.user_id;
    const done = personalDoneMap.get(`${editorId}:${row.editor_product_id}`) ?? 0;
    if (!personalRemaining.has(editorId)) personalRemaining.set(editorId, new Map());
    personalRemaining
      .get(editorId)!
      .set(row.editor_product_id, Math.max(0, row.target_quantity - done));
  }

  return { teamRemaining, originOverride, personalRemaining };
}

/** Snapshot phần "còn hàng" của kho team theo góc nhìn của 1 editor cụ thể:
 *  editor gốc (nếu có override) dùng chỉ tiêu riêng, editor khác dùng chỉ tiêu chung. */
export function snapshotTeamProductRemaining(
  state: ProductQuotaState,
  editorId: string,
): Map<string, number> {
  const snap = new Map<string, number>();
  for (const [productId, remaining] of state.teamRemaining) {
    const override = state.originOverride.get(productId);
    snap.set(
      productId,
      override && override.editorId === editorId ? override.remaining : remaining,
    );
  }
  return snap;
}

/** Trừ dần state dùng chung sau khi 1 editor được chốt assignment trong lượt chạy này,
 *  để lượt xử lý editor kế tiếp thấy đúng phần còn lại. */
export function consumeProductQuota(
  state: ProductQuotaState,
  editorId: string,
  pairs: AssignmentPair[],
): void {
  for (const pair of pairs) {
    if (pair.productSource === "team") {
      state.teamRemaining.set(
        pair.productId,
        Math.max(0, (state.teamRemaining.get(pair.productId) ?? 0) - 1),
      );
      const override = state.originOverride.get(pair.productId);
      if (override && override.editorId === editorId) {
        override.remaining = Math.max(0, override.remaining - 1);
      }
    } else if (pair.productSource === "personal") {
      const personal = state.personalRemaining.get(editorId);
      if (personal?.has(pair.productId)) {
        personal.set(pair.productId, Math.max(0, personal.get(pair.productId)! - 1));
      }
    }
  }
}
