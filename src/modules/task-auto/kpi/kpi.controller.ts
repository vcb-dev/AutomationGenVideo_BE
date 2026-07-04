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
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../../common/guards/roles.guard";
import { Roles } from "../../../common/decorators/roles.decorator";
import { TaskAutoKpiService } from "./kpi.service";
import { UpsertTeamKpiDto, UpsertEditorKpiDto } from "./kpi.dto";

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

  // ── Editor KPI ────────────────────────────────────────────────────────────

  @Get("kpi/editors")
  @ApiOperation({ summary: "Get editor KPIs" })
  getEditorKpis(
    @Query("month") month?: string,
    @Query("user_id") userId?: string,
  ) {
    return this.kpi.getEditorKpis(month, userId);
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
}
