import { Logger } from "@nestjs/common";
import { BrandType } from "@prisma/client";
import { AssignmentPair, ScheduledAssignment } from "../types";
import { PrismaService } from "@/common/prisma/prisma.service";

const logger = new Logger("TaskCreator");

function randItem<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Resolve outro source_id theo thứ tự ưu tiên:
 *   kho cá nhân (editor) → kho team → kho tổng (global)
 * Random trong mỗi tier.
 */
function resolveOutroSourceId(
  pair: AssignmentPair,
  editorId: string,
  editorOutroSources: {
    editor_product_id: string | null;
    product_id: string | null;
    source_source_id: string | null;
    user_id: string;
  }[],
  teamOutroSources: {
    team_product_id: string | null;
    product_id: string | null;
    source_source_id: string | null;
  }[],
  globalOutroSources: { product_id: string | null; id: string }[],
  editorProductSourceMap: Map<string, string | null>,
  teamProductSourceMap: Map<string, string | null>,
): string | null {
  // Canonical global product ID để tìm trong các kho
  let canonicalProductId: string | null = null;
  if (pair.productSource === "global") {
    canonicalProductId = pair.productId;
  } else if (pair.productSource === "personal") {
    canonicalProductId = editorProductSourceMap.get(pair.productId) ?? null;
  } else {
    canonicalProductId = teamProductSourceMap.get(pair.productId) ?? null;
  }

  // 1. Kho cá nhân (editor)
  const editorMatches = editorOutroSources.filter(
    (s) =>
      s.user_id === editorId &&
      s.source_source_id != null &&
      ((pair.productSource === "personal" &&
        s.editor_product_id === pair.productId) ||
        (canonicalProductId != null && s.product_id === canonicalProductId)),
  );
  const editorPick = randItem(editorMatches);
  if (editorPick) return editorPick.source_source_id!;

  // 2. Kho team
  const teamMatches = teamOutroSources.filter(
    (s) =>
      s.source_source_id != null &&
      ((pair.productSource === "team" &&
        s.team_product_id === pair.productId) ||
        (canonicalProductId != null && s.product_id === canonicalProductId)),
  );
  const teamPick = randItem(teamMatches);
  if (teamPick) return teamPick.source_source_id!;

  // 3. Kho tổng (global)
  if (canonicalProductId != null) {
    const globalMatches = globalOutroSources.filter(
      (s) => s.product_id === canonicalProductId,
    );
    const globalPick = randItem(globalMatches);
    if (globalPick) return globalPick.id;
  }

  return null;
}

export async function createTasksFromAssignments(
  prisma: PrismaService,
  teamId: string,
  brandType: BrandType,
  runId: string,
  deadline: Date,
  assignments: ScheduledAssignment[],
): Promise<number> {
  if (!assignments.length) return 0;

  const editorIds = [...new Set(assignments.map((a) => a.editorId))];

  const personalProductIds = [
    ...new Set(
      assignments
        .filter((a) => a.pair.productSource === "personal")
        .map((a) => a.pair.productId),
    ),
  ];
  const teamProductIds = [
    ...new Set(
      assignments
        .filter((a) => a.pair.productSource === "team")
        .map((a) => a.pair.productId),
    ),
  ];
  const globalProductIds = [
    ...new Set(
      assignments
        .filter((a) => a.pair.productSource === "global")
        .map((a) => a.pair.productId),
    ),
  ];

  const editorProductInfoRaw =
    personalProductIds.length > 0
      ? await prisma.editorProduct.findMany({
          where: { id: { in: personalProductIds } },
          select: { id: true, source_product_id: true, user_id: true },
        })
      : [];
  const editorProductSourceMap = new Map(
    editorProductInfoRaw.map((p) => [p.id, p.source_product_id]),
  );

  const teamProductInfoRaw =
    teamProductIds.length > 0
      ? await prisma.teamProduct.findMany({
          where: { id: { in: teamProductIds } },
          select: { id: true, source_product_id: true },
        })
      : [];
  const teamProductSourceMap = new Map(
    teamProductInfoRaw.map((p) => [p.id, p.source_product_id]),
  );

  const allGlobalProductIds = [
    ...new Set([
      ...globalProductIds,
      ...([...editorProductSourceMap.values()].filter(Boolean) as string[]),
      ...([...teamProductSourceMap.values()].filter(Boolean) as string[]),
    ]),
  ];

  const editorOutroSources =
    editorIds.length > 0
      ? await prisma.editorSource.findMany({
          where: {
            user_id: { in: editorIds },
            type: "OUTRO",
            brand_type: brandType,
            is_active: true,
            source_source_id: { not: null },
            OR: [
              ...(personalProductIds.length > 0
                ? [{ editor_product_id: { in: personalProductIds } }]
                : []),
              ...(allGlobalProductIds.length > 0
                ? [{ product_id: { in: allGlobalProductIds } }]
                : []),
            ],
          },
          select: {
            editor_product_id: true,
            product_id: true,
            source_source_id: true,
            user_id: true,
          },
        })
      : [];

  const teamOutroSources = await prisma.teamSource.findMany({
    where: {
      team_id: teamId,
      type: "OUTRO",
      brand_type: brandType,
      is_active: true,
      source_source_id: { not: null },
      OR: [
        ...(teamProductIds.length > 0
          ? [{ team_product_id: { in: teamProductIds } }]
          : []),
        ...(allGlobalProductIds.length > 0
          ? [{ product_id: { in: allGlobalProductIds } }]
          : []),
      ],
    },
    select: {
      team_product_id: true,
      product_id: true,
      source_source_id: true,
    },
  });

  const globalOutroSources =
    allGlobalProductIds.length > 0
      ? await prisma.source.findMany({
          where: {
            product_id: { in: allGlobalProductIds },
            type: "OUTRO",
            brand_type: brandType,
            is_active: true,
          },
          select: { product_id: true, id: true },
        })
      : [];

  let created = 0;

  for (const { editorId, pair } of assignments) {
    try {
      await prisma.$transaction(async (tx) => {
        const task = await tx.task.create({
          data: {
            team_id: teamId,
            content_id:
              pair.contentSource === "global" ? pair.contentId : null,
            editor_content_id:
              pair.contentSource === "personal" ? pair.contentId : null,
            team_content_id:
              pair.contentSource === "team" ? pair.contentId : null,
            product_id:
              pair.productSource === "global" ? pair.productId : null,
            editor_product_id:
              pair.productSource === "personal" ? pair.productId : null,
            team_product_id:
              pair.productSource === "team" ? pair.productId : null,
            content_line_id: pair.contentLineId,
            source_outro_id: resolveOutroSourceId(
              pair,
              editorId,
              editorOutroSources,
              teamOutroSources,
              globalOutroSources,
              editorProductSourceMap,
              teamProductSourceMap,
            ),
            status: "ASSIGNED",
            assignee_id: editorId,
            assigned_at: new Date(),
            deadline,
            task_type: "AUTO",
            run_id: runId,
          },
        });

        await tx.taskAssignment.create({
          data: {
            task_id: task.id,
            user_id: editorId,
            deadline,
            run_id: runId,
          },
        });

        await tx.notification.create({
          data: {
            user_id: editorId,
            type: "TASK_ASSIGNED",
            title: "Task mới được phân công tự động",
            body: `Bạn có task mới cần hoàn thành trước ${deadline.toLocaleDateString("vi-VN")}.`,
            task_id: task.id,
          },
        });

        created++;
      });
    } catch (err) {
      logger.warn(
        `Failed to create task for editor=${editorId} content=${pair.contentId}(${pair.contentSource}) product=${pair.productId}(${pair.productSource})`,
        err,
      );
    }
  }

  return created;
}
