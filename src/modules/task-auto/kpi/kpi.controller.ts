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
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiHeader,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
} from "@nestjs/swagger";
import { JwtOrApiKeyGuard } from "../../api-keys/guards/jwt-or-api-key.guard";
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
import { KpiPayrollSyncQueryDto } from "./dto/kpi-payroll-sync.dto";

@ApiTags("task-auto")
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard)
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

  // ── Content Win/Fail Stats (tự tính, 1 link bài đăng bất kỳ >10.000 view) ──
  // Tách biệt hoàn toàn content-report (nhập tay) — xem kpi.service.ts.

  @Get("kpi/content-win-fail")
  @ApiOperation({
    summary:
      "Thống kê content win/fail tự động (1 link bài đăng bất kỳ >10.000 view = win) theo content creator và editor",
  })
  getContentWinFailStats(
    @Query("user_id") userId?: string,
    @Query("team_id") teamId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.kpi.getContentWinFailStats({
      user_id: userId,
      team_id: teamId,
      from,
      to,
    });
  }

  // POST vì có side-effect: gọi API FB/YouTube/IG + ghi lại published_links trước khi trả số
  // liệu — dùng khi FE bấm "Cập nhật", không chờ cron 8:15.
  @Post("kpi/content-win-fail/refresh")
  @ApiOperation({
    summary:
      "Cào lại traffic mới nhất (mọi nền tảng) rồi tính lại content win/fail",
  })
  refreshContentWinFailStats(
    @Query("user_id") userId?: string,
    @Query("team_id") teamId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.kpi.refreshContentWinFailStats({
      user_id: userId,
      team_id: teamId,
      from,
      to,
    });
  }

  // Mặc định cho ADMIN/MANAGER ở trang Tổng quan khi chưa chọn team/thành viên — top N người
  // nhiều content win nhất TOÀN HỆ THỐNG, khỏi bắt chọn team trước.
  @Get("kpi/content-win-fail/top")
  @ApiOperation({
    summary: "Top N người có nhiều content win nhất toàn hệ thống",
  })
  getTopContentWinFailMembers(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return this.kpi.getTopContentWinFailMembers({
      from,
      to,
      limit: parsedLimit && parsedLimit > 0 ? parsedLimit : undefined,
    });
  }

  // Nút "Cập nhật" khi đang xem bảng xếp hạng Top N (không có team_id/user_id cho route trên) —
  // chỉ cào lại traffic cho top N đang hiển thị (xem kpi.service.ts#refreshPublishedLinksForMembers).
  @Post("kpi/content-win-fail/top/refresh")
  @ApiOperation({
    summary:
      "Cào lại traffic cho top N người đang hiển thị rồi tính lại xếp hạng",
  })
  refreshTopContentWinFailMembers(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return this.kpi.refreshTopContentWinFailMembers({
      from,
      to,
      limit: parsedLimit && parsedLimit > 0 ? parsedLimit : undefined,
    });
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

  @Get("teams/:id/kpi-payroll-sync")
  @UseGuards(RolesGuard)
  @Roles("ADMIN")
  @ApiOperation({
    summary: "KPI target/actual snapshot for external payroll sync",
    description:
      "Trả toàn bộ target + actual KPI của một team trong một tháng cho hệ thống lương ngoài " +
      "(VCB Salary). Read-only: không ghi dữ liệu, không gọi API mạng ngoài, không refresh traffic.\n\n" +
      "Xác thực bằng header `X-API-Key: agv_...` (service account role ADMIN) hoặc JWT của user " +
      "ADMIN khi thử tay trên Swagger.\n\n" +
      "Consumer phải resolve KPI item bằng CẶP `(group_code, metric_code)` — `metric_code` có thể " +
      "trùng giữa các nhóm (vd `CONTENT_COLLECTED`).\n\n" +
      "`target` luôn đến từ bảng KPI đặt tay (`editor_kpis` / `content_creator_kpis`); `actual` " +
      "luôn đến từ báo cáo tự tính. Metric chưa có nguồn báo cáo thì `actual: null` kèm warning " +
      "`NO_ACTUAL_SOURCE` — khác hẳn với `actual: 0` (đo được và bằng 0).\n\n" +
      "Tháng không có KPI thì vẫn 200 với `records: []`, không phải 404.",
  })
  @ApiParam({ name: "id", description: "Team ID (UUID)" })
  @ApiQuery({ name: "month", required: true, example: "2026-09", description: "Tháng YYYY-MM" })
  @ApiHeader({
    name: "X-API-Key",
    required: false,
    description: "API key hệ thống ngoài (agv_...). Bỏ trống nếu dùng JWT ADMIN.",
  })
  @ApiOkResponse({
    description: "Snapshot KPI của team trong tháng",
    schema: {
      example: {
        contract_version: "1.0",
        month: "2026-09",
        team: { id: "0f2a1b3c-0000-4000-8000-000000000001", name: "Team K2" },
        generated_at: "2026-09-12T04:00:00.000Z",
        records: [
          {
            user_id: "11111111-1111-4111-8111-111111111111",
            employee_id: "K2_07",
            group_code: "VIDEO_PRODUCTION",
            metric_code: "TOTAL_VIDEO",
            target: 40,
            actual: 35,
          },
          {
            user_id: "11111111-1111-4111-8111-111111111111",
            employee_id: "K2_07",
            group_code: "VIDEO_PRODUCTION",
            metric_code: "VIDEO_WIN",
            target: 15,
            actual: 12,
          },
          {
            user_id: "11111111-1111-4111-8111-111111111111",
            employee_id: "K2_07",
            group_code: "VIDEO_PRODUCTION",
            metric_code: "CONTENT_ROUTE_A1",
            target: 15,
            actual: 12,
          },
          {
            user_id: "11111111-1111-4111-8111-111111111111",
            employee_id: "K2_07",
            group_code: "PRODUCT",
            metric_code: "PRODUCT_PROFIT",
            target: 3,
            actual: 2,
          },
          {
            user_id: "11111111-1111-4111-8111-111111111111",
            employee_id: "K2_07",
            group_code: "CONTENT",
            metric_code: "CONTENT_WIN_COVER",
            target: 4,
            actual: null,
          },
          {
            user_id: "22222222-2222-4222-8222-222222222222",
            employee_id: "K2_11",
            group_code: "AGV_CONTENT_CREATOR_MONTHLY",
            metric_code: "CONTENT_COLLECTED",
            target: 60,
            actual: 52,
          },
          {
            user_id: "22222222-2222-4222-8222-222222222222",
            employee_id: "K2_11",
            group_code: "AGV_CONTENT_CREATOR_MONTHLY",
            metric_code: "TRANSLATIONS",
            target: 30,
            actual: 28,
          },
        ],
        warnings: [
          {
            code: "NO_ACTUAL_SOURCE",
            message:
              "Chưa có nguồn báo cáo cho actual của: CONTENT_NEW, CONTENT_COLLECTED, CONTENT_WIN_COVER — các metric này chỉ có target, actual = null",
          },
          {
            code: "UNSCOPED_CREATOR_ACTUAL",
            user_id: "22222222-2222-4222-8222-222222222222",
            message:
              "User thuộc nhiều team; actual bản dịch/video/win/fail chưa quy được chính xác cho một team",
          },
        ],
      },
    },
  })
  @ApiBadRequestResponse({ description: "month thiếu hoặc không đúng dạng YYYY-MM" })
  @ApiUnauthorizedResponse({ description: "Thiếu/sai API key hoặc JWT" })
  @ApiForbiddenResponse({ description: "Principal hợp lệ nhưng không có role ADMIN" })
  @ApiNotFoundResponse({ description: "Team không tồn tại" })
  getTeamKpiPayrollSync(@Param("id") id: string, @Query() query: KpiPayrollSyncQueryDto) {
    return this.kpi.getTeamKpiPayrollSync(id, query.month);
  }
}
