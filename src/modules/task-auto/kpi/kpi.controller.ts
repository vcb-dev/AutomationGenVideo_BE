import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { TaskAutoKpiService } from "./kpi.service";
import {
  UpsertTeamKpiDto,
  UpsertEditorKpiDto,
  UpsertEditorDailyKpiDto,
  UpsertContentCreatorKpiDto,
  UpsertContentCreatorDailyKpiDto,
} from "./dto/kpi.dto";

@ApiTags("task-auto")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("task-auto")
export class TaskAutoKpiController {
  constructor(private kpi: TaskAutoKpiService) {}

  // ── Team KPI ──────────────────────────────────────────────────────────────

  @Get("kpi/teams")
  @ApiOperation({ summary: "Get team KPIs" })
  getTeamKpis(@Query("month") month?: string) {
    return this.kpi.getTeamKpis(month);
  }

  @Post("kpi/teams")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Upsert team KPI (LEADER: own team only)" })
  upsertTeamKpi(@Body() dto: UpsertTeamKpiDto, @Request() req: any) {
    return this.kpi.upsertTeamKpi(dto, req.user.id, req.user.roles ?? []);
  }

  @Delete("kpi/teams/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Delete team KPI" })
  deleteTeamKpi(@Param("id") id: string) {
    return this.kpi.deleteTeamKpi(id);
  }

  // ── Editor Daily KPI ──────────────────────────────────────────────────────
  // Khai báo trước "kpi/editors/:id" để path tĩnh "daily" không bị nuốt bởi :id.

  @Get("kpi/editors/daily")
  @ApiOperation({ summary: "Get editor daily KPIs (lọc theo ngày/khoảng/team/user)" })
  getEditorDailyKpis(
    @Query("date") date?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("team_id") teamId?: string,
    @Query("user_id") userId?: string,
  ) {
    return this.kpi.getEditorDailyKpis({
      date,
      from,
      to,
      team_id: teamId,
      user_id: userId,
    });
  }

  @Post("kpi/editors/daily")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({
    summary: "Upsert editor daily KPIs theo lô (team + ngày; LEADER: team mình)",
  })
  upsertEditorDailyKpis(
    @Body() dto: UpsertEditorDailyKpiDto,
    @Request() req: any,
  ) {
    return this.kpi.upsertEditorDailyKpis(dto, req.user.id, req.user.roles ?? []);
  }

  @Delete("kpi/editors/daily/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Delete editor daily KPI" })
  deleteEditorDailyKpi(@Param("id") id: string) {
    return this.kpi.deleteEditorDailyKpi(id);
  }

  // ── Editor KPI ────────────────────────────────────────────────────────────

  @Get("kpi/editors")
  @ApiOperation({ summary: "Get editor KPIs" })
  getEditorKpis(
    @Query("month") month?: string,
    @Query("user_id") userId?: string,
    @Query("team_id") teamId?: string,
    @Request() req?: any,
  ) {
    return this.kpi.getEditorKpis(month, userId, req?.user, teamId);
  }

  @Post("kpi/editors")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Upsert editor KPI" })
  upsertEditorKpi(@Body() dto: UpsertEditorKpiDto, @Request() req: any) {
    return this.kpi.upsertEditorKpi(dto, req.user.id, req.user.roles ?? []);
  }

  @Delete("kpi/editors/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Delete editor KPI" })
  deleteEditorKpi(@Param("id") id: string) {
    return this.kpi.deleteEditorKpi(id);
  }

  // ── Content Creator KPI Report (tự tính) ─────────────────────────────────
  // Khai báo trước "kpi/content-creators/:id" để path tĩnh "report" không bị nuốt bởi :id.

  @Get("kpi/content-creators/report")
  @ApiOperation({ summary: "Báo cáo tự tính content/bản dịch/video theo content creator" })
  getContentCreatorKpiReport(
    @Query("user_id") userId?: string,
    @Query("team_id") teamId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.kpi.getContentCreatorKpiReport({ user_id: userId, team_id: teamId, from, to });
  }

  // ── Content Creator Daily KPI ────────────────────────────────────────────
  // Khai báo trước "kpi/content-creators/:id" để path tĩnh "daily" không bị nuốt bởi :id.

  @Get("kpi/content-creators/daily")
  @ApiOperation({ summary: "Get content creator daily KPIs (lọc theo ngày/khoảng/team/user)" })
  getContentCreatorDailyKpis(
    @Query("date") date?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("team_id") teamId?: string,
    @Query("user_id") userId?: string,
  ) {
    return this.kpi.getContentCreatorDailyKpis({
      date,
      from,
      to,
      team_id: teamId,
      user_id: userId,
    });
  }

  @Post("kpi/content-creators/daily")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({
    summary: "Upsert content creator daily KPIs theo lô (team + ngày; LEADER: team mình)",
  })
  upsertContentCreatorDailyKpis(
    @Body() dto: UpsertContentCreatorDailyKpiDto,
    @Request() req: any,
  ) {
    return this.kpi.upsertContentCreatorDailyKpis(dto, req.user.id, req.user.roles ?? []);
  }

  @Delete("kpi/content-creators/daily/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Delete content creator daily KPI" })
  deleteContentCreatorDailyKpi(@Param("id") id: string) {
    return this.kpi.deleteContentCreatorDailyKpi(id);
  }

  // ── Content Creator KPI (tháng) ──────────────────────────────────────────

  @Get("kpi/content-creators")
  @ApiOperation({ summary: "Get content creator KPIs" })
  getContentCreatorKpis(
    @Query("month") month?: string,
    @Query("user_id") userId?: string,
  ) {
    return this.kpi.getContentCreatorKpis(month, userId);
  }

  @Post("kpi/content-creators")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Upsert content creator KPI" })
  upsertContentCreatorKpi(@Body() dto: UpsertContentCreatorKpiDto, @Request() req: any) {
    return this.kpi.upsertContentCreatorKpi(dto, req.user.id, req.user.roles ?? []);
  }

  @Delete("kpi/content-creators/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Delete content creator KPI" })
  deleteContentCreatorKpi(@Param("id") id: string) {
    return this.kpi.deleteContentCreatorKpi(id);
  }
}
