import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../../common/guards/roles.guard";
import { Roles } from "../../../common/decorators/roles.decorator";
import { ScaleDataSourceGuard } from "../../../common/guards/scale-data-source.guard";
import { TaskAutoCatalogService } from "./catalog.service";
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
} from "./catalog.dto";

@ApiTags("task-auto")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("task-auto")
export class TaskAutoCatalogController {
  constructor(private catalog: TaskAutoCatalogService) {}

  // ── Products ──────────────────────────────────────────────────────────────

  @Get("products")
  @ApiOperation({ summary: "List products" })
  getProducts(@Query() q: QueryProductDto) {
    return this.catalog.findAllProducts(q);
  }

  @Get("products/:id")
  @ApiOperation({ summary: "Get product detail" })
  getProduct(@Param("id") id: string) {
    return this.catalog.findOneProduct(id);
  }

  @Post("products")
  @ApiOperation({ summary: "Create a product (all roles)" })
  createProduct(@Body() dto: CreateProductDto, @Request() req: any) {
    return this.catalog.createProduct(dto, req.user.id);
  }

  @Put("products/:id")
  @ApiOperation({ summary: "Update a product (all roles)" })
  updateProduct(@Param("id") id: string, @Body() dto: UpdateProductDto) {
    return this.catalog.updateProduct(id, dto);
  }

  @Delete("products/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({
    summary: "Delete a product from global catalog (ADMIN/MANAGER)",
  })
  deleteProduct(@Param("id") id: string, @Request() req: any) {
    return this.catalog.removeProduct(id, req.user.roles ?? []);
  }

  // ── Product Lines ─────────────────────────────────────────────────────────

  @Get("product-lines")
  @ApiOperation({ summary: "List product lines (dùng chung mọi brand)" })
  getProductLines() {
    return this.catalog.findProductLines();
  }

  @Post("product-lines")
  @ApiOperation({ summary: "Create a product line (all roles)" })
  createProductLine(@Body("name") name: string) {
    return this.catalog.createProductLine(name);
  }

  @Patch("product-lines/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Update product line (video_category)" })
  updateProductLine(
    @Param("id") id: string,
    @Body() body: { video_category?: string | null },
  ) {
    return this.catalog.updateProductLine(id, body);
  }

  @Delete("product-lines/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Delete a product line" })
  deleteProductLine(@Param("id") id: string) {
    return this.catalog.removeProductLine(id);
  }

  // ── Product Classifications (VD: Main, Test, Đẩy) ───────────────────────────

  @Get("product-classifications")
  @ApiOperation({ summary: "List product classifications" })
  getProductClassifications() {
    return this.catalog.findProductClassifications();
  }

  @Post("product-classifications")
  @ApiOperation({ summary: "Create a product classification (all roles)" })
  createProductClassification(@Body("name") name: string) {
    return this.catalog.createProductClassification(name);
  }

  @Patch("product-classifications/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Rename a product classification" })
  updateProductClassification(
    @Param("id") id: string,
    @Body("name") name: string,
  ) {
    return this.catalog.updateProductClassification(id, name);
  }

  @Delete("product-classifications/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Delete a product classification" })
  deleteProductClassification(@Param("id") id: string) {
    return this.catalog.removeProductClassification(id);
  }

  // ── Materials ─────────────────────────────────────────────────────────────

  @Get("materials")
  @ApiOperation({ summary: "List materials" })
  getMaterials(@Query("brand_type") brandType?: string) {
    return this.catalog.findMaterials(brandType);
  }

  @Post("materials")
  @ApiOperation({ summary: "Create a material (all roles)" })
  createMaterial(
    @Body("name") name: string,
    @Body("brand_type") brandType: string,
  ) {
    return this.catalog.createMaterial(name, brandType);
  }

  @Delete("materials/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Delete a material" })
  deleteMaterial(@Param("id") id: string) {
    return this.catalog.removeMaterial(id);
  }

  // ── Contents ──────────────────────────────────────────────────────────────

  @Get("contents")
  @ApiOperation({ summary: "List contents" })
  getContents(@Query() q: QueryContentDto) {
    return this.catalog.findAllContents(q);
  }

  @Get("contents/:id")
  @ApiOperation({ summary: "Get content detail" })
  getContent(@Param("id") id: string) {
    return this.catalog.findOneContent(id);
  }

  @Post("contents")
  @ApiOperation({ summary: "Create a content (all roles)" })
  createContent(@Body() dto: CreateContentDto, @Request() req: any) {
    return this.catalog.createContent(dto, req.user.id);
  }

  @Put("contents/:id")
  @ApiOperation({ summary: "Update a content (all roles)" })
  updateContent(@Param("id") id: string, @Body() dto: UpdateContentDto) {
    return this.catalog.updateContent(id, dto);
  }

  @Delete("contents/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({
    summary: "Delete a content from global catalog (ADMIN/MANAGER)",
  })
  deleteContent(@Param("id") id: string, @Request() req: any) {
    return this.catalog.removeContent(id, req.user.roles ?? []);
  }

  // ── Content Lines ─────────────────────────────────────────────────────────

  @Get("content-lines")
  @ApiOperation({ summary: "List content lines" })
  getContentLines() {
    return this.catalog.findContentLines();
  }

  @Post("content-lines")
  @ApiOperation({ summary: "Create a content line (all roles)" })
  createContentLine(@Body("name") name: string) {
    return this.catalog.createContentLine(name);
  }

  @Patch("content-lines/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Update content line (a_type)" })
  updateContentLine(
    @Param("id") id: string,
    @Body() body: { a_type?: string | null },
  ) {
    return this.catalog.updateContentLine(id, body);
  }

  @Delete("content-lines/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Delete a content line" })
  deleteContentLine(@Param("id") id: string) {
    return this.catalog.removeContentLine(id);
  }

  // ── Content Classifications (VD: Content Win, Content Test) ─────────────────

  @Get("content-classifications")
  @ApiOperation({ summary: "List content classifications" })
  getContentClassifications() {
    return this.catalog.findContentClassifications();
  }

  @Post("content-classifications")
  @ApiOperation({ summary: "Create a content classification (all roles)" })
  createContentClassification(@Body("name") name: string) {
    return this.catalog.createContentClassification(name);
  }

  @Patch("content-classifications/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Rename a content classification" })
  updateContentClassification(
    @Param("id") id: string,
    @Body("name") name: string,
  ) {
    return this.catalog.updateContentClassification(id, name);
  }

  @Delete("content-classifications/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Delete a content classification" })
  deleteContentClassification(@Param("id") id: string) {
    return this.catalog.removeContentClassification(id);
  }

  // ── Sources ───────────────────────────────────────────────────────────────

  @Get("sources")
  @ApiOperation({ summary: "List sources" })
  getSources(@Query() q: QuerySourceDto) {
    return this.catalog.findAllSources(q);
  }

  @Get("sources/:id")
  @ApiOperation({ summary: "Get source detail" })
  getSource(@Param("id") id: string) {
    return this.catalog.findOneSource(id);
  }

  @Post("sources")
  @ApiOperation({ summary: "Create a source (all roles)" })
  createSource(@Body() dto: CreateSourceDto, @Request() req: any) {
    return this.catalog.createSource(dto, req.user.id, req.user.roles ?? []);
  }

  @Put("sources/:id")
  @ApiOperation({ summary: "Update a source (all roles)" })
  updateSource(
    @Param("id") id: string,
    @Body() dto: UpdateSourceDto,
    @Request() req: any,
  ) {
    return this.catalog.updateSource(
      id,
      dto,
      req.user.id,
      req.user.roles ?? [],
    );
  }

  @Delete("sources/:id")
  @UseGuards(ScaleDataSourceGuard)
  @ApiOperation({
    summary: "Delete a source from global catalog (ADMIN/MANAGER/Scale Data)",
  })
  deleteSource(@Param("id") id: string, @Request() req: any) {
    return this.catalog.removeSource(id, req.user.roles ?? []);
  }
}
