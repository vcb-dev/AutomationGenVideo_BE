import { randomUUID } from "crypto";
import { Logger } from "@nestjs/common";
import { BrandType, Prisma } from "@prisma/client";
import { ScheduledAssignment, TeamProductCandidate } from "../types";
import { PrismaService } from "@/common/prisma/prisma.service";
import { PushService } from "@/common/push/push.service";

const logger = new Logger("TaskCreator");

function randItem<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Resolve outro source_id cho 1 SP kho team theo thứ tự ưu tiên:
 *   kho cá nhân (editor) → kho team → kho tổng (global)
 * Random trong mỗi tier. Tier cá nhân/tổng khớp qua product kho tổng tương ứng (source_product_id).
 */
function resolveOutroSourceId(
  product: TeamProductCandidate,
  editorId: string,
  editorOutroSources: {
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
): string | null {
  const canonicalProductId = product.source_product_id;

  // 1. Kho cá nhân (editor)
  const editorPick = randItem(
    editorOutroSources.filter(
      (s) =>
        s.user_id === editorId &&
        s.source_source_id != null &&
        canonicalProductId != null &&
        s.product_id === canonicalProductId,
    ),
  );
  if (editorPick) return editorPick.source_source_id!;

  // 2. Kho team
  const teamPick = randItem(
    teamOutroSources.filter(
      (s) =>
        s.source_source_id != null &&
        (s.team_product_id === product.id ||
          (canonicalProductId != null && s.product_id === canonicalProductId)),
    ),
  );
  if (teamPick) return teamPick.source_source_id!;

  // 3. Kho tổng (global)
  if (canonicalProductId != null) {
    const globalPick = randItem(
      globalOutroSources.filter((s) => s.product_id === canonicalProductId),
    );
    if (globalPick) return globalPick.id;
  }

  return null;
}

type PreparedTask = {
  id: string;
  editorId: string;
  data: Prisma.TaskCreateManyInput;
};

function notificationTitle(contentLineName: string): string {
  return `Task ${contentLineName} mới được phân công tự động`;
}

function notificationBody(deadline: Date): string {
  return `Bạn có task mới (đã gắn sản phẩm) cần hoàn thành trước ${deadline.toLocaleDateString("vi-VN")} — mở task để chọn content.`;
}

/**
 * Fallback best-effort: chỉ chạy khi batch createMany thất bại cả loạt (vd 1 SP vừa bị xoá giữa
 * lúc load kho và lúc ghi) — tạo tuần tự từng task để những assignment hợp lệ vẫn được ghi,
 * log/skip riêng assignment lỗi.
 */
async function createTasksSequentially(
  prisma: PrismaService,
  pushService: PushService,
  prepared: PreparedTask[],
  runId: string,
  deadline: Date,
  contentLineName: string,
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
              title: notificationTitle(contentLineName),
              body: notificationBody(deadline),
              task_id: id,
            },
          }),
        ]);
      });
      created++;
      pushService
        .sendToUser(editorId, {
          title: notificationTitle(contentLineName),
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

/**
 * Tạo task tự động: KHÔNG gắn content (editor tự chọn sau khi mở task), chỉ gắn SP kho team +
 * tuyến nội dung của lượt chia.
 */
export async function createTasksFromAssignments(
  prisma: PrismaService,
  pushService: PushService,
  teamId: string,
  brandType: BrandType,
  runId: string,
  deadline: Date,
  contentLine: { id: string; name: string },
  assignments: ScheduledAssignment[],
): Promise<number> {
  if (!assignments.length) return 0;

  const editorIds = [...new Set(assignments.map((a) => a.editorId))];
  const teamProductIds = [...new Set(assignments.map((a) => a.product.id))];
  const globalProductIds = [
    ...new Set(
      assignments
        .map((a) => a.product.source_product_id)
        .filter((id): id is string => !!id),
    ),
  ];

  const [editorOutroSources, teamOutroSources, globalOutroSources] =
    await Promise.all([
      globalProductIds.length > 0
        ? prisma.editorSource.findMany({
            where: {
              user_id: { in: editorIds },
              type: "OUTRO",
              brand_type: brandType,
              is_active: true,
              source_source_id: { not: null },
              product_id: { in: globalProductIds },
            },
            select: { product_id: true, source_source_id: true, user_id: true },
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
            { team_product_id: { in: teamProductIds } },
            ...(globalProductIds.length > 0
              ? [{ product_id: { in: globalProductIds } }]
              : []),
          ],
        },
        select: {
          team_product_id: true,
          product_id: true,
          source_source_id: true,
        },
      }),
      globalProductIds.length > 0
        ? prisma.source.findMany({
            where: {
              product_id: { in: globalProductIds },
              type: "OUTRO",
              brand_type: brandType,
              is_active: true,
            },
            select: { product_id: true, id: true },
          })
        : Promise.resolve([]),
    ]);

  // Tính toàn bộ dữ liệu ghi trong bộ nhớ trước — không còn query nào trong vòng lặp.
  const prepared: PreparedTask[] = assignments.map(({ editorId, product }) => {
    const id = randomUUID();
    return {
      id,
      editorId,
      data: {
        id,
        team_id: teamId,
        team_product_id: product.id,
        content_line_id: contentLine.id,
        product_line_id: product.product_line_id,
        // SP kho team = SP có kế hoạch đẩy video
        is_product_push: true,
        source_outro_id: resolveOutroSourceId(
          product,
          editorId,
          editorOutroSources,
          teamOutroSources,
          globalOutroSources,
        ),
        status: "ASSIGNED",
        assignee_id: editorId,
        assigned_at: new Date(),
        deadline,
        task_type: "AUTO",
        run_id: runId,
      },
    };
  });

  // Ghi theo lô: 1 transaction cho toàn bộ team thay vì 1 transaction/assignment.
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
            title: notificationTitle(contentLine.name),
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
          title: notificationTitle(contentLine.name),
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
    return createTasksSequentially(
      prisma,
      pushService,
      prepared,
      runId,
      deadline,
      contentLine.name,
    );
  }
}
