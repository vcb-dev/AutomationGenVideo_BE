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
  CreateEditorProductDto,
  UpdateEditorProductDto,
  QueryEditorProductDto,
  CreateEditorContentDto,
  UpdateEditorContentDto,
  QueryEditorContentDto,
  CreateEditorSourceDto,
  UpdateEditorSourceDto,
  QueryEditorSourceDto,
} from "./dto/catalog.dto";

@Injectable()
export class TaskAutoCatalogService {
  constructor(private prisma: PrismaService) {}

  // ─── Products (kho tổng) ──────────────────────────────────────────────────

  async findAllProducts(q: QueryProductDto) {
    const where: any = {};
    if (q.brand_type) where.brand_type = q.brand_type;
    if (q.search)
      where.OR = [
        { name: { contains: q.search, mode: "insensitive" } },
        { sku: { contains: q.search, mode: "insensitive" } },
      ];
    if (q.market) where.market = q.market;
    if (q.product_line_id) where.product_line_id = q.product_line_id;
    if (q.is_active !== undefined) where.is_active = q.is_active;
    // team_id filter removed: global Product has no team_products relation

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
      data: { ...dto, added_by_id: userId },
      include: {
        product_line: true,
        material: true,
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

  async removeProduct(id: string, roles?: string[]) {
    await this.findOneProduct(id);
    const isPrivileged = roles?.some(r => ['ADMIN', 'MANAGER'].includes(r));
    if (!isPrivileged)
      throw new ForbiddenException('Chỉ ADMIN/MANAGER mới có thể xóa sản phẩm trong kho tổng');
    await this.prisma.product.delete({ where: { id } });
    return { success: true };
  }

  async findProductLines(brandType?: string) {
    return this.prisma.productLine.findMany({
      where: brandType ? { brand_type: brandType as any } : undefined,
      orderBy: { name: "asc" },
    });
  }

  async findMaterials(brandType?: string) {
    return this.prisma.material.findMany({
      where: brandType ? { brand_type: brandType as any } : undefined,
      orderBy: { name: "asc" },
    });
  }

  // ─── Contents (kho tổng) ─────────────────────────────────────────────────

  async findAllContents(q: QueryContentDto) {
    const where: any = {};
    if (q.brand_type) where.brand_type = q.brand_type;
    if (q.content_line_id) where.content_line_id = q.content_line_id;
    if (q.status) where.status = q.status;
    if (q.market) where.market = q.market;
    if (q.search)
      where.OR = [
        { title: { contains: q.search, mode: "insensitive" } },
        { body: { contains: q.search, mode: "insensitive" } },
      ];
    if (q.team_id) where.team_contents = { some: { team_id: q.team_id } };

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
      },
      include: {
        content_line: true,
      },
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

  async removeContent(id: string, roles?: string[]) {
    const c = await this.findOneContent(id);
    const isPrivileged = roles?.some(r => ['ADMIN', 'MANAGER'].includes(r));
    if (!isPrivileged)
      throw new ForbiddenException('Chỉ ADMIN/MANAGER mới có thể xóa content trong kho tổng');
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

  async createProductLine(name: string, brandType: string) {
    const exists = await this.prisma.productLine.findUnique({
      where: { name_brand_type: { name, brand_type: brandType as any } },
    });
    if (exists)
      throw new ConflictException(`ProductLine "${name}" already exists for this brand`);
    return this.prisma.productLine.create({ data: { name, brand_type: brandType as any } });
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

  async createMaterial(name: string, brandType: string) {
    const exists = await this.prisma.material.findUnique({
      where: { name_brand_type: { name, brand_type: brandType as any } },
    });
    if (exists)
      throw new ConflictException(`Material "${name}" already exists for this brand`);
    return this.prisma.material.create({ data: { name, brand_type: brandType as any } });
  }

  async removeMaterial(id: string) {
    const m = await this.prisma.material.findUnique({ where: { id } });
    if (!m) throw new NotFoundException("Material not found");
    await this.prisma.material.delete({ where: { id } });
  }

  // ─── Sources (kho tổng) ───────────────────────────────────────────────────

  async findAllSources(q: QuerySourceDto) {
    const where: any = {};
    if (q.brand_type) where.brand_type = q.brand_type;
    if (q.type) where.type = q.type;
    if (q.product_id) where.product_id = q.product_id;
    if (q.is_active !== undefined) where.is_active = q.is_active;
    if (q.search)
      where.OR = [
        { name: { contains: q.search, mode: "insensitive" } },
        { link: { contains: q.search, mode: "insensitive" } },
      ];

    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const [data, total] = await Promise.all([
      this.prisma.source.findMany({
        where,
        include: {
          product:  { select: { id: true, name: true } },
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
        product:  { select: { id: true, name: true } },
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
        is_active:   dto.is_active ?? true,
        added_by_id: userId,
        type:        dto.type as any,
      },
      include: {
        product: { select: { id: true, name: true } },
      },
    });
  }

  async updateSource(id: string, dto: UpdateSourceDto) {
    await this.findOneSource(id);
    return this.prisma.source.update({
      where: { id },
      data: dto,
      include: {
        product: { select: { id: true, name: true } },
      },
    });
  }

  async removeSource(id: string, roles?: string[]) {
    await this.findOneSource(id);
    const isPrivileged = roles?.some(r => ['ADMIN', 'MANAGER'].includes(r));
    if (!isPrivileged)
      throw new ForbiddenException('Chỉ ADMIN/MANAGER mới có thể xóa source trong kho tổng');
    await this.prisma.source.delete({ where: { id } });
    return { success: true };
  }

  // ─── Editor Products (kho cá nhân) ───────────────────────────────────────

  async findAllEditorProducts(userId: string, q: QueryEditorProductDto) {
    const where: any = { user_id: userId };
    if (q.brand_type) where.brand_type = q.brand_type;
    if (q.market) where.market = q.market;
    if (q.product_line_id) where.product_line_id = q.product_line_id;
    if (q.is_active !== undefined) where.is_active = q.is_active;
    if (q.search)
      where.OR = [
        { name: { contains: q.search, mode: "insensitive" } },
        { sku: { contains: q.search, mode: "insensitive" } },
      ];

    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const [data, total] = await Promise.all([
      this.prisma.editorProduct.findMany({
        where,
        include: {
          product_line: { select: { id: true, name: true } },
          material:     { select: { id: true, name: true } },
          added_by:     { select: { id: true, full_name: true } },
        },
        orderBy: [{ priority_score: "desc" }, { name: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.editorProduct.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOneEditorProduct(id: string) {
    const p = await this.prisma.editorProduct.findUnique({
      where: { id },
      include: {
        product_line:  true,
        material:      true,
        added_by:      { select: { id: true, full_name: true } },
        user:          { select: { id: true, full_name: true } },
        editor_sources: { take: 10, orderBy: { added_at: "desc" } },
      },
    });
    if (!p) throw new NotFoundException("EditorProduct not found");
    return p;
  }

  async createEditorProduct(userId: string, dto: CreateEditorProductDto) {
    if (dto.source_product_id) {
      const src = await this.prisma.product.findUnique({ where: { id: dto.source_product_id } });
      if (!src) throw new NotFoundException("Source product not found");
      return this.prisma.editorProduct.create({
        data: {
          user_id:           userId,
          added_by_id:       userId,
          source_product_id: src.id,
          sku:               dto.sku ?? src.sku,
          name:              dto.name ?? src.name,
          brand_type:        (dto.brand_type ?? src.brand_type) as any,
          image_url:         dto.image_url ?? src.image_url,
          image_urls:        dto.image_urls ?? src.image_urls,
          price:             dto.price !== undefined ? dto.price : (src.price as any),
          market:            dto.market ?? src.market,
          price_segment:     dto.price_segment ?? src.price_segment,
          priority_score:    dto.priority_score ?? src.priority_score,
          material_id:       dto.material_id ?? src.material_id,
          product_line_id:   dto.product_line_id ?? src.product_line_id,
          is_active:         dto.is_active ?? true,
        },
        include: { product_line: true, material: true },
      });
    }

    return this.prisma.editorProduct.create({
      data: {
        user_id:         userId,
        added_by_id:     userId,
        sku:             dto.sku ?? `EP-${Date.now()}`,
        name:            dto.name ?? '',
        brand_type:      (dto.brand_type ?? 'DO_DA') as any,
        image_url:       dto.image_url,
        image_urls:      dto.image_urls ?? [],
        price:           dto.price as any,
        market:          dto.market,
        price_segment:   dto.price_segment,
        priority_score:  dto.priority_score ?? 0,
        material_id:     dto.material_id,
        product_line_id: dto.product_line_id,
        is_active:       dto.is_active ?? true,
      },
      include: { product_line: true, material: true },
    });
  }

  async updateEditorProduct(id: string, dto: UpdateEditorProductDto, requesterId: string, roles: string[]) {
    const ep = await this.findOneEditorProduct(id);
    const isPrivileged = roles.some(r => ['ADMIN', 'MANAGER'].includes(r));
    if (!isPrivileged && ep.user_id !== requesterId)
      throw new ForbiddenException('Bạn chỉ có thể sửa sản phẩm trong kho cá nhân của mình');
    return this.prisma.editorProduct.update({
      where: { id },
      data: dto as any,
      include: { product_line: true, material: true },
    });
  }

  async removeEditorProduct(id: string, requesterId: string, roles: string[]) {
    const ep = await this.findOneEditorProduct(id);
    const isPrivileged = roles.some(r => ['ADMIN', 'MANAGER'].includes(r));
    if (!isPrivileged && ep.user_id !== requesterId)
      throw new ForbiddenException('Bạn chỉ có thể xóa sản phẩm trong kho cá nhân của mình');
    await this.prisma.editorProduct.delete({ where: { id } });
    return { success: true };
  }

  async pushEditorProductToGlobal(id: string, requesterId: string, roles: string[]) {
    const ep = await this.findOneEditorProduct(id);
    const isPrivileged = roles.some(r => ['ADMIN', 'MANAGER'].includes(r));
    if (!isPrivileged && ep.user_id !== requesterId)
      throw new ForbiddenException('Không có quyền push sản phẩm này');
    const exists = await this.prisma.product.findUnique({ where: { sku: ep.sku } });
    if (exists) throw new ConflictException(`SKU "${ep.sku}" đã tồn tại trong kho tổng`);
    const global = await this.prisma.product.create({
      data: {
        sku:             ep.sku,
        name:            ep.name,
        brand_type:      ep.brand_type,
        image_url:       ep.image_url,
        image_urls:      ep.image_urls,
        price:           ep.price as any,
        market:          ep.market,
        price_segment:   ep.price_segment,
        priority_score:  ep.priority_score,
        material_id:     ep.material_id,
        product_line_id: ep.product_line_id,
        is_active:       ep.is_active,
        added_by_id:     requesterId,
      },
    });
    return { success: true, global_product_id: global.id };
  }

  // ─── Editor Contents (kho cá nhân) ───────────────────────────────────────

  async findAllEditorContents(userId: string, q: QueryEditorContentDto) {
    const where: any = { user_id: userId };
    if (q.brand_type) where.brand_type = q.brand_type;
    if (q.content_line_id) where.content_line_id = q.content_line_id;
    if (q.status) where.status = q.status;
    if (q.market) where.market = q.market;
    if (q.search)
      where.OR = [
        { title: { contains: q.search, mode: "insensitive" } },
        { body: { contains: q.search, mode: "insensitive" } },
      ];

    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const [data, total] = await Promise.all([
      this.prisma.editorContent.findMany({
        where,
        include: {
          content_line: { select: { id: true, name: true } },
          added_by:     { select: { id: true, full_name: true } },
        },
        orderBy: { added_at: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.editorContent.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOneEditorContent(id: string) {
    const c = await this.prisma.editorContent.findUnique({
      where: { id },
      include: {
        content_line: true,
        added_by:     { select: { id: true, full_name: true } },
        user:         { select: { id: true, full_name: true } },
      },
    });
    if (!c) throw new NotFoundException("EditorContent not found");
    return c;
  }

  async createEditorContent(userId: string, dto: CreateEditorContentDto) {
    if (dto.source_content_id) {
      const src = await this.prisma.content.findUnique({ where: { id: dto.source_content_id } });
      if (!src) throw new NotFoundException("Source content not found");
      return this.prisma.editorContent.create({
        data: {
          user_id:           userId,
          added_by_id:       userId,
          source_content_id: src.id,
          brand_type:        (dto.brand_type ?? src.brand_type) as any,
          market:            dto.market ?? (src.market as string),
          title:             dto.title ?? src.title,
          body:              dto.body ?? src.body,
          script:            dto.script ?? src.script,
          file_content_url:  dto.file_content_url ?? src.file_content_url,
          voice_url:         dto.voice_url ?? src.voice_url,
          content_line_id:   dto.content_line_id ?? src.content_line_id,
        },
        include: { content_line: true },
      });
    }

    return this.prisma.editorContent.create({
      data: {
        user_id:          userId,
        added_by_id:      userId,
        brand_type:       (dto.brand_type ?? 'DO_DA') as any,
        market:           dto.market ?? 'VIETNAM',
        title:            dto.title,
        body:             dto.body,
        script:           dto.script,
        file_content_url: dto.file_content_url,
        voice_url:        dto.voice_url,
        content_line_id:  dto.content_line_id,
      },
      include: { content_line: true },
    });
  }

  async updateEditorContent(id: string, dto: UpdateEditorContentDto, requesterId: string, roles: string[]) {
    const ec = await this.findOneEditorContent(id);
    const isPrivileged = roles.some(r => ['ADMIN', 'MANAGER'].includes(r));
    if (!isPrivileged && ec.user_id !== requesterId)
      throw new ForbiddenException('Bạn chỉ có thể sửa content trong kho cá nhân của mình');
    return this.prisma.editorContent.update({
      where: { id },
      data: dto as any,
      include: { content_line: true },
    });
  }

  async removeEditorContent(id: string, requesterId: string, roles: string[]) {
    const ec = await this.findOneEditorContent(id);
    const isPrivileged = roles.some(r => ['ADMIN', 'MANAGER'].includes(r));
    if (!isPrivileged && ec.user_id !== requesterId)
      throw new ForbiddenException('Bạn chỉ có thể xóa content trong kho cá nhân của mình');
    if (ec.status === 'IN_TASK')
      throw new ConflictException('Content đang được dùng trong task');
    await this.prisma.editorContent.delete({ where: { id } });
    return { success: true };
  }

  async pushEditorContentToGlobal(id: string, requesterId: string, roles: string[]) {
    const ec = await this.findOneEditorContent(id);
    const isPrivileged = roles.some(r => ['ADMIN', 'MANAGER'].includes(r));
    if (!isPrivileged && ec.user_id !== requesterId)
      throw new ForbiddenException('Không có quyền push content này');
    const global = await this.prisma.content.create({
      data: {
        brand_type:       ec.brand_type,
        market:           ec.market as any,
        title:            ec.title,
        body:             ec.body,
        script:           ec.script,
        file_content_url: ec.file_content_url,
        voice_url:        ec.voice_url,
        content_line_id:  ec.content_line_id,
        added_by_id:      requesterId,
      },
    });
    return { success: true, global_content_id: global.id };
  }

  // ─── Editor Sources (kho cá nhân) ────────────────────────────────────────

  async findAllEditorSources(userId: string, q: QueryEditorSourceDto) {
    const where: any = { user_id: userId };
    if (q.brand_type) where.brand_type = q.brand_type;
    if (q.type) where.type = q.type;
    if (q.product_id) where.product_id = q.product_id;
    if (q.editor_product_id) where.editor_product_id = q.editor_product_id;
    if (q.is_active !== undefined) where.is_active = q.is_active;
    if (q.search)
      where.OR = [
        { name: { contains: q.search, mode: "insensitive" } },
        { link: { contains: q.search, mode: "insensitive" } },
      ];

    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const [data, total] = await Promise.all([
      this.prisma.editorSource.findMany({
        where,
        include: {
          product:        { select: { id: true, name: true } },
          editor_product: { select: { id: true, name: true } },
          added_by:       { select: { id: true, full_name: true } },
        },
        orderBy: { added_at: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.editorSource.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOneEditorSource(id: string) {
    const s = await this.prisma.editorSource.findUnique({
      where: { id },
      include: {
        product:        { select: { id: true, name: true } },
        editor_product: { select: { id: true, name: true } },
        added_by:       { select: { id: true, full_name: true } },
        user:           { select: { id: true, full_name: true } },
      },
    });
    if (!s) throw new NotFoundException("EditorSource not found");
    return s;
  }

  async createEditorSource(userId: string, dto: CreateEditorSourceDto) {
    if (dto.source_source_id) {
      const src = await this.prisma.source.findUnique({ where: { id: dto.source_source_id } });
      if (!src) throw new NotFoundException("Source not found");
      return this.prisma.editorSource.create({
        data: {
          user_id:          userId,
          added_by_id:      userId,
          source_source_id: src.id,
          brand_type:       (dto.brand_type ?? src.brand_type) as any,
          type:             (dto.type ?? src.type) as any,
          name:             dto.name ?? src.name,
          link:             dto.link ?? src.link,
          code:             dto.code ?? src.code,
          product_id:       dto.product_id ?? src.product_id,
          editor_product_id: dto.editor_product_id,
          is_active:        dto.is_active ?? true,
        },
        include: {
          product:        { select: { id: true, name: true } },
          editor_product: { select: { id: true, name: true } },
        },
      });
    }

    return this.prisma.editorSource.create({
      data: {
        user_id:           userId,
        added_by_id:       userId,
        brand_type:        (dto.brand_type ?? 'DO_DA') as any,
        type:              dto.type as any,
        name:              dto.name ?? '',
        link:              dto.link ?? '',
        code:              dto.code,
        product_id:        dto.product_id,
        editor_product_id: dto.editor_product_id,
        is_active:         dto.is_active ?? true,
      },
      include: {
        product:        { select: { id: true, name: true } },
        editor_product: { select: { id: true, name: true } },
      },
    });
  }

  async updateEditorSource(id: string, dto: UpdateEditorSourceDto, requesterId: string, roles: string[]) {
    const es = await this.findOneEditorSource(id);
    const isPrivileged = roles.some(r => ['ADMIN', 'MANAGER'].includes(r));
    if (!isPrivileged && es.user_id !== requesterId)
      throw new ForbiddenException('Bạn chỉ có thể sửa source trong kho cá nhân của mình');
    return this.prisma.editorSource.update({
      where: { id },
      data: dto as any,
      include: {
        product:        { select: { id: true, name: true } },
        editor_product: { select: { id: true, name: true } },
      },
    });
  }

  async removeEditorSource(id: string, requesterId: string, roles: string[]) {
    const es = await this.findOneEditorSource(id);
    const isPrivileged = roles.some(r => ['ADMIN', 'MANAGER'].includes(r));
    if (!isPrivileged && es.user_id !== requesterId)
      throw new ForbiddenException('Bạn chỉ có thể xóa source trong kho cá nhân của mình');
    await this.prisma.editorSource.delete({ where: { id } });
    return { success: true };
  }

  async pushEditorSourceToGlobal(id: string, requesterId: string, roles: string[]) {
    const es = await this.findOneEditorSource(id);
    const isPrivileged = roles.some(r => ['ADMIN', 'MANAGER'].includes(r));
    if (!isPrivileged && es.user_id !== requesterId)
      throw new ForbiddenException('Không có quyền push source này');
    const global = await this.prisma.source.create({
      data: {
        brand_type:  es.brand_type,
        type:        es.type,
        name:        es.name,
        link:        es.link,
        code:        es.code,
        product_id:  es.product_id,
        is_active:   es.is_active,
        added_by_id: requesterId,
      },
    });
    return { success: true, global_source_id: global.id };
  }

  // ─── Push to team (từ kho editor → kho team) ─────────────────────────────

  async pushEditorProductToTeam(editorProductId: string, teamId: string, userId: string) {
    const ep = await this.findOneEditorProduct(editorProductId);
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException("Team not found");
    if (ep.user_id !== userId)
      throw new ForbiddenException('Chỉ có thể push sản phẩm trong kho của mình');
    const existing = await this.prisma.teamProduct.findFirst({
      where: { team_id: teamId, sku: ep.sku },
    });
    if (existing) throw new ConflictException('Sản phẩm đã có trong kho team');

    const teamProduct = await this.prisma.teamProduct.create({
      data: {
        team_id:          teamId,
        added_by_id:      userId,
        sku:              ep.sku,
        name:             ep.name,
        brand_type:       ep.brand_type,
        image_url:        ep.image_url,
        image_urls:       ep.image_urls,
        price:            ep.price as any,
        market:           ep.market,
        price_segment:    ep.price_segment,
        priority_score:   ep.priority_score,
        material_id:      ep.material_id,
        product_line_id:  ep.product_line_id,
        is_active:        ep.is_active,
      },
    });

    const editorSources = await this.prisma.editorSource.findMany({
      where: { editor_product_id: editorProductId },
    });
    if (editorSources.length > 0) {
      await this.prisma.teamSource.createMany({
        data: editorSources.map(s => ({
          team_id:         teamId,
          added_by_id:     userId,
          brand_type:      s.brand_type,
          type:            s.type,
          name:            s.name,
          link:            s.link,
          code:            s.code,
          team_product_id: teamProduct.id,
          is_active:       s.is_active,
        })),
      });
    }

    return { success: true, editor_product_id: editorProductId, team_id: teamId };
  }

  async pushEditorContentToTeam(editorContentId: string, teamId: string, userId: string) {
    const ec = await this.findOneEditorContent(editorContentId);
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException("Team not found");
    if (ec.user_id !== userId)
      throw new ForbiddenException('Chỉ có thể push content trong kho của mình');
    const existing = await this.prisma.teamContent.findFirst({
      where: { team_id: teamId, content_line_id: ec.content_line_id },
    });
    if (existing) throw new ConflictException('Content đã có trong kho team');
    await this.prisma.teamContent.create({
      data: {
        team_id:          teamId,
        added_by_id:      userId,
        brand_type:       ec.brand_type,
        market:           ec.market,
        title:            ec.title,
        body:             ec.body,
        script:           ec.script,
        file_content_url: ec.file_content_url,
        voice_url:        ec.voice_url,
        content_line_id:  ec.content_line_id,
        source_content_id: ec.source_content_id,
      },
    });
    return { success: true, editor_content_id: editorContentId, team_id: teamId };
  }

  async pushEditorSourceToTeam(editorSourceId: string, teamId: string, userId: string) {
    const es = await this.findOneEditorSource(editorSourceId);
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException("Team not found");
    if (es.user_id !== userId)
      throw new ForbiddenException('Chỉ có thể push source trong kho của mình');
    const existing = await this.prisma.teamSource.findFirst({
      where: { team_id: teamId, source_source_id: es.source_source_id ?? undefined },
    });
    if (existing) throw new ConflictException('Source đã có trong kho team');
    return this.prisma.teamSource.create({
      data: {
        team_id:          teamId,
        added_by_id:      userId,
        source_source_id: es.source_source_id,
        brand_type:       es.brand_type,
        type:             es.type,
        name:             es.name,
        link:             es.link,
        code:             es.code,
        product_id:       es.product_id,
        is_active:        es.is_active,
      },
    });
  }
}
