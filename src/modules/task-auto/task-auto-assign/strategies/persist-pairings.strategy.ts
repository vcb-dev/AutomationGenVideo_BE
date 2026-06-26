import { Logger } from "@nestjs/common";
import { Candidate, Pairing } from "../types";
import { PrismaService } from "@/common/prisma/prisma.service";

const logger = new Logger("PersistPairings");

/**
 * Resolve outro source_id (phải là Source.id global) theo thứ tự ưu tiên:
 *   personal → team → global fallback
 */
function resolveOutro(
  candidate: Candidate,
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
  epSourceProductId: Map<string, string | null>,
  tpSourceProductId: Map<string, string | null>,
): string | null {
  if (candidate.productSource === "personal") {
    const byEpId = editorOutroSources.find(
      (s) =>
        s.editor_product_id === candidate.productId && s.user_id === editorId,
    );
    if (byEpId) return byEpId.source_source_id!;

    const spId = epSourceProductId.get(candidate.productId);
    if (spId) {
      const bySrcProd = editorOutroSources.find(
        (s) => s.product_id === spId && s.user_id === editorId,
      );
      if (bySrcProd) return bySrcProd.source_source_id!;
      return globalOutroSources.find((s) => s.product_id === spId)?.id ?? null;
    }
    return null;
  }

  if (candidate.productSource === "team") {
    const byTpId = teamOutroSources.find(
      (s) => s.team_product_id === candidate.productId,
    );
    if (byTpId) return byTpId.source_source_id!;

    const spId = tpSourceProductId.get(candidate.productId);
    if (spId) {
      const bySrcProd = teamOutroSources.find((s) => s.product_id === spId);
      if (bySrcProd) return bySrcProd.source_source_id!;
      return globalOutroSources.find((s) => s.product_id === spId)?.id ?? null;
    }
    return null;
  }

  // global product
  return (
    globalOutroSources.find((s) => s.product_id === candidate.productId)?.id ??
    null
  );
}

export async function persistPairings(
  prisma: PrismaService,
  teamId: string,
  runId: string,
  deadline: Date,
  pairings: Pairing[],
): Promise<number> {
  if (!pairings.length) return 0;

  const editorIds = [...new Set(pairings.map((p) => p.editorId))];

  const personalProductIds = [
    ...new Set(
      pairings
        .filter((p) => p.candidate.productSource === "personal")
        .map((p) => p.candidate.productId),
    ),
  ];
  const teamProductIds = [
    ...new Set(
      pairings
        .filter((p) => p.candidate.productSource === "team")
        .map((p) => p.candidate.productId),
    ),
  ];
  const globalProductIds = [
    ...new Set(
      pairings
        .filter((p) => p.candidate.productSource === "global")
        .map((p) => p.candidate.productId),
    ),
  ];

  // EditorProduct source mapping
  const editorProductInfoRaw =
    personalProductIds.length > 0
      ? await prisma.editorProduct.findMany({
          where: { id: { in: personalProductIds } },
          select: { id: true, source_product_id: true, user_id: true },
        })
      : [];
  const epSourceProductId = new Map(
    editorProductInfoRaw.map((p) => [p.id, p.source_product_id]),
  );

  // TeamProduct source mapping
  const teamProductInfoRaw =
    teamProductIds.length > 0
      ? await prisma.teamProduct.findMany({
          where: { id: { in: teamProductIds } },
          select: { id: true, source_product_id: true },
        })
      : [];
  const tpSourceProductId = new Map(
    teamProductInfoRaw.map((p) => [p.id, p.source_product_id]),
  );

  // EditorSource OUTRO
  const editorOutroSources =
    personalProductIds.length > 0
      ? await prisma.editorSource.findMany({
          where: {
            user_id: { in: editorIds },
            type: "OUTRO",
            is_active: true,
            source_source_id: { not: null },
            OR: [
              { editor_product_id: { in: personalProductIds } },
              ...(epSourceProductId.size > 0
                ? [
                    {
                      product_id: {
                        in: [
                          ...new Set(
                            [...epSourceProductId.values()].filter(
                              Boolean,
                            ) as string[],
                          ),
                        ],
                      },
                    },
                  ]
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

  // TeamSource OUTRO
  const teamOutroSources =
    teamProductIds.length > 0
      ? await prisma.teamSource.findMany({
          where: {
            team_id: teamId,
            type: "OUTRO",
            is_active: true,
            source_source_id: { not: null },
            OR: [
              { team_product_id: { in: teamProductIds } },
              ...(tpSourceProductId.size > 0
                ? [
                    {
                      product_id: {
                        in: [
                          ...new Set(
                            [...tpSourceProductId.values()].filter(
                              Boolean,
                            ) as string[],
                          ),
                        ],
                      },
                    },
                  ]
                : []),
            ],
          },
          select: {
            team_product_id: true,
            product_id: true,
            source_source_id: true,
          },
        })
      : [];

  // Global Source OUTRO
  const allOutroGlobalProductIds = [
    ...globalProductIds,
    ...([...epSourceProductId.values()].filter(Boolean) as string[]),
    ...([...tpSourceProductId.values()].filter(Boolean) as string[]),
  ];
  const globalOutroSources =
    allOutroGlobalProductIds.length > 0
      ? await prisma.source.findMany({
          where: {
            product_id: { in: [...new Set(allOutroGlobalProductIds)] },
            type: "OUTRO",
            is_active: true,
          },
          select: { product_id: true, id: true },
        })
      : [];

  let created = 0;

  for (const { editorId, candidate } of pairings) {
    try {
      await prisma.$transaction(async (tx) => {
        const task = await tx.task.create({
          data: {
            team_id: teamId,
            content_id:
              candidate.contentSource === "global" ? candidate.contentId : null,
            editor_content_id:
              candidate.contentSource === "personal"
                ? candidate.contentId
                : null,
            team_content_id:
              candidate.contentSource === "team" ? candidate.contentId : null,
            product_id:
              candidate.productSource === "global" ? candidate.productId : null,
            editor_product_id:
              candidate.productSource === "personal"
                ? candidate.productId
                : null,
            team_product_id:
              candidate.productSource === "team" ? candidate.productId : null,
            content_line_id: candidate.contentLineId,
            source_outro_id: resolveOutro(
              candidate,
              editorId,
              editorOutroSources,
              teamOutroSources,
              globalOutroSources,
              epSourceProductId,
              tpSourceProductId,
            ),
            status: "ASSIGNED",
            assignee_id: editorId,
            assigned_at: new Date(),
            deadline,
            is_auto: true,
            is_extra: false,
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
        `Failed to persist pairing editor=${editorId} content=${candidate.contentId}(${candidate.contentSource}) product=${candidate.productId}(${candidate.productSource})`,
        err,
      );
    }
  }

  return created;
}
