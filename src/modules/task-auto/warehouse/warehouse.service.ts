import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DateTime } from "luxon";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  AddToWarehouseDto,
  AddProductsToWarehouseDto,
  UpdateWarehouseQuantityDto,
  RemoveFromWarehouseDto,
  PushToMonthDto,
  AutoCarryDto,
} from "./warehouse.dto";
import { BrandType } from "../catalog/catalog.dto";

function prevMonth(month: string): string {
  const dt = DateTime.fromFormat(month, "yyyy-MM");
  return dt.minus({ months: 1 }).toFormat("yyyy-MM");
}

function normalizeProductItems(
  dto: AddProductsToWarehouseDto,
): { id: string; target_quantity: number }[] {
  if (dto.items?.length) {
    return dto.items.map((i) => ({ id: i.id, target_quantity: i.target_quantity ?? 1 }));
  }
  return (dto.ids ?? []).map((id) => ({ id, target_quantity: 1 }));
}

@Injectable()
export class TaskAutoWarehouseService {
  private readonly logger = new Logger(TaskAutoWarehouseService.name);

  constructor(private prisma: PrismaService) {}

  // ── Kho tổng (Global) ────────────────────────────────────────────────────

  async getGlobalWarehouse(month: string, brandType?: BrandType) {
    const brandFilter = brandType ? { brand_type: brandType } : {};
    const [products, contents, sources] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          is_active: true,
          warehouses: { some: { month } },
          ...brandFilter,
        },
        include: {
          source_team_product: {
            select: {
              sku: true, name: true, image_url: true, image_urls: true,
              price: true, market: true, price_segment: true, material_id: true,
              source_editor_product: { select: { sku: true, name: true, image_url: true, image_urls: true, price: true, market: true, price_segment: true, material_id: true } },
            },
          },
        },
        orderBy: { created_at: "desc" },
      }),
      this.prisma.content.findMany({
        where: {
          status: { not: "ARCHIVED" },
          warehouses: { some: { month } },
          ...brandFilter,
        },
        include: {
          source_team_content: {
            select: {
              title: true, body: true, script: true, file_content_url: true, voice_url: true, content_line_id: true,
              source_editor_content: { select: { title: true, body: true, script: true, file_content_url: true, voice_url: true, content_line_id: true } },
            },
          },
        },
        orderBy: { created_at: "desc" },
      }),
      this.prisma.source.findMany({
        where: {
          is_active: true,
          warehouses: { some: { month } },
          ...brandFilter,
        },
        include: {
          source_team_source: {
            select: {
              type: true, name: true, link: true, nas_link: true, code: true, product_id: true,
              source_editor_source: { select: { type: true, name: true, link: true, nas_link: true, code: true, product_id: true } },
            },
          },
        },
        orderBy: { created_at: "desc" },
      }),
    ]);
    return { month, products, contents, sources };
  }

  async addGlobalProducts(dto: AddToWarehouseDto) {
    return this.prisma.productWarehouse.createMany({
      data: dto.ids.map((id) => ({ product_id: id, month: dto.month })),
      skipDuplicates: true,
    });
  }

  async removeGlobalProducts(dto: RemoveFromWarehouseDto) {
    return this.prisma.productWarehouse.deleteMany({
      where: { product_id: { in: dto.ids }, month: dto.month },
    });
  }

  async addGlobalContents(dto: AddToWarehouseDto) {
    return this.prisma.contentWarehouse.createMany({
      data: dto.ids.map((id) => ({ content_id: id, month: dto.month })),
      skipDuplicates: true,
    });
  }

  async removeGlobalContents(dto: RemoveFromWarehouseDto) {
    return this.prisma.contentWarehouse.deleteMany({
      where: { content_id: { in: dto.ids }, month: dto.month },
    });
  }

  async addGlobalSources(dto: AddToWarehouseDto) {
    return this.prisma.sourceWarehouse.createMany({
      data: dto.ids.map((id) => ({ source_id: id, month: dto.month })),
      skipDuplicates: true,
    });
  }

  async removeGlobalSources(dto: RemoveFromWarehouseDto) {
    return this.prisma.sourceWarehouse.deleteMany({
      where: { source_id: { in: dto.ids }, month: dto.month },
    });
  }

  // ── Kho team ────────────────────────────────────────────────────────────

  async getTeamWarehouse(teamId: string, month: string) {
    const [products, contents, sources] = await Promise.all([
      this.prisma.teamProduct.findMany({
        where: { team_id: teamId, is_active: true, warehouses: { some: { month } } },
        include: {
          source_editor_product: { select: { sku: true, name: true, image_url: true, image_urls: true, price: true, market: true, price_segment: true, material_id: true } },
          warehouses: { where: { month }, select: { target_quantity: true } },
        },
        orderBy: { added_at: "desc" },
      }),
      this.prisma.teamContent.findMany({
        where: { team_id: teamId, status: { not: "ARCHIVED" }, warehouses: { some: { month } } },
        include: {
          source_editor_content: { select: { title: true, body: true, script: true, file_content_url: true, voice_url: true, content_line_id: true } },
        },
        orderBy: { added_at: "desc" },
      }),
      this.prisma.teamSource.findMany({
        where: { team_id: teamId, is_active: true, warehouses: { some: { month } } },
        include: {
          source_editor_source: { select: { type: true, name: true, link: true, nas_link: true, code: true, product_id: true } },
        },
        orderBy: { added_at: "desc" },
      }),
    ]);
    return { team_id: teamId, month, products, contents, sources };
  }

  async addTeamProducts(teamId: string, dto: AddProductsToWarehouseDto) {
    const items = normalizeProductItems(dto);
    const ids = items.map((i) => i.id);
    const count = await this.prisma.teamProduct.count({
      where: { id: { in: ids }, team_id: teamId },
    });
    if (count !== ids.length)
      throw new BadRequestException("Một số product không thuộc team này");

    return this.prisma.teamProductWarehouse.createMany({
      data: items.map((i) => ({
        team_product_id: i.id,
        month: dto.month,
        target_quantity: i.target_quantity,
      })),
      skipDuplicates: true,
    });
  }

  async updateTeamProductQuantity(teamId: string, dto: UpdateWarehouseQuantityDto) {
    const ids = dto.items.map((i) => i.id);
    const count = await this.prisma.teamProduct.count({
      where: { id: { in: ids }, team_id: teamId },
    });
    if (count !== ids.length)
      throw new BadRequestException("Một số product không thuộc team này");

    await this.prisma.$transaction(
      dto.items.map((i) =>
        this.prisma.teamProductWarehouse.upsert({
          where: { team_product_id_month: { team_product_id: i.id, month: dto.month } },
          create: { team_product_id: i.id, month: dto.month, target_quantity: i.target_quantity },
          update: { target_quantity: i.target_quantity },
        }),
      ),
    );
    return { updated: dto.items.length };
  }

  async removeTeamProducts(teamId: string, dto: RemoveFromWarehouseDto) {
    const owned = await this.prisma.teamProduct.findMany({
      where: { id: { in: dto.ids }, team_id: teamId },
      select: { id: true },
    });
    const ownedIds = owned.map((p) => p.id);
    return this.prisma.teamProductWarehouse.deleteMany({
      where: { team_product_id: { in: ownedIds }, month: dto.month },
    });
  }

  async addTeamContents(teamId: string, dto: AddToWarehouseDto) {
    const count = await this.prisma.teamContent.count({
      where: { id: { in: dto.ids }, team_id: teamId },
    });
    if (count !== dto.ids.length)
      throw new BadRequestException("Một số content không thuộc team này");

    return this.prisma.teamContentWarehouse.createMany({
      data: dto.ids.map((id) => ({ team_content_id: id, month: dto.month })),
      skipDuplicates: true,
    });
  }

  async removeTeamContents(teamId: string, dto: RemoveFromWarehouseDto) {
    const owned = await this.prisma.teamContent.findMany({
      where: { id: { in: dto.ids }, team_id: teamId },
      select: { id: true },
    });
    const ownedIds = owned.map((c) => c.id);
    return this.prisma.teamContentWarehouse.deleteMany({
      where: { team_content_id: { in: ownedIds }, month: dto.month },
    });
  }

  async addTeamSources(teamId: string, dto: AddToWarehouseDto) {
    const count = await this.prisma.teamSource.count({
      where: { id: { in: dto.ids }, team_id: teamId },
    });
    if (count !== dto.ids.length)
      throw new BadRequestException("Một số source không thuộc team này");

    return this.prisma.teamSourceWarehouse.createMany({
      data: dto.ids.map((id) => ({ team_source_id: id, month: dto.month })),
      skipDuplicates: true,
    });
  }

  async removeTeamSources(teamId: string, dto: RemoveFromWarehouseDto) {
    const owned = await this.prisma.teamSource.findMany({
      where: { id: { in: dto.ids }, team_id: teamId },
      select: { id: true },
    });
    const ownedIds = owned.map((s) => s.id);
    return this.prisma.teamSourceWarehouse.deleteMany({
      where: { team_source_id: { in: ownedIds }, month: dto.month },
    });
  }

  // ── Push team: copy kho from_month → to_month (giữ nguyên from_month) ───

  async pushTeamToMonth(teamId: string, dto: PushToMonthDto) {
    const { from_month, to_month, ids } = dto;
    if (from_month === to_month)
      throw new BadRequestException("from_month và to_month không được trùng nhau");

    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException("Team không tồn tại");

    const [products, contents, sources] = await Promise.all([
      this.prisma.teamProductWarehouse.findMany({
        where: {
          month: from_month,
          team_product: { team_id: teamId, ...(ids ? { id: { in: ids } } : {}) },
        },
        select: { team_product_id: true, target_quantity: true },
      }),
      this.prisma.teamContentWarehouse.findMany({
        where: {
          month: from_month,
          team_content: { team_id: teamId, ...(ids ? { id: { in: ids } } : {}) },
        },
        select: { team_content_id: true },
      }),
      this.prisma.teamSourceWarehouse.findMany({
        where: {
          month: from_month,
          team_source: { team_id: teamId, ...(ids ? { id: { in: ids } } : {}) },
        },
        select: { team_source_id: true },
      }),
    ]);

    const [p, c, s] = await Promise.all([
      this.prisma.teamProductWarehouse.createMany({
        data: products.map((r) => ({
          team_product_id: r.team_product_id,
          month: to_month,
          target_quantity: r.target_quantity,
        })),
        skipDuplicates: true,
      }),
      this.prisma.teamContentWarehouse.createMany({
        data: contents.map((r) => ({ team_content_id: r.team_content_id, month: to_month })),
        skipDuplicates: true,
      }),
      this.prisma.teamSourceWarehouse.createMany({
        data: sources.map((r) => ({ team_source_id: r.team_source_id, month: to_month })),
        skipDuplicates: true,
      }),
    ]);

    this.logger.log(
      `Team ${teamId}: pushed ${p.count} products, ${c.count} contents, ${s.count} sources ` +
        `from ${from_month} → ${to_month}`,
    );

    return {
      from_month,
      to_month,
      pushed: { products: p.count, contents: c.count, sources: s.count },
    };
  }

  // ── Kho editor ───────────────────────────────────────────────────────────

  async getEditorWarehouse(editorId: string, month: string) {
    const [products, contents, sources] = await Promise.all([
      this.prisma.editorProduct.findMany({
        where: { user_id: editorId, is_active: true, warehouses: { some: { month } } },
        include: {
          warehouses: { where: { month }, select: { target_quantity: true } },
        },
        orderBy: { added_at: "desc" },
      }),
      this.prisma.editorContent.findMany({
        where: { user_id: editorId, status: { not: "ARCHIVED" }, warehouses: { some: { month } } },
        orderBy: { added_at: "desc" },
      }),
      this.prisma.editorSource.findMany({
        where: { user_id: editorId, is_active: true, warehouses: { some: { month } } },
        include: {
          source_source: { select: { type: true, name: true, link: true } },
        },
        orderBy: { added_at: "desc" },
      }),
    ]);
    return { editor_id: editorId, month, products, contents, sources };
  }

  async addEditorProducts(editorId: string, dto: AddProductsToWarehouseDto) {
    const items = normalizeProductItems(dto);
    return this.prisma.editorProductWarehouse.createMany({
      data: items.map((i) => ({
        editor_product_id: i.id,
        month: dto.month,
        target_quantity: i.target_quantity,
      })),
      skipDuplicates: true,
    });
  }

  async updateEditorProductQuantity(editorId: string, dto: UpdateWarehouseQuantityDto) {
    const ids = dto.items.map((i) => i.id);
    const owned = await this.prisma.editorProduct.findMany({
      where: { id: { in: ids }, user_id: editorId },
      select: { id: true },
    });
    if (owned.length !== ids.length)
      throw new BadRequestException("Một số product không thuộc kho cá nhân này");

    await this.prisma.$transaction(
      dto.items.map((i) =>
        this.prisma.editorProductWarehouse.upsert({
          where: { editor_product_id_month: { editor_product_id: i.id, month: dto.month } },
          create: { editor_product_id: i.id, month: dto.month, target_quantity: i.target_quantity },
          update: { target_quantity: i.target_quantity },
        }),
      ),
    );
    return { updated: dto.items.length };
  }

  async removeEditorProducts(editorId: string, dto: RemoveFromWarehouseDto) {
    const owned = await this.prisma.editorProduct.findMany({
      where: { id: { in: dto.ids }, user_id: editorId },
      select: { id: true },
    });
    return this.prisma.editorProductWarehouse.deleteMany({
      where: { editor_product_id: { in: owned.map((p) => p.id) }, month: dto.month },
    });
  }

  async addEditorContents(editorId: string, dto: AddToWarehouseDto) {
    return this.prisma.editorContentWarehouse.createMany({
      data: dto.ids.map((id) => ({ editor_content_id: id, month: dto.month })),
      skipDuplicates: true,
    });
  }

  async removeEditorContents(editorId: string, dto: RemoveFromWarehouseDto) {
    const owned = await this.prisma.editorContent.findMany({
      where: { id: { in: dto.ids }, user_id: editorId },
      select: { id: true },
    });
    return this.prisma.editorContentWarehouse.deleteMany({
      where: { editor_content_id: { in: owned.map((c) => c.id) }, month: dto.month },
    });
  }

  async addEditorSources(editorId: string, dto: AddToWarehouseDto) {
    return this.prisma.editorSourceWarehouse.createMany({
      data: dto.ids.map((id) => ({ editor_source_id: id, month: dto.month })),
      skipDuplicates: true,
    });
  }

  async removeEditorSources(editorId: string, dto: RemoveFromWarehouseDto) {
    const owned = await this.prisma.editorSource.findMany({
      where: { id: { in: dto.ids }, user_id: editorId },
      select: { id: true },
    });
    return this.prisma.editorSourceWarehouse.deleteMany({
      where: { editor_source_id: { in: owned.map((s) => s.id) }, month: dto.month },
    });
  }

  async pushEditorToMonth(editorId: string, dto: PushToMonthDto) {
    const { from_month, to_month, ids } = dto;
    if (from_month === to_month)
      throw new BadRequestException("from_month và to_month không được trùng nhau");

    const [products, contents, sources] = await Promise.all([
      this.prisma.editorProductWarehouse.findMany({
        where: {
          month: from_month,
          editor_product: { user_id: editorId, ...(ids ? { id: { in: ids } } : {}) },
        },
        select: { editor_product_id: true, target_quantity: true },
      }),
      this.prisma.editorContentWarehouse.findMany({
        where: {
          month: from_month,
          editor_content: { user_id: editorId, ...(ids ? { id: { in: ids } } : {}) },
        },
        select: { editor_content_id: true },
      }),
      this.prisma.editorSourceWarehouse.findMany({
        where: {
          month: from_month,
          editor_source: { user_id: editorId, ...(ids ? { id: { in: ids } } : {}) },
        },
        select: { editor_source_id: true },
      }),
    ]);

    const [p, c, s] = await Promise.all([
      this.prisma.editorProductWarehouse.createMany({
        data: products.map((r) => ({
          editor_product_id: r.editor_product_id,
          month: to_month,
          target_quantity: r.target_quantity,
        })),
        skipDuplicates: true,
      }),
      this.prisma.editorContentWarehouse.createMany({
        data: contents.map((r) => ({ editor_content_id: r.editor_content_id, month: to_month })),
        skipDuplicates: true,
      }),
      this.prisma.editorSourceWarehouse.createMany({
        data: sources.map((r) => ({ editor_source_id: r.editor_source_id, month: to_month })),
        skipDuplicates: true,
      }),
    ]);

    this.logger.log(
      `Editor ${editorId}: pushed ${p.count} products, ${c.count} contents, ${s.count} sources ` +
        `from ${from_month} → ${to_month}`,
    );

    return {
      from_month,
      to_month,
      pushed: { products: p.count, contents: c.count, sources: s.count },
    };
  }

  // ── Cron: tự động auto-carry vào ngày 1 hàng tháng lúc 01:00 ───────────

  @Cron("0 1 1 * *", { name: "warehouse-auto-carry", timeZone: "Asia/Ho_Chi_Minh" })
  async cronAutoCarry() {
    const now = DateTime.now().setZone("Asia/Ho_Chi_Minh");
    const month = now.toFormat("yyyy-MM");
    this.logger.log(`Cron auto-carry: target month=${month}`);
    try {
      const result = await this.autoCarry({ month });
      this.logger.log(`Cron auto-carry done: ${JSON.stringify(result)}`);
    } catch (err) {
      this.logger.error("Cron auto-carry failed", err);
    }
  }

  // ── Auto-carry: copy kho tháng trước → tháng mới ────────────────────────

  async autoCarry(dto: AutoCarryDto): Promise<{
    global?: { products: number; contents: number; sources: number };
    editors?: Record<string, { products: number; contents: number; sources: number }>;
  }> {
    const { month, tier, editor_id } = dto;
    const from = prevMonth(month);
    const result: any = {};

    if (!tier || tier === "global") {
      result.global = await this.carryGlobal(from, month);
    }

    if (!tier || tier === "editor") {
      if (editor_id) {
        const r = await this.carryEditorItems(editor_id, from, month);
        result.editors = { [editor_id]: r };
      } else {
        result.editors = await this.carryAllEditors(from, month);
      }
    }

    return result;
  }

  private async carryGlobal(from: string, to: string) {
    const [existingP, existingC, existingS] = await Promise.all([
      this.prisma.productWarehouse.count({ where: { month: to } }),
      this.prisma.contentWarehouse.count({ where: { month: to } }),
      this.prisma.sourceWarehouse.count({ where: { month: to } }),
    ]);

    const [fromP, fromC, fromS] = await Promise.all([
      existingP === 0
        ? this.prisma.productWarehouse.findMany({ where: { month: from }, select: { product_id: true } })
        : [],
      existingC === 0
        ? this.prisma.contentWarehouse.findMany({ where: { month: from }, select: { content_id: true } })
        : [],
      existingS === 0
        ? this.prisma.sourceWarehouse.findMany({ where: { month: from }, select: { source_id: true } })
        : [],
    ]);

    const [p, c, s] = await Promise.all([
      fromP.length > 0
        ? this.prisma.productWarehouse.createMany({
            data: fromP.map((r) => ({ product_id: r.product_id, month: to })),
            skipDuplicates: true,
          })
        : { count: 0 },
      fromC.length > 0
        ? this.prisma.contentWarehouse.createMany({
            data: fromC.map((r) => ({ content_id: r.content_id, month: to })),
            skipDuplicates: true,
          })
        : { count: 0 },
      fromS.length > 0
        ? this.prisma.sourceWarehouse.createMany({
            data: fromS.map((r) => ({ source_id: r.source_id, month: to })),
            skipDuplicates: true,
          })
        : { count: 0 },
    ]);

    this.logger.log(
      `Auto-carry global: ${from} → ${to}: products=${p.count} contents=${c.count} sources=${s.count}`,
    );
    return { products: p.count, contents: c.count, sources: s.count };
  }

  private async carryEditorItems(editorId: string, from: string, to: string) {
    const [existingP, existingC, existingS] = await Promise.all([
      this.prisma.editorProductWarehouse.count({
        where: { month: to, editor_product: { user_id: editorId } },
      }),
      this.prisma.editorContentWarehouse.count({
        where: { month: to, editor_content: { user_id: editorId } },
      }),
      this.prisma.editorSourceWarehouse.count({
        where: { month: to, editor_source: { user_id: editorId } },
      }),
    ]);

    const [fromP, fromC, fromS] = await Promise.all([
      existingP === 0
        ? this.prisma.editorProductWarehouse.findMany({
            where: { month: from, editor_product: { user_id: editorId } },
            select: { editor_product_id: true, target_quantity: true },
          })
        : [],
      existingC === 0
        ? this.prisma.editorContentWarehouse.findMany({
            where: { month: from, editor_content: { user_id: editorId } },
            select: { editor_content_id: true },
          })
        : [],
      existingS === 0
        ? this.prisma.editorSourceWarehouse.findMany({
            where: { month: from, editor_source: { user_id: editorId } },
            select: { editor_source_id: true },
          })
        : [],
    ]);

    const [p, c, s] = await Promise.all([
      fromP.length > 0
        ? this.prisma.editorProductWarehouse.createMany({
            data: fromP.map((r) => ({
              editor_product_id: r.editor_product_id,
              month: to,
              target_quantity: r.target_quantity,
            })),
            skipDuplicates: true,
          })
        : { count: 0 },
      fromC.length > 0
        ? this.prisma.editorContentWarehouse.createMany({
            data: fromC.map((r) => ({ editor_content_id: r.editor_content_id, month: to })),
            skipDuplicates: true,
          })
        : { count: 0 },
      fromS.length > 0
        ? this.prisma.editorSourceWarehouse.createMany({
            data: fromS.map((r) => ({ editor_source_id: r.editor_source_id, month: to })),
            skipDuplicates: true,
          })
        : { count: 0 },
    ]);

    return { products: p.count, contents: c.count, sources: s.count };
  }

  private async carryAllEditors(from: string, to: string) {
    const [editorProductIds, editorContentIds, editorSourceIds] = await Promise.all([
      this.prisma.editorProductWarehouse.findMany({
        where: { month: from },
        select: { editor_product: { select: { user_id: true } } },
        distinct: [],
      }),
      this.prisma.editorContentWarehouse.findMany({
        where: { month: from },
        select: { editor_content: { select: { user_id: true } } },
      }),
      this.prisma.editorSourceWarehouse.findMany({
        where: { month: from },
        select: { editor_source: { select: { user_id: true } } },
      }),
    ]);

    const allEditorIds = new Set([
      ...editorProductIds.map((r) => r.editor_product.user_id),
      ...editorContentIds.map((r) => r.editor_content.user_id),
      ...editorSourceIds.map((r) => r.editor_source.user_id),
    ]);

    const results: Record<string, { products: number; contents: number; sources: number }> = {};
    for (const editorId of allEditorIds) {
      results[editorId] = await this.carryEditorItems(editorId, from, to);
    }

    this.logger.log(
      `Auto-carry editors: ${from} → ${to}: ${allEditorIds.size} editors processed`,
    );
    return results;
  }
}
