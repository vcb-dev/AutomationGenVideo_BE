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
import { TaskAutoTeamsService } from "./teams.service";
import { TaskAutoTasksService } from "../tasks/tasks.service";
import { CreateTeamDto, UpdateTeamDto, EditorApprovalDto, SetEditorDto } from "../dto/team.dto";
import {
  CreateTeamProductDto,
  UpdateTeamProductDto,
  CreateTeamContentDto,
  UpdateTeamContentDto,
  CreateTeamSourceDto,
  UpdateTeamSourceDto,
} from "../dto/catalog.dto";

@ApiTags("task-auto")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("task-auto")
export class TaskAutoTeamsController {
  constructor(
    private teams: TaskAutoTeamsService,
    private tasks: TaskAutoTasksService,
  ) {}

  // ── Teams ─────────────────────────────────────────────────────────────────

  @Get("teams")
  @ApiOperation({ summary: "List all teams" })
  getTeams() {
    return this.teams.findAll();
  }

  @Get("teams/:id")
  @ApiOperation({ summary: "Get team detail" })
  getTeam(@Param("id") id: string) {
    return this.teams.findOne(id);
  }

  @Post("teams")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Create a team" })
  createTeam(@Body() dto: CreateTeamDto) {
    return this.teams.create(dto);
  }

  @Put("teams/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Update a team. LEADER chỉ được đổi brand_type của team mình lead." })
  updateTeam(
    @Param("id") id: string,
    @Body() dto: UpdateTeamDto,
    @Request() req: any,
  ) {
    return this.teams.update(id, dto, req.user.id, req.user.roles ?? []);
  }

  @Delete("teams/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Delete a team" })
  deleteTeam(@Param("id") id: string) {
    return this.teams.remove(id);
  }

  @Patch("teams/:id/members/:userId/editor")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Directly set/unset a team member as Editor" })
  setMemberEditor(
    @Param("id") teamId: string,
    @Param("userId") userId: string,
    @Body() dto: SetEditorDto,
    @Request() req: any,
  ) {
    return this.teams.setMemberEditorDirect(
      teamId,
      userId,
      dto.is_editor,
      req.user.id,
      req.user.roles ?? [],
    );
  }

  // ── Team Products ─────────────────────────────────────────────────────────

  @Get("teams/:id/products")
  @ApiOperation({ summary: "List products in team inventory (standalone)" })
  listTeamProducts(
    @Param("id") teamId: string,
    @Query("brand_type") brandType?: string,
    @Query("month") month?: string,
  ) {
    return this.teams.listTeamProducts(teamId, brandType as any, month);
  }

  @Post("teams/:id/products")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER", "MEMBER")
  @ApiOperation({ summary: "Add product to team inventory (copy from catalog or create new)" })
  addTeamProduct(
    @Param("id") teamId: string,
    @Body() dto: CreateTeamProductDto,
    @Request() req: any,
  ) {
    return this.teams.addTeamProduct(teamId, dto, req.user.id, req.user.roles ?? []);
  }

  @Patch("teams/:id/products/:teamProductId")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Update team product (LEADER/ADMIN/MANAGER)" })
  updateTeamProduct(
    @Param("id") teamId: string,
    @Param("teamProductId") teamProductId: string,
    @Body() dto: UpdateTeamProductDto,
    @Request() req: any,
  ) {
    return this.teams.updateTeamProduct(teamId, teamProductId, dto, req.user.id, req.user.roles ?? []);
  }

  @Patch("teams/:id/products/:teamProductId/push")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Push team product to global catalog (LEADER/ADMIN/MANAGER)" })
  pushTeamProduct(
    @Param("id") teamId: string,
    @Param("teamProductId") teamProductId: string,
    @Request() req: any,
  ) {
    return this.teams.pushTeamProductToGlobal(teamId, teamProductId, req.user.id, req.user.roles ?? []);
  }

  @Delete("teams/:id/products/:teamProductId")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Remove product from team inventory (LEADER/ADMIN/MANAGER)" })
  removeTeamProduct(
    @Param("id") teamId: string,
    @Param("teamProductId") teamProductId: string,
    @Request() req: any,
  ) {
    return this.teams.removeTeamProduct(teamId, teamProductId, req.user.id, req.user.roles ?? []);
  }

  // ── Team Contents ─────────────────────────────────────────────────────────

  @Get("teams/:id/contents")
  @ApiOperation({ summary: "List contents in team storage (standalone)" })
  listTeamContents(
    @Param("id") teamId: string,
    @Query("brand_type") brandType?: string,
    @Query("month") month?: string,
  ) {
    return this.teams.listTeamContents(teamId, brandType as any, month);
  }

  @Post("teams/:id/contents")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER", "MEMBER")
  @ApiOperation({ summary: "Add content to team storage (copy from catalog or create new)" })
  addTeamContent(
    @Param("id") teamId: string,
    @Body() dto: CreateTeamContentDto,
    @Request() req: any,
  ) {
    return this.teams.addTeamContent(teamId, dto, req.user.id, req.user.roles ?? []);
  }

  @Patch("teams/:id/contents/:teamContentId")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Update team content (LEADER/ADMIN/MANAGER)" })
  updateTeamContent(
    @Param("id") teamId: string,
    @Param("teamContentId") teamContentId: string,
    @Body() dto: UpdateTeamContentDto,
    @Request() req: any,
  ) {
    return this.teams.updateTeamContent(teamId, teamContentId, dto, req.user.id, req.user.roles ?? []);
  }

  @Patch("teams/:id/contents/:teamContentId/push")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Push team content to global catalog (LEADER/ADMIN/MANAGER)" })
  pushTeamContent(
    @Param("id") teamId: string,
    @Param("teamContentId") teamContentId: string,
    @Request() req: any,
  ) {
    return this.teams.pushTeamContentToGlobal(teamId, teamContentId, req.user.id, req.user.roles ?? []);
  }

  @Delete("teams/:id/contents/:teamContentId")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER", "MEMBER")
  @ApiOperation({ summary: "Remove content from team storage" })
  removeTeamContent(
    @Param("id") teamId: string,
    @Param("teamContentId") teamContentId: string,
    @Request() req: any,
  ) {
    return this.teams.removeTeamContent(teamId, teamContentId, req.user.id, req.user.roles ?? []);
  }

  // ── Team Sources ──────────────────────────────────────────────────────────

  @Get("teams/:id/sources")
  @ApiOperation({ summary: "List sources in team inventory" })
  listTeamSources(
    @Param("id") teamId: string,
    @Query("brand_type") brandType?: string,
    @Query("product_id") productId?: string,
    @Query("team_product_id") teamProductId?: string,
    @Query("month") month?: string,
  ) {
    return this.teams.listTeamSources(teamId, brandType as any, productId, teamProductId, month);
  }

  @Post("teams/:id/sources")
  @UseGuards(ScaleDataSourceGuard)
  @ApiOperation({ summary: "Add source to team inventory (ADMIN/MANAGER/LEADER/MEMBER/Scale Data)" })
  addTeamSource(
    @Param("id") teamId: string,
    @Body() dto: CreateTeamSourceDto,
    @Request() req: any,
  ) {
    return this.teams.addTeamSource(teamId, dto, req.user.id, req.user.roles ?? []);
  }

  @Patch("teams/:id/sources/:teamSourceId")
  @UseGuards(ScaleDataSourceGuard)
  @ApiOperation({ summary: "Update team source (ADMIN/MANAGER/LEADER/Scale Data)" })
  updateTeamSource(
    @Param("id") teamId: string,
    @Param("teamSourceId") teamSourceId: string,
    @Body() dto: UpdateTeamSourceDto,
    @Request() req: any,
  ) {
    return this.teams.updateTeamSource(teamId, teamSourceId, dto, req.user.id, req.user.roles ?? []);
  }

  @Patch("teams/:id/sources/:teamSourceId/push")
  @UseGuards(ScaleDataSourceGuard)
  @ApiOperation({ summary: "Push team source to global catalog (ADMIN/MANAGER/LEADER/Scale Data)" })
  pushTeamSource(
    @Param("id") teamId: string,
    @Param("teamSourceId") teamSourceId: string,
    @Request() req: any,
  ) {
    return this.teams.pushTeamSourceToGlobal(teamId, teamSourceId, req.user.id, req.user.roles ?? []);
  }

  @Delete("teams/:id/sources/:teamSourceId")
  @UseGuards(ScaleDataSourceGuard)
  @ApiOperation({ summary: "Remove source from team inventory (ADMIN/MANAGER/LEADER/Scale Data)" })
  removeTeamSource(
    @Param("id") teamId: string,
    @Param("teamSourceId") teamSourceId: string,
    @Request() req: any,
  ) {
    return this.teams.removeTeamSource(teamId, teamSourceId, req.user.id, req.user.roles ?? []);
  }

  // ── Editor Approvals ──────────────────────────────────────────────────────

  @Get("editor-approvals")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "List editor approval requests" })
  getEditorApprovals(@Query("status") status?: string) {
    return this.teams.getEditorApprovals(status);
  }

  @Post("editor-approvals")
  @ApiOperation({ summary: "Request editor role approval" })
  requestEditorApproval(@Request() req: any) {
    return this.teams.requestEditorApproval(req.user.id);
  }

  @Put("editor-approvals/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Approve or reject an editor request" })
  reviewEditorApproval(
    @Param("id") id: string,
    @Body() dto: EditorApprovalDto,
    @Request() req: any,
  ) {
    return this.teams.reviewEditorApproval(id, dto, req.user.id);
  }

  // ── Misc ──────────────────────────────────────────────────────────────────

  @Get("users")
  @ApiOperation({ summary: "List all users (for member/assignee dropdowns)" })
  getUsers(@Query("role") role?: string) {
    return this.teams.listAllMembers(role);
  }

  @Get("teams/:id/member-source-stats")
  @ApiOperation({ summary: "Thống kê số source mỗi thành viên đã thêm trong tháng (không tính kho cá nhân)" })
  getMemberSourceStats(
    @Param("id") teamId: string,
    @Query("month") month?: string,
  ) {
    return this.teams.getMemberSourceStats(teamId, month);
  }

  @Get("dashboard")
  @ApiOperation({ summary: "Dashboard summary stats" })
  getDashboard(@Request() req: any) {
    return this.tasks.getDashboard(req.user.id, req.user.roles ?? []);
  }
}
