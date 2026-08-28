import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { DateTime } from "luxon";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { PushService } from "../../../common/push/push.service";
import { TaskAutoTeamsService } from "../teams/teams.service";
import {
  resolveProductSnapshot,
  resolveContentSnapshot,
} from "../../../common/utils/catalog-resolve.util";
import {
  findProductBySku,
  findEditorProductBySku,
  backfillSourcesForNewGlobalProduct,
  backfillEditorSourcesForNewEditorProduct,
} from "../../../common/utils/catalog-link.util";
import { runOrNotFound } from "../../../common/utils/prisma-not-found.util";
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
  UpsertContentTranslationDto,
} from "./dto/catalog.dto";
import { AiIntegrationService } from "../../ai-integration/ai-integration.service";

@Injectable()
export class TaskAutoCatalogService {
  constructor(
    private prisma: PrismaService,
    private teamsService: TaskAutoTeamsService,
    private push: PushService,
    private aiIntegration: AiIntegrationService,
  ) {}

  private monthRange(month?: string, field = "created_at") {
    if (!month) return {};
    const [y, m] = month.split("-").map(Number);
    return { [field]: { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) } };
  }

  // ─── Products (kho tổng) ──────────────────────────────────────────────────

  async findAllProducts(q: QueryProductDto) {
    const where: any = {};
    if (q.brand_type) where.brand_type = q.brand_type;
    if (q.search) {
      // Sản phẩm được đẩy lên từ kho team/editor có sku/name rỗng ở bản ghi gốc —
      // dữ liệu thật nằm ở source_team_product (và xuyên tiếp source_editor_product).
      const contains = { contains: q.search, mode: "insensitive" as const };
      where.OR = [
        { name: contains },
        { sku: contains },
        { source_team_product: { name: contains } },
        { source_team_product: { sku: contains } },
        { source_team_product: { source_editor_product: { name: contains } } },
        { source_team_product: { source_editor_product: { sku: contains } } },
      ];
    }
    if (q.market) where.market = q.market;
    if (q.product_line_id) where.product_line_id = q.product_line_id;
    if (q.classification_id) where.classification_id = q.classification_id;
    if (q.is_active !== undefined) where.is_active = q.is_active;
    Object.assign(where, this.monthRange(q.month));

    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          product_line: { select: { id: true, name: true } },
          material: { select: { id: true, name: true } },
          classification: { select: { id: true, name: true } },
          added_by: { select: { id: true, full_name: true } },
          _count: { select: { tasks: true } },
          source_team_product: {
            select: {
              id: true,
              sku: true,
              name: true,
              image_url: true,
              image_urls: true,
              price: true,
              market: true,
              price_segment: true,
              priority_score: true,
              material: { select: { id: true, name: true } },
              product_line: { select: { id: true, name: true } },
              source_editor_product: {
                select: {
                  id: true,
                  sku: true,
                  name: true,
                  image_url: true,
                  image_urls: true,
                  price: true,
                  market: true,
                  price_segment: true,
                  priority_score: true,
                  material: { select: { id: true, name: true } },
                  product_line: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
        orderBy: [{ priority_score: "desc" }, { name: "asc" }, { id: "asc" }],
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
        classification: true,
        added_by: { select: { id: true, full_name: true } },
        sources: { take: 10, orderBy: { created_at: "desc" } },
        _count: { select: { tasks: true } },
        source_team_product: {
          select: {
            id: true,
            sku: true,
            name: true,
            image_url: true,
            image_urls: true,
            price: true,
            market: true,
            price_segment: true,
            priority_score: true,
            material: { select: { id: true, name: true } },
            product_line: { select: { id: true, name: true } },
            source_editor_product: {
              select: {
                id: true,
                sku: true,
                name: true,
                image_url: true,
                image_urls: true,
                price: true,
                market: true,
                price_segment: true,
                priority_score: true,
                material: { select: { id: true, name: true } },
                product_line: { select: { id: true, name: true } },
              },
            },
          },
        },
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
    const product = await this.prisma.product.create({
      data: { ...dto, added_by_id: userId },
      include: {
        product_line: true,
        material: true,
        classification: true,
      },
    });
    // Liên kết ngược mọi source (kho tổng/team/cá nhân) đang treo trùng mã sku này.
    await backfillSourcesForNewGlobalProduct(this.prisma, product.sku, product.id);
    return product;
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    return runOrNotFound(
      () =>
        this.prisma.product.update({
          where: { id },
          data: dto,
          include: { product_line: true, material: true, classification: true },
        }),
      "Product not found",
    );
  }

  async removeProduct(id: string, roles?: string[]) {
    const isPrivileged = roles?.some((r) => ["ADMIN", "MANAGER"].includes(r));
    if (!isPrivileged)
      throw new ForbiddenException(
        "Chỉ ADMIN/MANAGER mới có thể xóa sản phẩm trong kho tổng",
      );
    await runOrNotFound(
      () => this.prisma.product.delete({ where: { id } }),
      "Product not found",
    );
    return { success: true };
  }

  async findProductLines() {
    return this.prisma.productLine.findMany({
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
    // Sentinel "__unassigned__" (board theo tuyến ở FE) lọc content CHƯA gán tuyến — không thể
    // truyền content_line_id=null qua query string nên cần 1 giá trị đặc biệt riêng (giống
    // teams.service.ts listTeamContents).
    if (q.content_line_id === "__unassigned__") where.content_line_id = null;
    else if (q.content_line_id) where.content_line_id = q.content_line_id;
    if (q.classification_id) where.classification_id = q.classification_id;
    if (q.status) where.status = q.status;
    if (q.market) where.market = q.market;
    if (q.search) {
      // Content được đẩy lên từ kho team/editor có title/body rỗng ở bản ghi gốc —
      // dữ liệu thật nằm ở source_team_content (và xuyên tiếp source_editor_content).
      const contains = { contains: q.search, mode: "insensitive" as const };
      where.OR = [
        { title: contains },
        { body: contains },
        { code: contains },
        { source_team_content: { title: contains } },
        { source_team_content: { body: contains } },
        { source_team_content: { code: contains } },
        { source_team_content: { source_editor_content: { title: contains } } },
        { source_team_content: { source_editor_content: { body: contains } } },
        { source_team_content: { source_editor_content: { code: contains } } },
      ];
    }
    if (q.team_id) where.team_contents = { some: { team_id: q.team_id } };
    Object.assign(where, this.monthRange(q.month));

    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const [data, total] = await Promise.all([
      this.prisma.content.findMany({
        where,
        // select (không include) để bớt body/script — không hiện ở list/table nào, chỉ dùng ở
        // modal xem chi tiết/form sửa (xem findOneContent/updateContent).
        select: {
          id: true,
          brand_type: true,
          market: true,
          code: true,
          title: true,
          file_content_url: true,
          voice_url: true,
          content_line_id: true,
          classification_id: true,
          status: true,
          view_count: true,
          approved_content_id: true,
          added_by_id: true,
          lark_record_id: true,
          source_team_content_id: true,
          origin: true,
          created_at: true,
          updated_at: true,
          // "Số lần được làm" = số task đã tạo trực tiếp từ content kho tổng này (đếm sống,
          // giảm theo nếu task bị xoá) — mirror Product._count.tasks ở findAllProducts.
          _count: { select: { tasks: true } },
          content_line: { select: { id: true, name: true } },
          classification: { select: { id: true, name: true } },
          added_by: { select: { id: true, full_name: true } },
          source_team_content: {
            select: {
              id: true,
              code: true,
              title: true,
              market: true,
              file_content_url: true,
              voice_url: true,
              content_line: { select: { id: true, name: true } },
              source_editor_content: {
                select: {
                  id: true,
                  code: true,
                  title: true,
                  market: true,
                  file_content_url: true,
                  voice_url: true,
                  content_line: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
        orderBy: [{ created_at: "desc" }, { id: "asc" }],
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
        classification: true,
        added_by: { select: { id: true, full_name: true } },
        _count: { select: { tasks: true } },
        source_team_content: {
          select: {
            id: true,
            code: true,
            title: true,
            market: true,
            script: true,
            body: true,
            file_content_url: true,
            voice_url: true,
            content_line: { select: { id: true, name: true } },
            source_editor_content: {
              select: {
                id: true,
                code: true,
                title: true,
                market: true,
                script: true,
                body: true,
                file_content_url: true,
                voice_url: true,
                content_line: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!c) throw new NotFoundException("Content not found");
    return c;
  }

  async createContent(dto: CreateContentDto, userId: string) {
    if (dto.code) {
      const exists = await this.prisma.content.findUnique({
        where: { code: dto.code },
      });
      if (exists)
        throw new ConflictException(`Mã content "${dto.code}" đã tồn tại`);
    }
    return this.prisma.content.create({
      data: {
        ...dto,
        added_by_id: userId,
        market: (dto.market ?? "VIETNAM") as any,
      },
      include: {
        content_line: true,
        classification: true,
      },
    });
  }

  async updateContent(id: string, dto: UpdateContentDto) {
    if (dto.code) {
      const exists = await this.prisma.content.findUnique({
        where: { code: dto.code },
      });
      if (exists && exists.id !== id)
        throw new ConflictException(`Mã content "${dto.code}" đã tồn tại`);
    }
    return runOrNotFound(
      () =>
        this.prisma.content.update({
          where: { id },
          data: dto as any,
          include: { content_line: true, classification: true },
        }),
      "Content not found",
    );
  }

  async removeContent(id: string, roles?: string[]) {
    const isPrivileged = roles?.some((r) => ["ADMIN", "MANAGER"].includes(r));
    if (!isPrivileged)
      throw new ForbiddenException(
        "Chỉ ADMIN/MANAGER mới có thể xóa content trong kho tổng",
      );
    const c = await this.prisma.content.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!c) throw new NotFoundException("Content not found");
    if (c.status === "IN_TASK")
      throw new ConflictException("Content is currently in use by a task");
    await this.prisma.content.delete({ where: { id } });
    return { success: true };
  }

  // ─── Content Translations (bản dịch content theo thị trường) ──────────────

  private async assertContentExists(contentId: string) {
    const exists = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException("Content not found");
  }

  async getContentTranslations(contentId: string) {
    await this.assertContentExists(contentId);
    return this.prisma.contentTranslation.findMany({
      where: { content_id: contentId },
      include: { translated_by: { select: { id: true, full_name: true } } },
      orderBy: { market: "asc" },
    });
  }

  async upsertContentTranslation(
    contentId: string,
    dto: UpsertContentTranslationDto,
    userId: string,
  ) {
    await this.assertContentExists(contentId);
    return this.prisma.contentTranslation.upsert({
      where: { content_id_market: { content_id: contentId, market: dto.market } },
      update: {
        title: dto.title,
        body: dto.body,
        script: dto.script,
        translated_by_id: userId,
      },
      create: {
        content_id: contentId,
        market: dto.market,
        title: dto.title,
        body: dto.body,
        script: dto.script,
        translated_by_id: userId,
      },
      include: { translated_by: { select: { id: true, full_name: true } } },
    });
  }

  async deleteContentTranslation(contentId: string, market: string) {
    await runOrNotFound(
      () =>
        this.prisma.contentTranslation.delete({
          where: { content_id_market: { content_id: contentId, market } },
        }),
      "ContentTranslation not found",
    );
    return { success: true };
  }

  /** Dịch nháp title/body/script sang market đích — KHÔNG lưu DB, chỉ trả bản nháp. */
  async aiTranslateContent(contentId: string, market: string) {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: { title: true, body: true, script: true },
    });
    if (!content) throw new NotFoundException("Content not found");

    const translateField = async (text: string | null) => {
      if (!text) return null;
      const translated = await this.aiIntegration.translateVideoScript({
        content: text,
        hashtags: [],
        market,
      });
      return translated?.content ?? null;
    };

    const [title, body, script] = await Promise.all([
      translateField(content.title),
      translateField(content.body),
      translateField(content.script),
    ]);

    return { market, title, body, script };
  }

  async findContentLines() {
    return this.prisma.contentLine.findMany({ orderBy: { name: "asc" } });
  }

  async createContentLine(name: string) {
    const exists = await this.prisma.contentLine.findUnique({
      where: { name },
    });
    if (exists)
      throw new ConflictException(`ContentLine "${name}" already exists`);
    return this.prisma.contentLine.create({ data: { name } });
  }

  async updateContentLine(id: string, data: { a_type?: string | null }) {
    return runOrNotFound(
      () => this.prisma.contentLine.update({ where: { id }, data }),
      "ContentLine not found",
    );
  }

  async removeContentLine(id: string) {
    await runOrNotFound(
      () => this.prisma.contentLine.delete({ where: { id } }),
      "ContentLine not found",
    );
    return { success: true };
  }

  // ─── Content Classifications (VD: Content Win, Content Test) ────────────

  async findContentClassifications() {
    return this.prisma.contentClassification.findMany({
      orderBy: { name: "asc" },
    });
  }

  async createContentClassification(name: string) {
    const exists = await this.prisma.contentClassification.findUnique({
      where: { name },
    });
    if (exists)
      throw new ConflictException(`ContentClassification "${name}" already exists`);
    return this.prisma.contentClassification.create({ data: { name } });
  }

  async updateContentClassification(id: string, name: string) {
    return runOrNotFound(
      () => this.prisma.contentClassification.update({ where: { id }, data: { name } }),
      "ContentClassification not found",
    );
  }

  async removeContentClassification(id: string) {
    await runOrNotFound(
      () => this.prisma.contentClassification.delete({ where: { id } }),
      "ContentClassification not found",
    );
    return { success: true };
  }

  async createProductLine(name: string) {
    const exists = await this.prisma.productLine.findUnique({
      where: { name },
    });
    if (exists)
      throw new ConflictException(`ProductLine "${name}" already exists`);
    return this.prisma.productLine.create({
      data: { name },
    });
  }

  async updateProductLine(
    id: string,
    data: { video_category?: string | null },
  ) {
    return runOrNotFound(
      () => this.prisma.productLine.update({ where: { id }, data }),
      "ProductLine not found",
    );
  }

  async removeProductLine(id: string) {
    await runOrNotFound(
      () => this.prisma.productLine.delete({ where: { id } }),
      "ProductLine not found",
    );
  }

  async createMaterial(name: string, brandType: string) {
    const exists = await this.prisma.material.findUnique({
      where: { name_brand_type: { name, brand_type: brandType as any } },
    });
    if (exists)
      throw new ConflictException(
        `Material "${name}" already exists for this brand`,
      );
    return this.prisma.material.create({
      data: { name, brand_type: brandType as any },
    });
  }

  async removeMaterial(id: string) {
    await runOrNotFound(
      () => this.prisma.material.delete({ where: { id } }),
      "Material not found",
    );
  }

  // ─── Product Classifications (VD: Main, Test, Đẩy) ───────────────────────

  async findProductClassifications() {
    return this.prisma.productClassification.findMany({
      orderBy: { name: "asc" },
    });
  }

  async createProductClassification(name: string) {
    const exists = await this.prisma.productClassification.findUnique({
      where: { name },
    });
    if (exists)
      throw new ConflictException(`ProductClassification "${name}" already exists`);
    return this.prisma.productClassification.create({ data: { name } });
  }

  async updateProductClassification(id: string, name: string) {
    return runOrNotFound(
      () => this.prisma.productClassification.update({ where: { id }, data: { name } }),
      "ProductClassification not found",
    );
  }

  async removeProductClassification(id: string) {
    await runOrNotFound(
      () => this.prisma.productClassification.delete({ where: { id } }),
      "ProductClassification not found",
    );
    return { success: true };
  }

  // ─── Sources (kho tổng) ───────────────────────────────────────────────────

  async findAllSources(q: QuerySourceDto) {
    const where: any = {};
    if (q.brand_type) where.brand_type = q.brand_type;
    if (q.type) where.type = q.type;
    if (q.product_id) where.product_id = q.product_id;
    if (q.added_by_id) where.added_by_id = q.added_by_id;
    if (q.is_active !== undefined) where.is_active = q.is_active;
    if (q.search)
      where.OR = [
        { name: { contains: q.search, mode: "insensitive" } },
        { link: { contains: q.search, mode: "insensitive" } },
      ];
    Object.assign(where, this.monthRange(q.month));

    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const [data, total] = await Promise.all([
      this.prisma.source.findMany({
        where,
        include: {
          product: { select: { id: true, name: true } },
          added_by: { select: { id: true, full_name: true } },
          ordered_team: { select: { id: true, name: true } },
          source_team_source: {
            select: {
              id: true,
              type: true,
              name: true,
              link: true,
              nas_link: true,
              code: true,
              is_active: true,
              source_editor_source: {
                select: {
                  id: true,
                  type: true,
                  name: true,
                  link: true,
                  nas_link: true,
                  code: true,
                  is_active: true,
                },
              },
            },
          },
        },
        orderBy: [{ created_at: "desc" }, { id: "asc" }],
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
      include: this.sourceInclude,
    });
    if (!s) throw new NotFoundException("Source not found");
    return s;
  }

  private sourceInclude = {
    product: { select: { id: true, name: true } },
    added_by: { select: { id: true, full_name: true } },
    ordered_team: { select: { id: true, name: true } },
    source_team_source: {
      select: {
        id: true,
        type: true,
        name: true,
        link: true,
        nas_link: true,
        code: true,
        is_active: true,
        source_editor_source: {
          select: {
            id: true,
            type: true,
            name: true,
            link: true,
            nas_link: true,
            code: true,
            is_active: true,
          },
        },
      },
    },
  };

  async createSource(
    dto: CreateSourceDto,
    userId: string,
    userRoles: string[] = [],
  ) {
    const { team_id, ...rest } = dto;
    // Nếu chưa chỉ định product_id tường minh, thử tự khớp theo mã (code == sku).
    const linkedProductId =
      dto.product_id ?? (await findProductBySku(this.prisma, dto.code))?.id ?? undefined;
    const source = await this.prisma.source.create({
      data: {
        ...rest,
        product_id: linkedProductId,
        is_active: dto.is_active ?? true,
        added_by_id: userId,
        type: dto.type as any,
        ordered_team_id: team_id ?? null,
      },
      include: this.sourceInclude,
    });

    if (team_id) {
      try {
        await this.teamsService.addTeamSource(
          team_id,
          { source_source_id: source.id },
          userId,
          userRoles,
        );
      } catch (err) {
        await this.prisma.source.delete({ where: { id: source.id } });
        throw err;
      }
    }

    return source;
  }

  async updateSource(
    id: string,
    dto: UpdateSourceDto,
    userId: string,
    userRoles: string[] = [],
  ) {
    const existing = await this.prisma.source.findUnique({
      where: { id },
      select: { ordered_team_id: true, product_id: true },
    });
    if (!existing) throw new NotFoundException("Source not found");
    const { team_id, ...rest } = dto;
    const teamIdProvided = Object.prototype.hasOwnProperty.call(dto, "team_id");
    const oldTeamId = existing.ordered_team_id;
    const newTeamId = team_id ?? null;

    // Chưa liên kết product và người dùng vừa sửa code → thử tự khớp lại theo mã.
    if (dto.code !== undefined && dto.product_id === undefined && existing.product_id == null) {
      const matched = await findProductBySku(this.prisma, dto.code);
      if (matched) rest.product_id = matched.id;
    }

    if (teamIdProvided && newTeamId !== oldTeamId) {
      // Tạo bản copy ở team mới trước — nếu bị từ chối quyền thì không đụng tới bản ở team cũ
      if (newTeamId) {
        await this.teamsService.addTeamSource(
          newTeamId,
          { source_source_id: id },
          userId,
          userRoles,
        );
      }
      if (oldTeamId) {
        const oldLink = await this.prisma.teamSource.findFirst({
          where: { team_id: oldTeamId, source_source_id: id },
        });
        if (oldLink)
          await this.teamsService.removeTeamSource(
            oldTeamId,
            oldLink.id,
            userId,
            userRoles,
          );
      }
    }

    return this.prisma.source.update({
      where: { id },
      data: {
        ...rest,
        ...(teamIdProvided ? { ordered_team_id: newTeamId } : {}),
      },
      include: {
        product: { select: { id: true, name: true } },
        added_by: { select: { id: true, full_name: true } },
        ordered_team: { select: { id: true, name: true } },
      },
    });
  }

  async removeSource(id: string, roles?: string[]) {
    const isPrivileged = roles?.some((r) => ["ADMIN", "MANAGER"].includes(r));
    if (!isPrivileged)
      throw new ForbiddenException(
        "Chỉ ADMIN/MANAGER mới có thể xóa source trong kho tổng",
      );
    await runOrNotFound(
      () => this.prisma.source.delete({ where: { id } }),
      "Source not found",
    );
    return { success: true };
  }

  // ─── Editor Products (kho cá nhân) ───────────────────────────────────────

  async findAllEditorProducts(userId: string, q: QueryEditorProductDto) {
    const where: any = { user_id: userId };
    if (q.brand_type) where.brand_type = q.brand_type;
    if (q.market) where.market = q.market;
    if (q.product_line_id) where.product_line_id = q.product_line_id;
    if (q.classification_id) where.classification_id = q.classification_id;
    if (q.is_active !== undefined) where.is_active = q.is_active;
    if (q.search)
      where.OR = [
        { name: { contains: q.search, mode: "insensitive" } },
        { sku: { contains: q.search, mode: "insensitive" } },
      ];
    Object.assign(where, this.monthRange(q.month, "added_at"));

    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const [data, total] = await Promise.all([
      this.prisma.editorProduct.findMany({
        where,
        include: {
          product_line: { select: { id: true, name: true } },
          material: { select: { id: true, name: true } },
          classification: { select: { id: true, name: true } },
          added_by: { select: { id: true, full_name: true } },
        },
        orderBy: [{ priority_score: "desc" }, { name: "asc" }, { id: "asc" }],
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
        product_line: true,
        material: true,
        classification: true,
        added_by: { select: { id: true, full_name: true } },
        user: { select: { id: true, full_name: true } },
        editor_sources: { take: 10, orderBy: { added_at: "desc" } },
      },
    });
    if (!p) throw new NotFoundException("EditorProduct not found");
    return p;
  }

  private async assertEditorProductSkuAvailable(userId: string, sku?: string | null) {
    if (!sku) return;
    const exists = await this.prisma.editorProduct.findFirst({
      where: { user_id: userId, sku },
      select: { id: true },
    });
    if (exists) throw new ConflictException(`Mã sản phẩm "${sku}" đã tồn tại trong kho cá nhân`);
  }

  async createEditorProduct(userId: string, dto: CreateEditorProductDto) {
    if (dto.source_product_id) {
      const src = await resolveProductSnapshot(this.prisma, dto.source_product_id);
      if (!src) throw new NotFoundException("Source product not found");
      const sku = dto.sku ?? src.sku;
      await this.assertEditorProductSkuAvailable(userId, sku);
      const ep = await this.prisma.editorProduct.create({
        data: {
          user_id: userId,
          added_by_id: userId,
          source_product_id: src.id,
          sku,
          name: dto.name ?? src.name,
          brand_type: (dto.brand_type ?? src.brand_type) as any,
          image_url: dto.image_url ?? src.image_url,
          image_urls: dto.image_urls ?? src.image_urls,
          price: dto.price !== undefined ? dto.price : (src.price as any),
          market: dto.market ?? src.market,
          price_segment: dto.price_segment ?? src.price_segment,
          priority_score: dto.priority_score ?? src.priority_score,
          cooldown_days: dto.cooldown_days ?? src.cooldown_days,
          material_id: dto.material_id ?? src.material_id,
          product_line_id: dto.product_line_id ?? src.product_line_id,
          classification_id: dto.classification_id ?? src.classification_id,
          is_active: dto.is_active ?? true,
        },
        include: { product_line: true, material: true, classification: true },
      });
      await backfillEditorSourcesForNewEditorProduct(this.prisma, userId, ep.sku, ep.id);
      return ep;
    }

    const sku = dto.sku ?? `EP-${Date.now()}`;
    await this.assertEditorProductSkuAvailable(userId, sku);
    const ep = await this.prisma.editorProduct.create({
      data: {
        user_id: userId,
        added_by_id: userId,
        sku,
        name: dto.name ?? "",
        brand_type: (dto.brand_type ?? "DO_DA") as any,
        image_url: dto.image_url,
        image_urls: dto.image_urls ?? [],
        price: dto.price as any,
        market: dto.market,
        price_segment: dto.price_segment,
        priority_score: dto.priority_score ?? 0,
        cooldown_days: dto.cooldown_days ?? null,
        material_id: dto.material_id,
        product_line_id: dto.product_line_id,
        classification_id: dto.classification_id,
        is_active: dto.is_active ?? true,
      },
      include: { product_line: true, material: true, classification: true },
    });
    await backfillEditorSourcesForNewEditorProduct(this.prisma, userId, ep.sku, ep.id);
    return ep;
  }

  /** Lean ownership check — chỉ SELECT user_id thay vì tải cả EditorProduct với đầy đủ quan hệ. */
  private async assertEditorProductOwner(
    id: string,
    requesterId: string,
    roles: string[],
  ) {
    const isPrivileged = roles.some((r) => ["ADMIN", "MANAGER"].includes(r));
    if (isPrivileged) return;
    const owner = await this.prisma.editorProduct.findUnique({
      where: { id },
      select: { user_id: true },
    });
    if (!owner) throw new NotFoundException("EditorProduct not found");
    if (owner.user_id !== requesterId)
      throw new ForbiddenException(
        "Bạn chỉ có thể truy cập sản phẩm trong kho cá nhân của mình",
      );
  }

  async updateEditorProduct(
    id: string,
    dto: UpdateEditorProductDto,
    requesterId: string,
    roles: string[],
  ) {
    await this.assertEditorProductOwner(id, requesterId, roles);
    return runOrNotFound(
      () =>
        this.prisma.editorProduct.update({
          where: { id },
          data: dto as any,
          include: { product_line: true, material: true, classification: true },
        }),
      "EditorProduct not found",
    );
  }

  async removeEditorProduct(id: string, requesterId: string, roles: string[]) {
    await this.assertEditorProductOwner(id, requesterId, roles);
    await runOrNotFound(
      () => this.prisma.editorProduct.delete({ where: { id } }),
      "EditorProduct not found",
    );
    return { success: true };
  }

  // ─── Editor Contents (kho cá nhân) ───────────────────────────────────────

  async findAllEditorContents(userId: string, q: QueryEditorContentDto) {
    const where: any = { user_id: userId };
    if (q.brand_type) where.brand_type = q.brand_type;
    // Sentinel "__unassigned__" — xem giải thích ở findAllContents().
    if (q.content_line_id === "__unassigned__") where.content_line_id = null;
    else if (q.content_line_id) where.content_line_id = q.content_line_id;
    if (q.classification_id) where.classification_id = q.classification_id;
    if (q.status) where.status = q.status;
    if (q.market) where.market = q.market;
    if (q.search)
      where.OR = [
        { title: { contains: q.search, mode: "insensitive" } },
        { body: { contains: q.search, mode: "insensitive" } },
        { code: { contains: q.search, mode: "insensitive" } },
      ];
    Object.assign(where, this.monthRange(q.month, "added_at"));

    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const [data, total] = await Promise.all([
      this.prisma.editorContent.findMany({
        where,
        // select (không include) để bớt body/script — không hiện ở list nào, chỉ dùng ở
        // modal xem chi tiết/form sửa (xem findOneEditorContent/updateEditorContent).
        select: {
          id: true,
          user_id: true,
          brand_type: true,
          market: true,
          code: true,
          title: true,
          file_content_url: true,
          voice_url: true,
          content_line_id: true,
          classification_id: true,
          status: true,
          source_content_id: true,
          added_by_id: true,
          added_at: true,
          updated_at: true,
          // "Số lần được làm" = số task đã tạo trực tiếp từ content kho cá nhân này (đếm sống).
          _count: { select: { tasks: true } },
          content_line: { select: { id: true, name: true } },
          classification: { select: { id: true, name: true } },
          added_by: { select: { id: true, full_name: true } },
        },
        orderBy: [{ added_at: "desc" }, { id: "asc" }],
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
        classification: true,
        added_by: { select: { id: true, full_name: true } },
        user: { select: { id: true, full_name: true } },
        _count: { select: { tasks: true } },
      },
    });
    if (!c) throw new NotFoundException("EditorContent not found");
    return c;
  }

  async createEditorContent(userId: string, dto: CreateEditorContentDto) {
    // exists (check trùng code) và src (resolve content gốc) không phụ thuộc nhau — chạy song song.
    const [exists, src] = await Promise.all([
      dto.code
        ? this.prisma.editorContent.findUnique({ where: { code: dto.code } })
        : Promise.resolve(null),
      dto.source_content_id
        ? resolveContentSnapshot(this.prisma, dto.source_content_id)
        : Promise.resolve(null),
    ]);
    if (dto.code && exists)
      throw new ConflictException(`Mã content "${dto.code}" đã tồn tại`);

    if (dto.source_content_id) {
      if (!src) throw new NotFoundException("Source content not found");
      return this.prisma.editorContent.create({
        data: {
          user_id: userId,
          added_by_id: userId,
          source_content_id: src.id,
          brand_type: (dto.brand_type ?? src.brand_type) as any,
          market: dto.market ?? (src.market as string),
          code: dto.code,
          title: dto.title ?? src.title,
          body: dto.body ?? src.body,
          script: dto.script ?? src.script,
          file_content_url: dto.file_content_url ?? src.file_content_url,
          voice_url: dto.voice_url ?? src.voice_url,
          content_line_id: dto.content_line_id ?? src.content_line_id,
          classification_id: dto.classification_id ?? src.classification_id,
        },
        include: { content_line: true, classification: true },
      });
    }

    return this.prisma.editorContent.create({
      data: {
        user_id: userId,
        added_by_id: userId,
        brand_type: (dto.brand_type ?? "DO_DA") as any,
        market: dto.market ?? "VIETNAM",
        code: dto.code,
        title: dto.title,
        body: dto.body,
        script: dto.script,
        file_content_url: dto.file_content_url,
        voice_url: dto.voice_url,
        content_line_id: dto.content_line_id,
        classification_id: dto.classification_id,
      },
      include: { content_line: true, classification: true },
    });
  }

  /** Lean ownership check — chỉ SELECT user_id (+ status khi cần) thay vì tải cả EditorContent. */
  private async getEditorContentOwnership(
    id: string,
    requesterId: string,
    roles: string[],
  ) {
    const isPrivileged = roles.some((r) => ["ADMIN", "MANAGER"].includes(r));
    const ec = await this.prisma.editorContent.findUnique({
      where: { id },
      select: { user_id: true, status: true },
    });
    if (!ec) throw new NotFoundException("EditorContent not found");
    if (!isPrivileged && ec.user_id !== requesterId)
      throw new ForbiddenException(
        "Bạn chỉ có thể truy cập content trong kho cá nhân của mình",
      );
    return ec;
  }

  async updateEditorContent(
    id: string,
    dto: UpdateEditorContentDto,
    requesterId: string,
    roles: string[],
  ) {
    await this.getEditorContentOwnership(id, requesterId, roles);
    if (dto.code) {
      const exists = await this.prisma.editorContent.findUnique({
        where: { code: dto.code },
      });
      if (exists && exists.id !== id)
        throw new ConflictException(`Mã content "${dto.code}" đã tồn tại`);
    }
    return this.prisma.editorContent.update({
      where: { id },
      data: dto as any,
      include: { content_line: true, classification: true },
    });
  }

  async removeEditorContent(id: string, requesterId: string, roles: string[]) {
    const ec = await this.getEditorContentOwnership(id, requesterId, roles);
    if (ec.status === "IN_TASK")
      throw new ConflictException("Content đang được dùng trong task");
    await this.prisma.editorContent.delete({ where: { id } });
    return { success: true };
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
    Object.assign(where, this.monthRange(q.month, "added_at"));

    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const [data, total] = await Promise.all([
      this.prisma.editorSource.findMany({
        where,
        include: {
          product: { select: { id: true, name: true } },
          editor_product: { select: { id: true, name: true } },
          added_by: { select: { id: true, full_name: true } },
        },
        orderBy: [{ added_at: "desc" }, { id: "asc" }],
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
        product: { select: { id: true, name: true } },
        editor_product: { select: { id: true, name: true } },
        added_by: { select: { id: true, full_name: true } },
        user: { select: { id: true, full_name: true } },
      },
    });
    if (!s) throw new NotFoundException("EditorSource not found");
    return s;
  }

  async createEditorSource(userId: string, dto: CreateEditorSourceDto) {
    if (!dto.source_source_id && !dto.nas_link) {
      throw new BadRequestException("Link ổ NAS là bắt buộc khi tạo mới");
    }
    if (dto.source_source_id) {
      const src = await this.prisma.source.findUnique({
        where: { id: dto.source_source_id },
      });
      if (!src) throw new NotFoundException("Source not found");
      const code = dto.code ?? src.code;
      // productMatch/editorProductMatch độc lập nhau — chạy song song thay vì tuần tự.
      const [productMatch, editorProductMatch] = await Promise.all([
        dto.product_id == null && src.product_id == null
          ? findProductBySku(this.prisma, code)
          : Promise.resolve(undefined),
        dto.editor_product_id == null
          ? findEditorProductBySku(this.prisma, userId, code)
          : Promise.resolve(undefined),
      ]);
      const productId = dto.product_id ?? src.product_id ?? productMatch?.id ?? undefined;
      const editorProductId = dto.editor_product_id ?? editorProductMatch?.id ?? undefined;
      return this.prisma.editorSource.create({
        data: {
          user_id: userId,
          added_by_id: userId,
          source_source_id: src.id,
          brand_type: (dto.brand_type ?? src.brand_type) as any,
          type: (dto.type ?? src.type) as any,
          name: dto.name ?? src.name,
          link: dto.link ?? src.link,
          nas_link: dto.nas_link ?? src.nas_link,
          code,
          product_id: productId,
          editor_product_id: editorProductId,
          is_active: dto.is_active ?? true,
        },
        include: {
          product: { select: { id: true, name: true } },
          editor_product: { select: { id: true, name: true } },
          added_by: { select: { id: true, full_name: true } },
        },
      });
    }

    const [productMatch, editorProductMatch] = await Promise.all([
      dto.product_id == null
        ? findProductBySku(this.prisma, dto.code)
        : Promise.resolve(undefined),
      dto.editor_product_id == null
        ? findEditorProductBySku(this.prisma, userId, dto.code)
        : Promise.resolve(undefined),
    ]);
    const productId = dto.product_id ?? productMatch?.id ?? undefined;
    const editorProductId = dto.editor_product_id ?? editorProductMatch?.id ?? undefined;
    return this.prisma.editorSource.create({
      data: {
        user_id: userId,
        added_by_id: userId,
        brand_type: (dto.brand_type ?? "DO_DA") as any,
        type: dto.type as any,
        name: dto.name ?? "",
        link: dto.link ?? "",
        nas_link: dto.nas_link,
        code: dto.code,
        product_id: productId,
        editor_product_id: editorProductId,
        is_active: dto.is_active ?? true,
      },
      include: {
        product: { select: { id: true, name: true } },
        editor_product: { select: { id: true, name: true } },
        added_by: { select: { id: true, full_name: true } },
      },
    });
  }

  /** Lean ownership check — chỉ SELECT user_id thay vì tải cả EditorSource với đầy đủ quan hệ. */
  private async assertEditorSourceOwner(
    id: string,
    requesterId: string,
    roles: string[],
  ) {
    const isPrivileged = roles.some((r) => ["ADMIN", "MANAGER"].includes(r));
    if (isPrivileged) return;
    const owner = await this.prisma.editorSource.findUnique({
      where: { id },
      select: { user_id: true },
    });
    if (!owner) throw new NotFoundException("EditorSource not found");
    if (owner.user_id !== requesterId)
      throw new ForbiddenException(
        "Bạn chỉ có thể truy cập source trong kho cá nhân của mình",
      );
  }

  async updateEditorSource(
    id: string,
    dto: UpdateEditorSourceDto,
    requesterId: string,
    roles: string[],
  ) {
    const isPrivileged = roles.some((r) => ["ADMIN", "MANAGER"].includes(r));
    const needsCodeMatch = dto.code !== undefined;

    // Gộp ownership-check (assertEditorSourceOwner) + fetch entry cho auto-match SKU thành 1
    // query duy nhất thay vì 2 lần findUnique liên tiếp trên cùng 1 row (select sau là superset
    // của select trước). Chỉ fetch khi thật sự cần — giữ nguyên fast-path 0-query cho
    // ADMIN/MANAGER khi không đổi code.
    let entry: { user_id: string; product_id: string | null; editor_product_id: string | null } | null = null;
    if (!isPrivileged || needsCodeMatch) {
      entry = await this.prisma.editorSource.findUnique({
        where: { id },
        select: { user_id: true, product_id: true, editor_product_id: true },
      });
      if (!entry) throw new NotFoundException("EditorSource not found");
      if (!isPrivileged && entry.user_id !== requesterId) {
        throw new ForbiddenException(
          "Bạn chỉ có thể truy cập source trong kho cá nhân của mình",
        );
      }
    }

    const data: any = { ...dto };
    if (needsCodeMatch && entry) {
      const needProduct = dto.product_id === undefined && entry.product_id == null;
      const needEditorProduct =
        dto.editor_product_id === undefined && entry.editor_product_id == null;
      // 2 lookup độc lập nhau — chạy song song thay vì tuần tự.
      const [productMatch, editorProductMatch] = await Promise.all([
        needProduct ? findProductBySku(this.prisma, dto.code!) : Promise.resolve(undefined),
        needEditorProduct
          ? findEditorProductBySku(this.prisma, entry.user_id, dto.code!)
          : Promise.resolve(undefined),
      ]);
      if (productMatch) data.product_id = productMatch.id;
      if (editorProductMatch) data.editor_product_id = editorProductMatch.id;
    }
    return runOrNotFound(
      () =>
        this.prisma.editorSource.update({
          where: { id },
          data,
          include: {
            product: { select: { id: true, name: true } },
            editor_product: { select: { id: true, name: true } },
            added_by: { select: { id: true, full_name: true } },
          },
        }),
      "EditorSource not found",
    );
  }

  async removeEditorSource(id: string, requesterId: string, roles: string[]) {
    await this.assertEditorSourceOwner(id, requesterId, roles);
    await runOrNotFound(
      () => this.prisma.editorSource.delete({ where: { id } }),
      "EditorSource not found",
    );
    return { success: true };
  }

  // ─── Push to team (từ kho editor → kho team, cần leader duyệt) ────────────

  /** Leader của team đích hoặc ADMIN/MANAGER → đẩy thẳng không qua hàng đợi */
  private canPushDirectly(
    team: { leader_id: string | null },
    userId: string,
    roles: string[],
  ) {
    return (
      roles.includes("ADMIN") ||
      roles.includes("MANAGER") ||
      team.leader_id === userId
    );
  }

  private async assertTeamMembership(
    team: { id: string; leader_id: string | null },
    userId: string,
  ) {
    if (team.leader_id === userId) return;
    const member = await this.prisma.teamMember.findFirst({
      where: { team_id: team.id, user_id: userId },
    });
    if (!member) throw new ForbiddenException("Bạn không thuộc team này");
  }

  /**
   * Ai được xem kho cá nhân (editor product/content/source) của `ownerId`:
   * - Chính chủ, hoặc ADMIN/MANAGER (xem toàn bộ).
   * - LEADER: chỉ khi `ownerId` là thành viên của một team mà LEADER đó đang quản lý.
   */
  async assertCanViewEditorCatalog(
    ownerId: string,
    requesterId: string,
    roles: string[],
  ) {
    if (requesterId === ownerId) return;
    if (roles.some((r) => ["ADMIN", "MANAGER"].includes(r))) return;
    if (roles.includes("LEADER")) {
      const isManagedMember = await this.prisma.teamMember.findFirst({
        where: { user_id: ownerId, team: { leader_id: requesterId } },
        select: { id: true },
      });
      if (isManagedMember) return;
    }
    throw new ForbiddenException(
      "Bạn chỉ có thể xem kho cá nhân của mình hoặc của thành viên trong team bạn quản lý",
    );
  }

  private async notifyUser(
    userId: string,
    type: string,
    title: string,
    body: string,
  ) {
    await this.prisma.notification
      .create({ data: { user_id: userId, type, title, body } })
      .catch(() => null); // notification lỗi không chặn nghiệp vụ chính
    this.push.sendToUser(userId, { title, body }).catch(() => {});
  }

  /** Copy product cá nhân → kho team (kèm nguồn OUTRO đi theo sản phẩm) */
  private async copyEditorProductToTeam(
    ep: {
      id: string;
      brand_type: any;
      priority_score: number;
      cooldown_days: number | null;
      is_active: boolean;
      product_line_id: string | null;
      classification_id: string | null;
    },
    teamId: string,
    addedById: string,
  ) {
    // teamProduct.create và editorSources.findMany độc lập nhau (chỉ teamSource.createMany bên
    // dưới cần cả 2) — chạy song song thay vì tuần tự.
    const [teamProduct, editorSources] = await Promise.all([
      this.prisma.teamProduct.create({
        data: {
          team_id: teamId,
          added_by_id: addedById,
          source_editor_product_id: ep.id,
          brand_type: ep.brand_type,
          priority_score: ep.priority_score,
          cooldown_days: ep.cooldown_days,
          is_active: ep.is_active,
          product_line_id: ep.product_line_id,
          classification_id: ep.classification_id,
        },
      }),
      this.prisma.editorSource.findMany({
        where: { editor_product_id: ep.id },
      }),
    ]);
    if (editorSources.length > 0) {
      await this.prisma.teamSource.createMany({
        data: editorSources.map((s) => ({
          team_id: teamId,
          added_by_id: addedById,
          source_editor_source_id: s.id,
          brand_type: s.brand_type,
          is_active: s.is_active,
          team_product_id: teamProduct.id,
        })),
        skipDuplicates: true,
      });
    }
    return teamProduct;
  }

  private async copyEditorContentToTeam(
    ec: {
      id: string;
      brand_type: any;
      classification_id: string | null;
      content_line_id?: string | null;
      market?: string | null;
    },
    teamId: string,
    addedById: string,
  ) {
    // Copy sẵn content_line_id/market vào chính bản ghi TeamContent thay vì để null và chỉ
    // dựa vào fallback qua quan hệ source_editor_content — listTeamContents lọc theo field thô
    // của TeamContent nên record để null sẽ luôn rơi vào "chưa gán tuyến" dù content gốc có tuyến,
    // và market không nullable (default "VIETNAM") nên không có fallback nào cứu được ở tầng query.
    return this.prisma.teamContent.create({
      data: {
        team_id: teamId,
        added_by_id: addedById,
        source_editor_content_id: ec.id,
        brand_type: ec.brand_type,
        classification_id: ec.classification_id,
        ...(ec.content_line_id ? { content_line_id: ec.content_line_id } : {}),
        ...(ec.market ? { market: ec.market } : {}),
      },
    });
  }

  async pushEditorProductToTeam(
    editorProductId: string,
    teamId: string,
    userId: string,
    userRoles: string[] = [],
  ) {
    // 3 lookup độc lập nhau (ep/team cho existence+quyền, existing cho check trùng) — chạy
    // song song, vẫn giữ đúng thứ tự ném lỗi như trước.
    const [ep, team, existing] = await Promise.all([
      this.prisma.editorProduct.findUnique({
        where: { id: editorProductId },
        select: {
          id: true,
          user_id: true,
          name: true,
          brand_type: true,
          priority_score: true,
          cooldown_days: true,
          is_active: true,
          product_line_id: true,
          classification_id: true,
        },
      }),
      this.prisma.team.findUnique({ where: { id: teamId } }),
      this.prisma.teamProduct.findUnique({
        where: {
          team_id_source_editor_product_id: {
            team_id: teamId,
            source_editor_product_id: editorProductId,
          },
        },
      }),
    ]);
    if (!ep) throw new NotFoundException("EditorProduct not found");
    if (!team) throw new NotFoundException("Team not found");
    if (ep.user_id !== userId)
      throw new ForbiddenException(
        "Chỉ có thể push sản phẩm trong kho của mình",
      );
    // Admin/Manager/Leader đẩy thẳng không cần là member; member thường phải thuộc team
    if (!this.canPushDirectly(team, userId, userRoles))
      await this.assertTeamMembership(team, userId);
    if (existing) throw new ConflictException("Sản phẩm đã có trong kho team");

    if (this.canPushDirectly(team, userId, userRoles)) {
      await this.copyEditorProductToTeam(ep, teamId, userId);
      return {
        success: true,
        pending: false,
        editor_product_id: editorProductId,
        team_id: teamId,
      };
    }

    const pendingReq = await this.prisma.teamPushRequest.findFirst({
      where: {
        team_id: teamId,
        editor_product_id: editorProductId,
        status: "PENDING",
      },
    });
    if (pendingReq)
      throw new ConflictException("Sản phẩm này đang có yêu cầu chờ duyệt");

    const request = await this.prisma.teamPushRequest.create({
      data: {
        team_id: teamId,
        type: "PRODUCT",
        editor_product_id: editorProductId,
        requested_by_id: userId,
      },
    });
    if (team.leader_id) {
      await this.notifyUser(
        team.leader_id,
        "TEAM_PUSH_REQUEST",
        "Yêu cầu đẩy sản phẩm vào kho team",
        `Sản phẩm "${ep.name}" đang chờ bạn duyệt vào kho team ${team.name}.`,
      );
    }
    return { success: true, pending: true, request };
  }

  async pushEditorContentToTeam(
    editorContentId: string,
    teamId: string,
    userId: string,
    userRoles: string[] = [],
  ) {
    const [ec, team, existing] = await Promise.all([
      this.prisma.editorContent.findUnique({
        where: { id: editorContentId },
        select: {
          id: true,
          user_id: true,
          title: true,
          brand_type: true,
          classification_id: true,
          content_line_id: true,
          market: true,
        },
      }),
      this.prisma.team.findUnique({ where: { id: teamId } }),
      this.prisma.teamContent.findUnique({
        where: {
          team_id_source_editor_content_id: {
            team_id: teamId,
            source_editor_content_id: editorContentId,
          },
        },
      }),
    ]);
    if (!ec) throw new NotFoundException("EditorContent not found");
    if (!team) throw new NotFoundException("Team not found");
    if (ec.user_id !== userId)
      throw new ForbiddenException(
        "Chỉ có thể push content trong kho của mình",
      );
    // Admin/Manager/Leader đẩy thẳng không cần là member; member thường phải thuộc team
    if (!this.canPushDirectly(team, userId, userRoles))
      await this.assertTeamMembership(team, userId);
    if (existing) throw new ConflictException("Content đã có trong kho team");

    if (this.canPushDirectly(team, userId, userRoles)) {
      await this.copyEditorContentToTeam(ec, teamId, userId);
      return {
        success: true,
        pending: false,
        editor_content_id: editorContentId,
        team_id: teamId,
      };
    }

    const pendingReq = await this.prisma.teamPushRequest.findFirst({
      where: {
        team_id: teamId,
        editor_content_id: editorContentId,
        status: "PENDING",
      },
    });
    if (pendingReq)
      throw new ConflictException("Content này đang có yêu cầu chờ duyệt");

    const request = await this.prisma.teamPushRequest.create({
      data: {
        team_id: teamId,
        type: "CONTENT",
        editor_content_id: editorContentId,
        requested_by_id: userId,
      },
    });
    if (team.leader_id) {
      await this.notifyUser(
        team.leader_id,
        "TEAM_PUSH_REQUEST",
        "Yêu cầu đẩy content vào kho team",
        `Content "${ec.title ?? "Không tiêu đề"}" đang chờ bạn duyệt vào kho team ${team.name}.`,
      );
    }
    return { success: true, pending: true, request };
  }

  // ─── Push request review (leader duyệt) ───────────────────────────────────

  // editor_content cần đủ body/script/voice_url/file_content_url để leader xem trước khi
  // duyệt (ContentViewModal ở FE) — trước đây select hẹp chỉ lấy title khiến màn hình duyệt
  // (TeamPushRequestsTab.tsx) không hiện được kịch bản, chỉ thấy tên/tuyến/loại content.
  // editor_product giữ select hẹp vì Product không có field kịch bản tương đương.
  private pushRequestInclude = {
    team: { select: { id: true, name: true, leader_id: true } },
    requested_by: { select: { id: true, full_name: true, email: true } },
    reviewed_by: { select: { id: true, full_name: true } },
    editor_product: {
      select: {
        id: true,
        name: true,
        brand_type: true,
        priority_score: true,
        cooldown_days: true,
        is_active: true,
        product_line_id: true,
        classification_id: true,
        product_line: { select: { id: true, name: true } },
      },
    },
    editor_content: {
      select: {
        id: true,
        code: true,
        title: true,
        market: true,
        status: true,
        body: true,
        script: true,
        voice_url: true,
        file_content_url: true,
        brand_type: true,
        classification_id: true,
        content_line_id: true,
        content_line: { select: { id: true, name: true } },
      },
    },
  };

  async listTeamPushRequests(
    teamId: string,
    status: string | undefined,
    userId: string,
    userRoles: string[],
    opts?: { page?: number; limit?: number },
  ) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException("Team not found");
    if (!this.canPushDirectly(team, userId, userRoles))
      throw new ForbiddenException(
        "Chỉ leader hoặc quản lý mới xem được yêu cầu duyệt của team",
      );

    // Không truyền page → giữ hành vi cũ (mảng đầy đủ) — cùng convention với
    // teams.service.ts listTeamProducts/Contents/Sources.
    const page = opts?.page;
    const limit = opts?.limit ?? 50;
    return this.prisma.teamPushRequest.findMany({
      where: { team_id: teamId, ...(status ? { status: status as any } : {}) },
      include: this.pushRequestInclude,
      orderBy: { created_at: "desc" },
      skip: page ? (page - 1) * limit : undefined,
      take: page ? limit : undefined,
    });
  }

  async listMyPushRequests(
    userId: string,
    status?: string,
    opts?: { page?: number; limit?: number },
  ) {
    const page = opts?.page;
    const limit = opts?.limit ?? 50;
    return this.prisma.teamPushRequest.findMany({
      where: {
        requested_by_id: userId,
        ...(status ? { status: status as any } : {}),
      },
      include: this.pushRequestInclude,
      orderBy: { created_at: "desc" },
      skip: page ? (page - 1) * limit : undefined,
      take: page ? limit : undefined,
    });
  }

  async reviewTeamPushRequest(
    requestId: string,
    action: "APPROVED" | "REJECTED",
    note: string | undefined,
    reviewerId: string,
    userRoles: string[],
  ) {
    const request = await this.prisma.teamPushRequest.findUnique({
      where: { id: requestId },
      include: this.pushRequestInclude,
    });
    if (!request) throw new NotFoundException("Không tìm thấy yêu cầu");
    if (request.status !== "PENDING")
      throw new ConflictException("Yêu cầu đã được xử lý");
    if (!this.canPushDirectly(request.team, reviewerId, userRoles))
      throw new ForbiddenException(
        "Chỉ leader hoặc quản lý mới được duyệt yêu cầu của team",
      );

    if (action === "APPROVED") {
      if (request.type === "PRODUCT" && request.editor_product) {
        const dup = await this.prisma.teamProduct.findUnique({
          where: {
            team_id_source_editor_product_id: {
              team_id: request.team_id,
              source_editor_product_id: request.editor_product.id,
            },
          },
        });
        if (!dup)
          await this.copyEditorProductToTeam(
            request.editor_product,
            request.team_id,
            request.requested_by_id,
          );
      } else if (request.type === "CONTENT" && request.editor_content) {
        const dup = await this.prisma.teamContent.findUnique({
          where: {
            team_id_source_editor_content_id: {
              team_id: request.team_id,
              source_editor_content_id: request.editor_content.id,
            },
          },
        });
        if (!dup)
          await this.copyEditorContentToTeam(
            request.editor_content,
            request.team_id,
            request.requested_by_id,
          );
      }
    }

    // Chỉ status/reviewed_by/reviewed_at/note thay đổi — team/requested_by/editor_product/
    // editor_content không đổi giữa 2 lần fetch, nên select hẹp rồi merge với `request` đã load
    // ở trên thay vì include lại toàn bộ cây quan hệ lần nữa.
    const patch = await this.prisma.teamPushRequest.update({
      where: { id: requestId },
      data: {
        status: action,
        reviewed_by_id: reviewerId,
        reviewed_at: new Date(),
        note: note ?? null,
      },
      select: {
        status: true,
        reviewed_at: true,
        note: true,
        reviewed_by: { select: { id: true, full_name: true } },
      },
    });
    const updated = { ...request, ...patch };

    const itemName =
      request.type === "PRODUCT"
        ? (request.editor_product?.name ?? "Sản phẩm")
        : (request.editor_content?.title ?? "Content");
    await this.notifyUser(
      request.requested_by_id,
      "TEAM_PUSH_REVIEWED",
      action === "APPROVED"
        ? "Yêu cầu đẩy kho team được duyệt"
        : "Yêu cầu đẩy kho team bị từ chối",
      action === "APPROVED"
        ? `"${itemName}" đã được duyệt vào kho team ${request.team.name}.`
        : `"${itemName}" bị từ chối vào kho team ${request.team.name}${note ? ` — Lý do: ${note}` : ""}.`,
    );

    return updated;
  }

  async pushEditorSourceToTeam(
    editorSourceId: string,
    teamId: string,
    userId: string,
  ) {
    const [es, team, existing] = await Promise.all([
      this.prisma.editorSource.findUnique({
        where: { id: editorSourceId },
        select: { id: true, user_id: true, brand_type: true, is_active: true },
      }),
      this.prisma.team.findUnique({ where: { id: teamId } }),
      this.prisma.teamSource.findUnique({
        where: {
          team_id_source_editor_source_id: {
            team_id: teamId,
            source_editor_source_id: editorSourceId,
          },
        },
      }),
    ]);
    if (!es) throw new NotFoundException("EditorSource not found");
    if (!team) throw new NotFoundException("Team not found");
    if (es.user_id !== userId)
      throw new ForbiddenException("Chỉ có thể push source trong kho của mình");
    if (existing) throw new ConflictException("Source đã có trong kho team");

    return this.prisma.teamSource.create({
      data: {
        team_id: teamId,
        added_by_id: userId,
        source_editor_source_id: editorSourceId,
        brand_type: es.brand_type,
        is_active: es.is_active,
      },
    });
  }
}
