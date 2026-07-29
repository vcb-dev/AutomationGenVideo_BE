import { randomUUID } from "crypto";
import { Logger } from "@nestjs/common";
import { BrandType, Prisma } from "@prisma/client";
import { AssignmentPair, ScheduledAssignment } from "../types";
import { PrismaService } from "@/common/prisma/prisma.service";
import { PushService } from "@/common/push/push.service";

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

type PreparedTask = {
  id: string;
  editorId: string;
  data: Prisma.TaskCreateManyInput;
};

function notificationBody(deadline: Date): string {
  return `Bạn có task mới cần hoàn thành trước ${deadline.toLocaleDateString("vi-VN")}.`;
}

/**
 * Fallback best-effort: chỉ chạy khi batch createMany thất bại cả loạt (vd 1 assignment
 * trỏ tới content/product vừa bị xoá giữa lúc load pool và lúc ghi) — tạo tuần tự từng task
 * để những assignment hợp lệ vẫn được ghi, log/skip riêng assignment lỗi.
 */
async function createTasksSequentially(
  prisma: PrismaService,
  pushService: PushService,
  prepared: PreparedTask[],
  runId: string,
  deadline: Date,
): Promise<number> {
  let created = 0;
  for (const { id, editorId, data } of prepared) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.task.create({ data });
        await Promise.all([
          tx.taskAssignment.create({
            data: { task_id: id, user_id: editorId, deadline, run_id: runId },
          }),
          tx.notification.create({
            data: {
              user_id: editorId,
              type: "TASK_ASSIGNED",
              title: "Task mới được phân công tự động",
              body: notificationBody(deadline),
              task_id: id,
            },
          }),
        ]);
      });
      created++;
      pushService
        .sendToUser(editorId, {
          title: "Task mới được phân công tự động",
          body: notificationBody(deadline),
          url: "/dashboard/task-auto/tasks",
        })
        .catch(() => {});
    } catch (err) {
      logger.warn(
        `Failed to create task for editor=${editorId} (id=${id})`,
        err,
      );
    }
  }
  return created;
}

export async function createTasksFromAssignments(
  prisma: PrismaService,
  pushService: PushService,
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

  // Đợt 1: 2 lookup độc lập (personal product / team product) — chạy song song.
  const [editorProductInfoRaw, teamProductInfoRaw] = await Promise.all([
    personalProductIds.length > 0
      ? prisma.editorProduct.findMany({
          where: { id: { in: personalProductIds } },
          select: { id: true, source_product_id: true, user_id: true },
        })
      : Promise.resolve([]),
    teamProductIds.length > 0
      ? prisma.teamProduct.findMany({
          where: { id: { in: teamProductIds } },
          select: { id: true, source_product_id: true },
        })
      : Promise.resolve([]),
  ]);
  const editorProductSourceMap = new Map(
    editorProductInfoRaw.map((p) => [p.id, p.source_product_id]),
  );
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

  // Đợt 2: 3 lookup outro-source độc lập nhau (chỉ cùng phụ thuộc allGlobalProductIds vừa tính).
  const [editorOutroSources, teamOutroSources, globalOutroSources] =
    await Promise.all([
      editorIds.length > 0
        ? prisma.editorSource.findMany({
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
        : Promise.resolve([]),
      prisma.teamSource.findMany({
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
      }),
      allGlobalProductIds.length > 0
        ? prisma.source.findMany({
            where: {
              product_id: { in: allGlobalProductIds },
              type: "OUTRO",
              brand_type: brandType,
              is_active: true,
            },
            select: { product_id: true, id: true },
          })
        : Promise.resolve([]),
    ]);

  // Tính toàn bộ dữ liệu ghi trong bộ nhớ trước — không còn query nào trong vòng lặp.
  const prepared: PreparedTask[] = assignments.map(({ editorId, pair }) => {
    const id = randomUUID();
    return {
      id,
      editorId,
      data: {
        id,
        team_id: teamId,
        content_id: pair.contentSource === "global" ? pair.contentId : null,
        editor_content_id:
          pair.contentSource === "personal" ? pair.contentId : null,
        team_content_id:
          pair.contentSource === "team" ? pair.contentId : null,
        product_id: pair.productSource === "global" ? pair.productId : null,
        editor_product_id:
          pair.productSource === "personal" ? pair.productId : null,
        team_product_id:
          pair.productSource === "team" ? pair.productId : null,
        content_line_id: pair.contentLineId,
        product_line_id: pair.productLineId,
        // SP kho team = SP có kế hoạch đẩy video
        is_product_push: pair.productSource === "team",
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
        // AUTO chỉ dành cho lane đẩy SP theo kế hoạch; lane sáng tạo = EXTRA như task tạo tay
        task_type: pair.productSource === "team" ? "AUTO" : "EXTRA",
        run_id: runId,
      },
    };
  });

  // Ghi theo lô: 1 transaction cho toàn bộ team thay vì 1 transaction/assignment
  // (trước đây tốn N transaction tuần tự, chiếm hết connection pool trong lúc chạy).
  try {
    await prisma.$transaction(async (tx) => {
      await tx.task.createMany({ data: prepared.map((p) => p.data) });
      await Promise.all([
        tx.taskAssignment.createMany({
          data: prepared.map(({ id, editorId }) => ({
            task_id: id,
            user_id: editorId,
            deadline,
            run_id: runId,
          })),
        }),
        tx.notification.createMany({
          data: prepared.map(({ id, editorId }) => ({
            user_id: editorId,
            type: "TASK_ASSIGNED",
            title: "Task mới được phân công tự động",
            body: notificationBody(deadline),
            task_id: id,
          })),
        }),
      ]);
    });
    // Fire-and-forget: 1 push / editor duy nhất (không lặp theo từng task trong batch).
    for (const editorId of editorIds) {
      pushService
        .sendToUser(editorId, {
          title: "Task mới được phân công tự động",
          body: notificationBody(deadline),
          url: "/dashboard/task-auto/tasks",
        })
        .catch(() => {});
    }
    return prepared.length;
  } catch (err) {
    logger.warn(
      `Batch create failed for ${prepared.length} assignments in team=${teamId}, falling back to per-item creation: ${(err as Error).message}`,
    );
    return createTasksSequentially(prisma, pushService, prepared, runId, deadline);
  }
}
