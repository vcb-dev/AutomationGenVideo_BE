import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { ScaleDataSourceGuard } from "../../../common/guards/scale-data-source.guard";
import { TaskAutoWarehouseService } from "./warehouse.service";
import {
  GetWarehouseQuery,
  AddToWarehouseDto,
  AddProductsToWarehouseDto,
  UpdateWarehouseQuantityDto,
  RemoveFromWarehouseDto,
  PushToMonthDto,
  AutoCarryDto,
} from "./warehouse.dto";

@ApiTags("task-auto")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("task-auto")
export class TaskAutoWarehouseController {
  constructor(private warehouse: TaskAutoWarehouseService) {}

  // Chỉ chính chủ (editorId khớp req.user.id) hoặc ADMIN/MANAGER mới được
  // truy cập kho tháng cá nhân của một editor.
  private assertOwnerOrPrivileged(ownerId: string, req: any) {
    const roles: string[] = req.user?.roles ?? [];
    const isPrivileged = roles.some((r) => ["ADMIN", "MANAGER"].includes(r));
    if (!isPrivileged && req.user?.id !== ownerId) {
      throw new ForbiddenException(
        "Bạn chỉ có thể truy cập kho cá nhân của mình",
      );
    }
  }

  // ── Kho tổng ──────────────────────────────────────────────────────────────

  @Get("warehouse/global")
  @ApiOperation({ summary: "Lấy kho tháng tổng (global)" })
  getGlobalWarehouse(@Query() q: GetWarehouseQuery) {
    const opts = q.page ? { page: q.page, limit: q.limit } : undefined;
    return this.warehouse.getGlobalWarehouse(q.month, q.brand_type, opts);
  }

  @Post("warehouse/global/products")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Thêm sản phẩm vào kho tháng tổng" })
  addGlobalProducts(@Body() dto: AddToWarehouseDto) {
    return this.warehouse.addGlobalProducts(dto);
  }

  @Delete("warehouse/global/products")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Xoá sản phẩm khỏi kho tháng tổng" })
  removeGlobalProducts(@Body() dto: RemoveFromWarehouseDto) {
    return this.warehouse.removeGlobalProducts(dto);
  }

  @Post("warehouse/global/contents")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Thêm content vào kho tháng tổng" })
  addGlobalContents(@Body() dto: AddToWarehouseDto) {
    return this.warehouse.addGlobalContents(dto);
  }

  @Delete("warehouse/global/contents")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Xoá content khỏi kho tháng tổng" })
  removeGlobalContents(@Body() dto: RemoveFromWarehouseDto) {
    return this.warehouse.removeGlobalContents(dto);
  }

  @Post("warehouse/global/sources")
  @UseGuards(ScaleDataSourceGuard)
  @ApiOperation({ summary: "Thêm source vào kho tháng tổng (ADMIN/MANAGER/Scale Data/MEDIA)" })
  addGlobalSources(@Body() dto: AddToWarehouseDto) {
    return this.warehouse.addGlobalSources(dto);
  }

  @Delete("warehouse/global/sources")
  @UseGuards(ScaleDataSourceGuard)
  @ApiOperation({ summary: "Xoá source khỏi kho tháng tổng (ADMIN/MANAGER/Scale Data/MEDIA)" })
  removeGlobalSources(@Body() dto: RemoveFromWarehouseDto) {
    return this.warehouse.removeGlobalSources(dto);
  }

  // ── Kho team ──────────────────────────────────────────────────────────────

  @Get("warehouse/teams/:teamId")
  @ApiOperation({ summary: "Lấy kho tháng của team" })
  getTeamWarehouse(@Param("teamId") teamId: string, @Query() q: GetWarehouseQuery) {
    const opts = q.page ? { page: q.page, limit: q.limit } : undefined;
    return this.warehouse.getTeamWarehouse(teamId, q.month, opts);
  }

  @Post("warehouse/teams/:teamId/products")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Thêm sản phẩm vào kho tháng team" })
  addTeamProducts(@Param("teamId") teamId: string, @Body() dto: AddProductsToWarehouseDto) {
    return this.warehouse.addTeamProducts(teamId, dto);
  }

  @Patch("warehouse/teams/:teamId/products/quantity")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Cập nhật target_quantity của sản phẩm trong kho tháng team" })
  updateTeamProductQuantity(
    @Param("teamId") teamId: string,
    @Body() dto: UpdateWarehouseQuantityDto,
  ) {
    return this.warehouse.updateTeamProductQuantity(teamId, dto);
  }

  @Delete("warehouse/teams/:teamId/products")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Xoá sản phẩm khỏi kho tháng team" })
  removeTeamProducts(@Param("teamId") teamId: string, @Body() dto: RemoveFromWarehouseDto) {
    return this.warehouse.removeTeamProducts(teamId, dto);
  }

  @Post("warehouse/teams/:teamId/contents")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Thêm content vào kho tháng team" })
  addTeamContents(@Param("teamId") teamId: string, @Body() dto: AddToWarehouseDto) {
    return this.warehouse.addTeamContents(teamId, dto);
  }

  @Delete("warehouse/teams/:teamId/contents")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Xoá content khỏi kho tháng team" })
  removeTeamContents(@Param("teamId") teamId: string, @Body() dto: RemoveFromWarehouseDto) {
    return this.warehouse.removeTeamContents(teamId, dto);
  }

  @Post("warehouse/teams/:teamId/sources")
  @UseGuards(ScaleDataSourceGuard)
  @ApiOperation({ summary: "Thêm source vào kho tháng team (ADMIN/MANAGER/LEADER/Scale Data/MEDIA)" })
  addTeamSources(@Param("teamId") teamId: string, @Body() dto: AddToWarehouseDto) {
    return this.warehouse.addTeamSources(teamId, dto);
  }

  @Delete("warehouse/teams/:teamId/sources")
  @UseGuards(ScaleDataSourceGuard)
  @ApiOperation({ summary: "Xoá source khỏi kho tháng team (ADMIN/MANAGER/LEADER/Scale Data/MEDIA)" })
  removeTeamSources(@Param("teamId") teamId: string, @Body() dto: RemoveFromWarehouseDto) {
    return this.warehouse.removeTeamSources(teamId, dto);
  }

  @Post("warehouse/teams/:teamId/push")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Push kho team từ tháng này sang tháng khác" })
  pushTeamToMonth(@Param("teamId") teamId: string, @Body() dto: PushToMonthDto) {
    return this.warehouse.pushTeamToMonth(teamId, dto);
  }

  // ── Kho editor ────────────────────────────────────────────────────────────

  @Get("warehouse/editors/:editorId")
  @ApiOperation({ summary: "Lấy kho tháng của editor" })
  getEditorWarehouse(
    @Param("editorId") editorId: string,
    @Query() q: GetWarehouseQuery,
    @Request() req: any,
  ) {
    this.assertOwnerOrPrivileged(editorId, req);
    const opts = q.page ? { page: q.page, limit: q.limit } : undefined;
    return this.warehouse.getEditorWarehouse(editorId, q.month, opts);
  }

  @Post("warehouse/editors/:editorId/products")
  @ApiOperation({ summary: "Thêm sản phẩm vào kho tháng editor" })
  addEditorProducts(
    @Param("editorId") editorId: string,
    @Body() dto: AddProductsToWarehouseDto,
    @Request() req: any,
  ) {
    this.assertOwnerOrPrivileged(editorId, req);
    return this.warehouse.addEditorProducts(editorId, dto);
  }

  @Patch("warehouse/editors/:editorId/products/quantity")
  @ApiOperation({ summary: "Cập nhật target_quantity của sản phẩm trong kho tháng editor" })
  updateEditorProductQuantity(
    @Param("editorId") editorId: string,
    @Body() dto: UpdateWarehouseQuantityDto,
    @Request() req: any,
  ) {
    this.assertOwnerOrPrivileged(editorId, req);
    return this.warehouse.updateEditorProductQuantity(editorId, dto);
  }

  @Delete("warehouse/editors/:editorId/products")
  @ApiOperation({ summary: "Xoá sản phẩm khỏi kho tháng editor" })
  removeEditorProducts(
    @Param("editorId") editorId: string,
    @Body() dto: RemoveFromWarehouseDto,
    @Request() req: any,
  ) {
    this.assertOwnerOrPrivileged(editorId, req);
    return this.warehouse.removeEditorProducts(editorId, dto);
  }

  @Post("warehouse/editors/:editorId/contents")
  @ApiOperation({ summary: "Thêm content vào kho tháng editor" })
  addEditorContents(
    @Param("editorId") editorId: string,
    @Body() dto: AddToWarehouseDto,
    @Request() req: any,
  ) {
    this.assertOwnerOrPrivileged(editorId, req);
    return this.warehouse.addEditorContents(editorId, dto);
  }

  @Delete("warehouse/editors/:editorId/contents")
  @ApiOperation({ summary: "Xoá content khỏi kho tháng editor" })
  removeEditorContents(
    @Param("editorId") editorId: string,
    @Body() dto: RemoveFromWarehouseDto,
    @Request() req: any,
  ) {
    this.assertOwnerOrPrivileged(editorId, req);
    return this.warehouse.removeEditorContents(editorId, dto);
  }

  @Post("warehouse/editors/:editorId/sources")
  @ApiOperation({ summary: "Thêm source vào kho tháng editor" })
  addEditorSources(
    @Param("editorId") editorId: string,
    @Body() dto: AddToWarehouseDto,
    @Request() req: any,
  ) {
    this.assertOwnerOrPrivileged(editorId, req);
    return this.warehouse.addEditorSources(editorId, dto);
  }

  @Delete("warehouse/editors/:editorId/sources")
  @ApiOperation({ summary: "Xoá source khỏi kho tháng editor" })
  removeEditorSources(
    @Param("editorId") editorId: string,
    @Body() dto: RemoveFromWarehouseDto,
    @Request() req: any,
  ) {
    this.assertOwnerOrPrivileged(editorId, req);
    return this.warehouse.removeEditorSources(editorId, dto);
  }

  @Post("warehouse/editors/:editorId/push")
  @ApiOperation({ summary: "Push kho editor từ tháng này sang tháng khác" })
  pushEditorToMonth(
    @Param("editorId") editorId: string,
    @Body() dto: PushToMonthDto,
    @Request() req: any,
  ) {
    this.assertOwnerOrPrivileged(editorId, req);
    return this.warehouse.pushEditorToMonth(editorId, dto);
  }

  // ── Auto-carry ────────────────────────────────────────────────────────────

  @Post("warehouse/auto-carry")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Copy kho tháng trước sang tháng mới (auto-carry)" })
  autoCarry(@Body() dto: AutoCarryDto) {
    return this.warehouse.autoCarry(dto);
  }
}
