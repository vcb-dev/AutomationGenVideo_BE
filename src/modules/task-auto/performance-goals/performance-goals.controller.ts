import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { JwtOrApiKeyGuard } from "../../api-keys/guards/jwt-or-api-key.guard";
import { ApiKeyReadOnly } from "../../api-keys/decorators/api-key-read-only.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import {
  ArchivePerformanceGoalQueryDto,
  CreatePerformanceGoalDto,
  CreatePerformanceKpiGroupDto,
  PerformanceKpiGroupQueryDto,
  PerformanceGoalPayrollQueryDto,
  PerformanceGoalQueryDto,
  UpdatePerformanceGoalDto,
  UpdatePerformanceKpiGroupDto,
} from "./dto/performance-goal.dto";
import { PerformanceGoalsService } from "./performance-goals.service";

@ApiTags("task-auto-performance-goals")
@ApiBearerAuth()
@ApiKeyReadOnly()
@UseGuards(JwtOrApiKeyGuard)
@Controller("task-auto")
export class PerformanceGoalsController {
  constructor(private readonly goals: PerformanceGoalsService) {}

  @Get("performance-kpi-groups")
  @ApiOperation({ summary: "Danh mục nhóm KPI cố định và nhóm KPI tự tạo" })
  listKpiGroups(@Query() query: PerformanceKpiGroupQueryDto, @Request() req: any) {
    return this.goals.listKpiGroups(query, req.user);
  }

  @Post("performance-kpi-groups")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Tạo nhóm KPI riêng cho team" })
  createKpiGroup(@Body() dto: CreatePerformanceKpiGroupDto, @Request() req: any) {
    return this.goals.createKpiGroup(dto, req.user);
  }

  @Patch("performance-kpi-groups/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Sửa nhóm KPI tự tạo" })
  updateKpiGroup(
    @Param("id") id: string,
    @Body() dto: UpdatePerformanceKpiGroupDto,
    @Request() req: any,
  ) {
    return this.goals.updateKpiGroup(id, dto, req.user);
  }

  @Delete("performance-kpi-groups/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Lưu trữ nhóm KPI tự tạo khi không còn đầu mục hoạt động" })
  archiveKpiGroup(@Param("id") id: string, @Request() req: any) {
    return this.goals.archiveKpiGroup(id, req.user);
  }

  @Get("performance-goals")
  @ApiOperation({ summary: "Danh sách KPI/OKR tùy chỉnh theo tháng" })
  list(@Query() query: PerformanceGoalQueryDto, @Request() req: any) {
    return this.goals.list(query, req.user);
  }

  @Post("performance-goals")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Giao KPI/OKR tùy chỉnh cho một nhân sự" })
  create(@Body() dto: CreatePerformanceGoalDto, @Request() req: any) {
    return this.goals.create(dto, req.user);
  }

  @Patch("performance-goals/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Sửa mục tiêu hoặc actual KPI/OKR" })
  update(
    @Param("id") id: string,
    @Body() dto: UpdatePerformanceGoalDto,
    @Request() req: any,
  ) {
    return this.goals.update(id, dto, req.user);
  }

  @Delete("performance-goals/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Lưu trữ mềm KPI/OKR và giữ toàn bộ lịch sử" })
  archive(
    @Param("id") id: string,
    @Query() query: ArchivePerformanceGoalQueryDto,
    @Request() req: any,
  ) {
    return this.goals.archive(id, query, req.user);
  }

  @Get("performance-goals/:id/history")
  @ApiOperation({ summary: "Lịch sử phiên bản KPI/OKR" })
  history(@Param("id") id: string, @Request() req: any) {
    return this.goals.history(id, req.user);
  }

  @Get("teams/:id/performance-goals/payroll-sync")
  @UseGuards(RolesGuard)
  @Roles("ADMIN")
  @ApiHeader({
    name: "X-API-Key",
    required: false,
    description: "API key của hệ thống lương; có thể dùng JWT ADMIN khi thử trên Swagger",
  })
  @ApiOperation({
    summary: "Snapshot KPI/OKR tùy chỉnh cho hệ thống lương",
    description:
      "Chỉ trả item PUBLISHED. actual_final ưu tiên số nhập tay; progress dùng tính điều kiện tổng được cap 100%.",
  })
  payrollSync(
    @Param("id") teamId: string,
    @Query() query: PerformanceGoalPayrollQueryDto,
  ) {
    return this.goals.payrollSync(teamId, query.month);
  }
}
