import { DateTime } from "luxon";
import { BrandType, Prisma } from "@prisma/client";
import { TeamProductCandidate } from "../types";
import { isOnCooldown } from "./cooldown";
import { PrismaService } from "@/common/prisma/prisma.service";

const TEAM_PRODUCT_SELECT = {
  id: true,
  name: true,
  sku: true,
  oms_variant_id: true,
  product_line_id: true,
  priority_score: true,
  cooldown_days: true,
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

function toCandidate(tp: TeamProductRow): TeamProductCandidate {
  const ep = tp.source_editor_product;
  return {
    id: tp.id,
    name: tp.name ?? ep?.name ?? null,
    product_line_id: tp.product_line_id ?? ep?.product_line_id ?? null,
    priority_score: tp.priority_score,
    cooldown_days: tp.cooldown_days,
    source_product_id: tp.source_product_id ?? ep?.source_product_id ?? null,
    sku: tp.sku ?? ep?.sku ?? null,
    oms_variant_id: tp.oms_variant_id ?? ep?.oms_variant_id ?? null,
    source_editor_product_id: tp.source_editor_product_id,
  };
}

/** "Kho sản phẩm" của team (tab Kho sản phẩm) — mọi SP đang bật, đúng brand của team. */
export async function loadTeamProductPool(
  prisma: PrismaService,
  teamId: string,
  brandType: BrandType,
): Promise<TeamProductCandidate[]> {
  const rows = await prisma.teamProduct.findMany({
    where: { team_id: teamId, is_active: true, brand_type: brandType },
    select: TEAM_PRODUCT_SELECT,
    orderBy: { priority_score: "desc" },
  });
  return rows.map(toCandidate);
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
      ...(r.team_product ? teamProductKeys(toCandidate(r.team_product)) : []),
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
 * Chọn tối đa `need` SP khác nhau cho 1 editor. SP đang trong cooldown của editor này bị LOẠI HẲN
 * (luật cứng — kho không đủ SP ngoài cooldown thì giao thiếu, không lấy SP cooldown bù vào).
 * Trong số còn lại, ưu tiên:
 *   1. SP ít được giao cho người khác trong CÙNG lượt chạy — rải đều SP cho cả team
 *   2. SP editor lâu chưa làm nhất (chưa từng làm lên đầu) — xoay vòng hết kho
 *   3. priority_score cao hơn
 * Không bao giờ lặp 1 SP trong cùng 1 lượt cho cùng editor.
 */
export function pickProductsForEditor(args: {
  pool: TeamProductCandidate[];
  need: number;
  lastAssigned: Map<string, Date>;
  pickedInRun: Map<string, number>;
  defaultCooldownDays: number;
  today: DateTime;
}): TeamProductCandidate[] {
  const { pool, need, lastAssigned, pickedInRun, defaultCooldownDays, today } =
    args;
  if (need <= 0) return [];

  return pool
    .filter(
      (p) => !isOnCooldown(p, lastAssigned.get(p.id), defaultCooldownDays, today),
    )
    .map((p) => ({
      p,
      picked: pickedInRun.get(p.id) ?? 0,
      last: lastAssigned.get(p.id)?.getTime() ?? 0,
    }))
    .sort(
      (a, b) =>
        a.picked - b.picked ||
        a.last - b.last ||
        b.p.priority_score - a.p.priority_score ||
        a.p.id.localeCompare(b.p.id),
    )
    .slice(0, need)
    .map((r) => r.p);
}
