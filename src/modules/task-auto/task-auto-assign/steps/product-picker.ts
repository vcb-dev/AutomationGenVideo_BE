import { DateTime } from "luxon";
import { BrandType, Prisma } from "@prisma/client";
import { AUTO_ASSIGN_PRODUCT_LINE_NAME, TeamProductCandidate } from "../types";
import { isOnCooldown } from "./cooldown";
import { PrismaService } from "@/common/prisma/prisma.service";
import { deadlineWindow } from "@/utils/task-auto/deadline-window.util";

const TEAM_PRODUCT_SELECT = {
  id: true,
  name: true,
  sku: true,
  oms_variant_id: true,
  product_line_id: true,
  priority_score: true,
  source_product_id: true,
  source_editor_product_id: true,
  // SP push từ kho editor không tự lưu data — lấy qua editor product gốc
  source_editor_product: {
    select: {
      name: true,
      sku: true,
      oms_variant_id: true,
      product_line_id: true,
      source_product_id: true,
    },
  },
} satisfies Prisma.TeamProductSelect;

type TeamProductRow = Prisma.TeamProductGetPayload<{ select: typeof TEAM_PRODUCT_SELECT }>;

export function toTeamProductCandidate(tp: TeamProductRow, targetQuantity = 0): TeamProductCandidate {
  const ep = tp.source_editor_product;
  return {
    id: tp.id,
    name: tp.name ?? ep?.name ?? null,
    product_line_id: tp.product_line_id ?? ep?.product_line_id ?? null,
    priority_score: tp.priority_score,
    target_quantity: targetQuantity,
    source_product_id: tp.source_product_id ?? ep?.source_product_id ?? null,
    sku: tp.sku ?? ep?.sku ?? null,
    oms_variant_id: tp.oms_variant_id ?? ep?.oms_variant_id ?? null,
    source_editor_product_id: tp.source_editor_product_id,
  };
}

/**
 * "Kho sản phẩm" của team (tab Kho sản phẩm) — SP đang bật, đúng brand của team, thuộc dòng GMV
 * (SP push từ kho editor chưa tự gắn dòng thì xét dòng của editor product gốc).
 */
export async function loadTeamProductPool(
  prisma: PrismaService,
  teamId: string,
  brandType: BrandType,
  month: string,
): Promise<TeamProductCandidate[]> {
  const autoAssignLine = {
    name: { equals: AUTO_ASSIGN_PRODUCT_LINE_NAME, mode: "insensitive" as const },
  };
  const rows = await prisma.teamProduct.findMany({
    where: {
      team_id: teamId,
      is_active: true,
      brand_type: brandType,
      priority_score: { gt: 0 },
      OR: [
        { product_line: autoAssignLine },
        { product_line_id: null, source_editor_product: { product_line: autoAssignLine } },
      ],
    },
    select: {
      ...TEAM_PRODUCT_SELECT,
      warehouses: {
        where: { month },
        select: { target_quantity: true },
        take: 1,
      },
    },
    orderBy: { priority_score: "desc" },
  });
  return rows.map((row) => toTeamProductCandidate(row, row.warehouses[0]?.target_quantity ?? 0));
}

// ── Nhận diện "cùng 1 SP" giữa kho team / kho cá nhân / kho tổng ───────────────────────────────

function identityKeys(
  sku: string | null | undefined,
  omsVariantId: string | null | undefined,
  globalProductId: string | null | undefined,
): string[] {
  const keys: string[] = [];
  const normalizedSku = sku?.trim().toLowerCase();
  if (normalizedSku) keys.push(`sku:${normalizedSku}`);
  if (omsVariantId) keys.push(`oms:${omsVariantId}`);
  if (globalProductId) keys.push(`gp:${globalProductId}`);
  return keys;
}

function teamProductKeys(c: TeamProductCandidate): string[] {
  return [
    `tp:${c.id}`,
    ...identityKeys(c.sku, c.oms_variant_id, c.source_product_id),
    ...(c.source_editor_product_id ? [`ep:${c.source_editor_product_id}`] : []),
  ];
}

/**
 * editorId -> (team_product_id trong `pool` -> assigned_at gần nhất) kể từ `since` — task chưa huỷ,
 * mọi tuyến, mọi team. Task gắn SP kho cá nhân/kho tổng cũng được tính nếu là cùng SP với SP kho
 * team (khớp id gốc, SKU, OMS variant hoặc product kho tổng) — cooldown là theo SP + người, không
 * theo kho mà task đó lấy SP.
 */
export async function loadLastAssignedByEditor(
  prisma: PrismaService,
  editorIds: string[],
  pool: TeamProductCandidate[],
  since: Date,
): Promise<Map<string, Map<string, Date>>> {
  const result = new Map<string, Map<string, Date>>();
  if (!editorIds.length || !pool.length) return result;

  const poolIdsByKey = new Map<string, string[]>();
  for (const c of pool) {
    for (const key of teamProductKeys(c)) {
      if (!poolIdsByKey.has(key)) poolIdsByKey.set(key, []);
      poolIdsByKey.get(key)!.push(c.id);
    }
  }

  const rows = await prisma.task.findMany({
    where: {
      assignee_id: { in: editorIds },
      status: { not: "CANCELLED" },
      assigned_at: { gte: since },
      OR: [
        { team_product_id: { not: null } },
        { editor_product_id: { not: null } },
        { product_id: { not: null } },
      ],
    },
    select: {
      assignee_id: true,
      assigned_at: true,
      team_product: { select: TEAM_PRODUCT_SELECT },
      editor_product: {
        select: { id: true, sku: true, oms_variant_id: true, source_product_id: true },
      },
      product: { select: { id: true, sku: true, source_team_product_id: true } },
    },
  });

  for (const r of rows) {
    if (!r.assignee_id || !r.assigned_at) continue;
    const keys = [
      ...(r.team_product ? teamProductKeys(toTeamProductCandidate(r.team_product)) : []),
      ...(r.editor_product
        ? [
            `ep:${r.editor_product.id}`,
            ...identityKeys(
              r.editor_product.sku,
              r.editor_product.oms_variant_id,
              r.editor_product.source_product_id,
            ),
          ]
        : []),
      ...(r.product
        ? [
            ...identityKeys(r.product.sku, null, r.product.id),
            ...(r.product.source_team_product_id
              ? [`tp:${r.product.source_team_product_id}`]
              : []),
          ]
        : []),
    ];
    const matched = new Set(keys.flatMap((k) => poolIdsByKey.get(k) ?? []));
    if (!matched.size) continue;

    if (!result.has(r.assignee_id)) result.set(r.assignee_id, new Map());
    const byProduct = result.get(r.assignee_id)!;
    for (const productId of matched) {
      const prev = byProduct.get(productId);
      if (!prev || prev < r.assigned_at) byProduct.set(productId, r.assigned_at);
    }
  }
  return result;
}

/**
 * Đếm số task chưa huỷ của từng sản phẩm team trong tháng kế hoạch. Task gắn sản phẩm từ kho
 * cá nhân/kho tổng vẫn được tính nếu nhận diện là cùng sản phẩm (SKU/OMS/global id), giống luật
 * cooldown. Dùng deadline làm tháng kế hoạch; task cũ không có deadline dùng created_at.
 */
export async function loadMonthlyProductCounts(
  prisma: PrismaService,
  teamId: string,
  pool: TeamProductCandidate[],
  monthStart: Date,
  monthEnd: Date,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!pool.length) return counts;

  const poolIdsByKey = new Map<string, string[]>();
  for (const candidate of pool) {
    for (const key of teamProductKeys(candidate)) {
      if (!poolIdsByKey.has(key)) poolIdsByKey.set(key, []);
      poolIdsByKey.get(key)!.push(candidate.id);
    }
  }

  const rows = await prisma.task.findMany({
    where: {
      team_id: teamId,
      status: { not: "CANCELLED" },
      ...deadlineWindow({ gte: monthStart, lt: monthEnd }),
      AND: [{
        OR: [
          { team_product_id: { not: null } },
          { editor_product_id: { not: null } },
          { product_id: { not: null } },
        ],
      }],
    },
    select: {
      team_product: { select: TEAM_PRODUCT_SELECT },
      editor_product: {
        select: { id: true, sku: true, oms_variant_id: true, source_product_id: true },
      },
      product: { select: { id: true, sku: true, source_team_product_id: true } },
    },
  });

  for (const row of rows) {
    const keys = [
      ...(row.team_product ? teamProductKeys(toTeamProductCandidate(row.team_product)) : []),
      ...(row.editor_product
        ? [
            `ep:${row.editor_product.id}`,
            ...identityKeys(
              row.editor_product.sku,
              row.editor_product.oms_variant_id,
              row.editor_product.source_product_id,
            ),
          ]
        : []),
      ...(row.product
        ? [
            ...identityKeys(row.product.sku, null, row.product.id),
            ...(row.product.source_team_product_id
              ? [`tp:${row.product.source_team_product_id}`]
              : []),
          ]
        : []),
    ];
    const matched = new Set(keys.flatMap((key) => poolIdsByKey.get(key) ?? []));
    for (const productId of matched) {
      counts.set(productId, (counts.get(productId) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Chọn tối đa `need` SP khác nhau cho 1 editor. SP đang trong cooldown của editor này bị LOẠI HẲN
 * (luật cứng — kho không đủ SP ngoài cooldown thì giao thiếu, không lấy SP cooldown bù vào).
 * Trong số còn lại:
 *   1. SP có quota > 0 và chưa đủ được xếp trước, theo tỷ lệ hoàn thành quota thấp nhất
 *   2. SP quota = 0 được chia đều theo tổng task tháng (lane sau)
 *   3. priority_score cao hơn, rồi SP editor lâu chưa làm nhất là tiêu chí phụ
 * Không bao giờ lặp 1 SP trong cùng 1 lượt cho cùng editor.
 */
export function pickProductsForEditor(args: {
  pool: TeamProductCandidate[];
  need: number;
  lastAssigned: Map<string, Date>;
  monthlyAssigned: Map<string, number>;
  pickedInRun: Map<string, number>;
  cooldownDays: number;
  today: DateTime;
}): TeamProductCandidate[] {
  const { pool, need, lastAssigned, monthlyAssigned, pickedInRun, cooldownDays, today } =
    args;
  if (need <= 0) return [];

  return pool
    .filter((p) => {
      if (p.priority_score <= 0) return false;
      if (isOnCooldown(lastAssigned.get(p.id), cooldownDays, today)) return false;
      const assigned = (monthlyAssigned.get(p.id) ?? 0) + (pickedInRun.get(p.id) ?? 0);
      return p.target_quantity === 0 || assigned < p.target_quantity;
    })
    .map((p) => ({
      p,
      picked: pickedInRun.get(p.id) ?? 0,
      assigned: monthlyAssigned.get(p.id) ?? 0,
      last: lastAssigned.get(p.id)?.getTime() ?? 0,
    }))
    .sort(
      (a, b) => {
        const aTargeted = a.p.target_quantity > 0;
        const bTargeted = b.p.target_quantity > 0;
        if (aTargeted !== bTargeted) return aTargeted ? -1 : 1;

        const aTotal = a.assigned + a.picked;
        const bTotal = b.assigned + b.picked;
        if (aTargeted && bTargeted) {
          // So tỷ lệ bằng phép nhân chéo để tránh sai số số thực.
          const progress =
            aTotal * b.p.target_quantity - bTotal * a.p.target_quantity;
          if (progress !== 0) return progress;
        } else if (aTotal !== bTotal) {
          return aTotal - bTotal;
        }
        return (
          b.p.priority_score - a.p.priority_score ||
          a.last - b.last ||
          a.p.id.localeCompare(b.p.id)
        );
      },
    )
    .slice(0, need)
    .map((r) => r.p);
}
