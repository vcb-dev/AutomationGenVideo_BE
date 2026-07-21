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
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../../common/guards/roles.guard";
import { Roles } from "../../../common/decorators/roles.decorator";
import { TaskAutoCatalogService } from "./catalog.service";
import {
  CreateEditorProductDto,
  UpdateEditorProductDto,
  QueryEditorProductDto,
  CreateEditorContentDto,
  UpdateEditorContentDto,
  QueryEditorContentDto,
  CreateEditorSourceDto,
  UpdateEditorSourceDto,
  QueryEditorSourceDto,
} from "./catalog.dto";

@ApiTags("task-auto")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("task-auto")
export class TaskAutoEditorCatalogController {
  constructor(private catalog: TaskAutoCatalogService) {}

  // Chỉ chính chủ (userId khớp req.user.id) hoặc ADMIN/MANAGER mới được
  // thêm mới vào kho cá nhân của một editor — mirrors the ownership check
  // already used by catalog.service.ts's update/remove editor-* methods.
  private assertOwnerOrPrivileged(ownerId: string, req: any) {
    const roles: string[] = req.user?.roles ?? [];
    const isPrivileged = roles.some((r) => ["ADMIN", "MANAGER"].includes(r));
    if (!isPrivileged && req.user?.id !== ownerId) {
      throw new ForbiddenException(
        "Bạn chỉ có thể truy cập kho cá nhân của mình",
      );
    }
  }

  // Dùng cho các route chỉ đọc (list/get): ngoài chính chủ và ADMIN/MANAGER,
  // LEADER cũng được xem kho cá nhân của thành viên trong team mình quản lý.
  private assertCanView(ownerId: string, req: any) {
    return this.catalog.assertCanViewEditorCatalog(
      ownerId,
      req.user?.id,
      req.user?.roles ?? [],
    );
  }

  // ── Editor Products ───────────────────────────────────────────────────────

  @Get("editors/:userId/products")
  @ApiOperation({ summary: "List editor personal products" })
  async listEditorProducts(
    @Param("userId") userId: string,
    @Query() q: QueryEditorProductDto,
    @Request() req: any,
  ) {
    await this.assertCanView(userId, req);
    return this.catalog.findAllEditorProducts(userId, q);
  }

  @Post("editors/:userId/products")
  @ApiOperation({
    summary:
      "Add product to editor personal catalog (copy from global or create new)",
  })
  addEditorProduct(
    @Param("userId") userId: string,
    @Body() dto: CreateEditorProductDto,
    @Request() req: any,
  ) {
    this.assertOwnerOrPrivileged(userId, req);
    return this.catalog.createEditorProduct(userId, dto);
  }

  @Get("editors/:userId/products/:epId")
  @ApiOperation({ summary: "Get editor product detail" })
  async getEditorProduct(
    @Param("userId") userId: string,
    @Param("epId") epId: string,
    @Request() req: any,
  ) {
    const ep = await this.catalog.findOneEditorProduct(epId);
    await this.assertCanView(ep.user_id, req);
    return ep;
  }

  @Patch("editors/:userId/products/:epId")
  @ApiOperation({ summary: "Update editor product" })
  updateEditorProduct(
    @Param("userId") userId: string,
    @Param("epId") epId: string,
    @Body() dto: UpdateEditorProductDto,
    @Request() req: any,
  ) {
    return this.catalog.updateEditorProduct(
      epId,
      dto,
      req.user.id,
      req.user.roles ?? [],
    );
  }

  @Delete("editors/:userId/products/:epId")
  @ApiOperation({ summary: "Delete editor product" })
  removeEditorProduct(
    @Param("userId") userId: string,
    @Param("epId") epId: string,
    @Request() req: any,
  ) {
    return this.catalog.removeEditorProduct(
      epId,
      req.user.id,
      req.user.roles ?? [],
    );
  }

  @Patch("editors/:userId/products/:epId/push-to-team")
  @ApiOperation({
    summary:
      "Push editor product to team catalog (member: tạo yêu cầu chờ leader duyệt)",
  })
  pushEditorProductToTeam(
    @Param("userId") userId: string,
    @Param("epId") epId: string,
    @Body("team_id") teamId: string,
    @Request() req: any,
  ) {
    return this.catalog.pushEditorProductToTeam(
      epId,
      teamId,
      req.user.id,
      req.user.roles ?? [],
    );
  }

  // ── Editor Contents ───────────────────────────────────────────────────────

  @Get("editors/:userId/contents")
  @ApiOperation({ summary: "List editor personal contents" })
  async listEditorContents(
    @Param("userId") userId: string,
    @Query() q: QueryEditorContentDto,
    @Request() req: any,
  ) {
    await this.assertCanView(userId, req);
    return this.catalog.findAllEditorContents(userId, q);
  }

  @Post("editors/:userId/contents")
  @ApiOperation({
    summary:
      "Add content to editor personal catalog (copy from global or create new)",
  })
  addEditorContent(
    @Param("userId") userId: string,
    @Body() dto: CreateEditorContentDto,
    @Request() req: any,
  ) {
    this.assertOwnerOrPrivileged(userId, req);
    return this.catalog.createEditorContent(userId, dto);
  }

  @Get("editors/:userId/contents/:ecId")
  @ApiOperation({ summary: "Get editor content detail" })
  async getEditorContent(
    @Param("userId") userId: string,
    @Param("ecId") ecId: string,
    @Request() req: any,
  ) {
    const ec = await this.catalog.findOneEditorContent(ecId);
    await this.assertCanView(ec.user_id, req);
    return ec;
  }

  @Patch("editors/:userId/contents/:ecId")
  @ApiOperation({ summary: "Update editor content" })
  updateEditorContent(
    @Param("userId") userId: string,
    @Param("ecId") ecId: string,
    @Body() dto: UpdateEditorContentDto,
    @Request() req: any,
  ) {
    return this.catalog.updateEditorContent(
      ecId,
      dto,
      req.user.id,
      req.user.roles ?? [],
    );
  }

  @Delete("editors/:userId/contents/:ecId")
  @ApiOperation({ summary: "Delete editor content" })
  removeEditorContent(
    @Param("userId") userId: string,
    @Param("ecId") ecId: string,
    @Request() req: any,
  ) {
    return this.catalog.removeEditorContent(
      ecId,
      req.user.id,
      req.user.roles ?? [],
    );
  }

  @Patch("editors/:userId/contents/:ecId/push-to-team")
  @ApiOperation({
    summary:
      "Push editor content to team catalog (member: tạo yêu cầu chờ leader duyệt)",
  })
  pushEditorContentToTeam(
    @Param("userId") userId: string,
    @Param("ecId") ecId: string,
    @Body("team_id") teamId: string,
    @Request() req: any,
  ) {
    return this.catalog.pushEditorContentToTeam(
      ecId,
      teamId,
      req.user.id,
      req.user.roles ?? [],
    );
  }

  // ── Editor Sources ────────────────────────────────────────────────────────

  @Get("editors/:userId/sources")
  @ApiOperation({ summary: "List editor personal sources" })
  async listEditorSources(
    @Param("userId") userId: string,
    @Query() q: QueryEditorSourceDto,
    @Request() req: any,
  ) {
    await this.assertCanView(userId, req);
    return this.catalog.findAllEditorSources(userId, q);
  }

  @Post("editors/:userId/sources")
  @ApiOperation({
    summary:
      "Add source to editor personal catalog (copy from global or create new)",
  })
  addEditorSource(
    @Param("userId") userId: string,
    @Body() dto: CreateEditorSourceDto,
    @Request() req: any,
  ) {
    this.assertOwnerOrPrivileged(userId, req);
    return this.catalog.createEditorSource(userId, dto);
  }

  @Get("editors/:userId/sources/:esId")
  @ApiOperation({ summary: "Get editor source detail" })
  async getEditorSource(
    @Param("userId") userId: string,
    @Param("esId") esId: string,
    @Request() req: any,
  ) {
    const es = await this.catalog.findOneEditorSource(esId);
    await this.assertCanView(es.user_id, req);
    return es;
  }

  @Patch("editors/:userId/sources/:esId")
  @ApiOperation({ summary: "Update editor source" })
  updateEditorSource(
    @Param("userId") userId: string,
    @Param("esId") esId: string,
    @Body() dto: UpdateEditorSourceDto,
    @Request() req: any,
  ) {
    return this.catalog.updateEditorSource(
      esId,
      dto,
      req.user.id,
      req.user.roles ?? [],
    );
  }

  @Delete("editors/:userId/sources/:esId")
  @ApiOperation({ summary: "Delete editor source" })
  removeEditorSource(
    @Param("userId") userId: string,
    @Param("esId") esId: string,
    @Request() req: any,
  ) {
    return this.catalog.removeEditorSource(
      esId,
      req.user.id,
      req.user.roles ?? [],
    );
  }

  @Patch("editors/:userId/sources/:esId/push-to-team")
  @ApiOperation({ summary: "Push editor source to team catalog" })
  pushEditorSourceToTeam(
    @Param("userId") userId: string,
    @Param("esId") esId: string,
    @Body("team_id") teamId: string,
    @Request() req: any,
  ) {
    return this.catalog.pushEditorSourceToTeam(esId, teamId, req.user.id);
  }

  // ── Team push requests (duyệt đẩy kho cá nhân → kho team) ─────────────────

  @Get("editors/:userId/push-requests")
  @ApiOperation({ summary: "List my team push requests" })
  listMyPushRequests(
    @Param("userId") userId: string,
    @Query("status") status: string | undefined,
    @Request() req: any,
  ) {
    return this.catalog.listMyPushRequests(req.user.id, status);
  }

  @Get("teams/:teamId/push-requests")
  @ApiOperation({ summary: "List team push requests (leader/admin/manager)" })
  listTeamPushRequests(
    @Param("teamId") teamId: string,
    @Query("status") status: string | undefined,
    @Request() req: any,
  ) {
    return this.catalog.listTeamPushRequests(
      teamId,
      status,
      req.user.id,
      req.user.roles ?? [],
    );
  }

  @Get("teams/:teamId/push-stats")
  @ApiOperation({
    summary:
      "Monthly count of content approved into team catalog per member (leader/admin/manager)",
  })
  getTeamMonthlyPushStats(
    @Param("teamId") teamId: string,
    @Query("month") month: string | undefined,
    @Request() req: any,
  ) {
    return this.catalog.getTeamMonthlyPushStats(
      teamId,
      month,
      req.user.id,
      req.user.roles ?? [],
    );
  }

  @Patch("push-requests/:id/review")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({
    summary:
      "Approve/reject team push request (leader of team or admin/manager)",
  })
  reviewPushRequest(
    @Param("id") id: string,
    @Body() body: { action: "APPROVED" | "REJECTED"; note?: string },
    @Request() req: any,
  ) {
    return this.catalog.reviewTeamPushRequest(
      id,
      body.action,
      body.note,
      req.user.id,
      req.user.roles ?? [],
    );
  }
}
