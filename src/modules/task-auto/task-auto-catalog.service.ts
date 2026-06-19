import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import {
  CreateProductDto,
  UpdateProductDto,
  QueryProductDto,
  CreateContentDto,
  UpdateContentDto,
  QueryContentDto,
  CreateSourceDto,
  UpdateSourceDto,
  QuerySourceDto,
} from "./dto/catalog.dto";

@Injectable()
export class TaskAutoCatalogService {
  constructor(private prisma: PrismaService) {}

  // ─── Products ─────────────────────────────────────────────────────────────

  async findAllProducts(q: QueryProductDto) {
    const where: any = {};
    if (q.search)
      where.OR = [
        { name: { contains: q.search, mode: "insensitive" } },
        { sku: { contains: q.search, mode: "insensitive" } },
      ];
    if (q.market) where.market = q.market;
    if (q.product_line_id) where.product_line_id = q.product_line_id;
    if (q.is_active !== undefined) where.is_active = q.is_active;
    if (q.team_id) where.team_products = { some: { team_id: q.team_id } };
    // owner filter
    if (q.owner === "global") where.user_id = null;
    else if (q.owner === "personal") where.user_id = { not: null };
    if (q.user_id) where.user_id = q.user_id;

    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          product_line: { select: { id: true, name: true } },
          material: { select: { id: true, name: true } },
          added_by: { select: { id: true, full_name: true } },
          _count: { select: { tasks: true } },
        },
        orderBy: [{ priority_score: "desc" }, { name: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOneProduct(id: string) {
    const p = await this.prisma.product.findUnique({
      where: { id },
      include: {
        product_line: true,
        material: true,
        added_by: { select: { id: true, full_name: true } },
        sources: { take: 10, orderBy: { created_at: "desc" } },
        _count: { select: { tasks: true } },
      },
    });
    if (!p) throw new NotFoundException("Product not found");
    return p;
  }

  async createProduct(dto: CreateProductDto, userId: string) {
    const exists = await this.prisma.product.findUnique({
      where: { sku: dto.sku },
    });
    if (exists) throw new ConflictException(`SKU "${dto.sku}" already exists`);
    return this.prisma.product.create({
      data: { ...dto, added_by_id: userId, user_id: dto.user_id ?? null },
      include: {
        product_line: true,
        material: true,
        owner_user: { select: { id: true, full_name: true } },
      },
    });
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    await this.findOneProduct(id);
    return this.prisma.product.update({
      where: { id },
      data: dto,
      include: { product_line: true, material: true },
    });
  }

  async removeProduct(id: string, requesterId?: string, roles?: string[]) {
    const product = await this.findOneProduct(id);
    const isPrivileged = roles?.some(r => ['ADMIN', 'MANAGER'].includes(r));
    if (!isPrivileged) {
      if (!product.user_id || product.user_id !== requesterId)
        throw new ForbiddenException('Bạn chỉ có thể xóa sản phẩm trong kho cá nhân của mình');
    }
    await this.prisma.product.delete({ where: { id } });
    return { success: true };
  }

  async findProductLines() {
    return this.prisma.productLine.findMany({ orderBy: { name: "asc" } });
  }

  async findMaterials() {
    return this.prisma.material.findMany({ orderBy: { name: "asc" } });
  }

  // ─── Contents ─────────────────────────────────────────────────────────────

  async findAllContents(q: QueryContentDto) {
    const where: any = {};
    if (q.content_line_id) where.content_line_id = q.content_line_id;
    if (q.status) where.status = q.status;
    if (q.market) where.market = q.market;
    if (q.search)
      where.OR = [
        { title: { contains: q.search, mode: "insensitive" } },
        { body: { contains: q.search, mode: "insensitive" } },
      ];
    if (q.owner === "global") where.user_id = null;
    else if (q.owner === "personal") where.user_id = { not: null };
    if (q.user_id) where.user_id = q.user_id;

    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const [data, total] = await Promise.all([
      this.prisma.content.findMany({
        where,
        include: {
          content_line: { select: { id: true, name: true } },
          added_by: { select: { id: true, full_name: true } },
        },
        orderBy: { created_at: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.content.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOneContent(id: string) {
    const c = await this.prisma.content.findUnique({
      where: { id },
      include: {
        content_line: true,
        added_by: { select: { id: true, full_name: true } },
      },
    });
    if (!c) throw new NotFoundException("Content not found");
    return c;
  }

  async createContent(dto: CreateContentDto, userId: string) {
    return this.prisma.content.create({
      data: {
        ...dto,
        added_by_id: userId,
        market: (dto.market ?? "VIETNAM") as any,
        user_id: dto.user_id ?? null,
      },
      include: {
        content_line: true,
        owner_user: { select: { id: true, full_name: true } },
      },
    });
  }

  // ─── Push to team ──────────────────────────────────────────────────────────

  async pushProductToTeam(productId: string, teamId: string, userId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundException("Product not found");
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException("Team not found");
    await this.prisma.teamProduct.upsert({
      where: { team_id_product_id: { team_id: teamId, product_id: productId } },
      create: { team_id: teamId, product_id: productId, added_by_id: userId },
      update: {},
    });
    return { success: true, product_id: productId, team_id: teamId };
  }

  async pushContentToTeam(contentId: string, teamId: string, userId: string) {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
    });
    if (!content) throw new NotFoundException("Content not found");
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException("Team not found");
    await this.prisma.teamContent.upsert({
      where: { team_id_content_id: { team_id: teamId, content_id: contentId } },
      create: { team_id: teamId, content_id: contentId, added_by_id: userId },
      update: {},
    });
    return { success: true, content_id: contentId, team_id: teamId };
  }

  async pushSourceToTeam(sourceId: string, teamId: string) {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
    });
    if (!source) throw new NotFoundException("Source not found");
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException("Team not found");
    return this.prisma.source.update({
      where: { id: sourceId },
      data: { team_id: teamId },
    });
  }

  async updateContent(id: string, dto: UpdateContentDto) {
    await this.findOneContent(id);
    return this.prisma.content.update({
      where: { id },
      data: dto as any,
      include: { content_line: true },
    });
  }

  async removeContent(id: string, requesterId?: string, roles?: string[]) {
    const c = await this.findOneContent(id);
    const isPrivileged = roles?.some(r => ['ADMIN', 'MANAGER'].includes(r));
    if (!isPrivileged) {
      if (!c.user_id || c.user_id !== requesterId)
        throw new ForbiddenException('Bạn chỉ có thể xóa content trong kho cá nhân của mình');
    }
    if (c.status === "IN_TASK")
      throw new ConflictException("Content is currently in use by a task");
    await this.prisma.content.delete({ where: { id } });
    return { success: true };
  }

  async findContentLines() {
    return this.prisma.contentLine.findMany({ orderBy: { name: "asc" } });
  }

  async createContentLine(name: string) {
    const exists = await this.prisma.contentLine.findUnique({ where: { name } });
    if (exists)
      throw new ConflictException(`ContentLine "${name}" already exists`);
    return this.prisma.contentLine.create({ data: { name } });
  }

  async updateContentLine(id: string, data: { a_type?: string | null }) {
    const cl = await this.prisma.contentLine.findUnique({ where: { id } });
    if (!cl) throw new NotFoundException("ContentLine not found");
    return this.prisma.contentLine.update({ where: { id }, data });
  }

  async removeContentLine(id: string) {
    const cl = await this.prisma.contentLine.findUnique({ where: { id } });
    if (!cl) throw new NotFoundException("ContentLine not found");
    await this.prisma.contentLine.delete({ where: { id } });
    return { success: true };
  }

  async createProductLine(name: string) {
    const exists = await this.prisma.productLine.findUnique({ where: { name } });
    if (exists)
      throw new ConflictException(`ProductLine "${name}" already exists`);
    return this.prisma.productLine.create({ data: { name } });
  }

  async updateProductLine(id: string, data: { video_category?: string | null }) {
    const pl = await this.prisma.productLine.findUnique({ where: { id } });
    if (!pl) throw new NotFoundException("ProductLine not found");
    return this.prisma.productLine.update({ where: { id }, data });
  }

  async removeProductLine(id: string) {
    const pl = await this.prisma.productLine.findUnique({ where: { id } });
    if (!pl) throw new NotFoundException("ProductLine not found");
    await this.prisma.productLine.delete({ where: { id } });
  }

  async createMaterial(name: string) {
    const exists = await this.prisma.material.findUnique({ where: { name } });
    if (exists)
      throw new ConflictException(`Material "${name}" already exists`);
    return this.prisma.material.create({ data: { name } });
  }

  async removeMaterial(id: string) {
    const m = await this.prisma.material.findUnique({ where: { id } });
    if (!m) throw new NotFoundException("Material not found");
    await this.prisma.material.delete({ where: { id } });
  }

  // ─── Sources ──────────────────────────────────────────────────────────────

  async findAllSources(q: QuerySourceDto) {
    const where: any = {};
    if (q.type) where.type = q.type;
    if (q.product_id) where.product_id = q.product_id;
    if (q.is_active !== undefined) where.is_active = q.is_active;
    if (q.search)
      where.OR = [
        { name: { contains: q.search, mode: "insensitive" } },
        { link: { contains: q.search, mode: "insensitive" } },
      ];

    // owner filter
    if (q.owner === "global") {
      where.team_id = null;
      where.user_id = null;
    } else if (q.owner === "team") {
      where.team_id = { not: null };
    } else if (q.owner === "editor") {
      where.user_id = { not: null };
    }
    // specific team/user filter (takes priority over owner)
    if (q.team_id) where.team_id = q.team_id;
    if (q.user_id) where.user_id = q.user_id;

    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const [data, total] = await Promise.all([
      this.prisma.source.findMany({
        where,
        include: {
          product: { select: { id: true, name: true } },
          team: { select: { id: true, name: true } },
          owner_user: { select: { id: true, full_name: true } },
          added_by: { select: { id: true, full_name: true } },
        },
        orderBy: { created_at: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.source.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOneSource(id: string) {
    const s = await this.prisma.source.findUnique({
      where: { id },
      include: {
        product: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
        owner_user: { select: { id: true, full_name: true } },
        added_by: { select: { id: true, full_name: true } },
      },
    });
    if (!s) throw new NotFoundException("Source not found");
    return s;
  }

  async createSource(dto: CreateSourceDto, userId: string) {
    return this.prisma.source.create({
      data: {
        ...dto,
        is_active: dto.is_active ?? true,
        added_by_id: userId,
        type: dto.type as any,
        team_id: dto.team_id ?? null,
        user_id: dto.user_id ?? null,
      },
      include: {
        product: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
        owner_user: { select: { id: true, full_name: true } },
      },
    });
  }

  async updateSource(id: string, dto: UpdateSourceDto) {
    await this.findOneSource(id);
    return this.prisma.source.update({
      where: { id },
      data: {
        ...dto,
        team_id: dto.team_id !== undefined ? (dto.team_id ?? null) : undefined,
        user_id: dto.user_id !== undefined ? (dto.user_id ?? null) : undefined,
      },
      include: {
        product: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
        owner_user: { select: { id: true, full_name: true } },
      },
    });
  }

  async removeSource(id: string, requesterId?: string, roles?: string[]) {
    const source = await this.findOneSource(id);
    const isPrivileged = roles?.some(r => ['ADMIN', 'MANAGER'].includes(r));
    if (!isPrivileged) {
      if (!source.user_id || source.user_id !== requesterId)
        throw new ForbiddenException('Bạn chỉ có thể xóa source trong kho cá nhân của mình');
    }
    await this.prisma.source.delete({ where: { id } });
    return { success: true };
  }
}
