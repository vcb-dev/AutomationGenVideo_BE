import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { ApiKeyReadOnly } from "../../api-keys/decorators/api-key-read-only.decorator";
import { JwtOrApiKeyGuard } from "../../api-keys/guards/jwt-or-api-key.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import {
  QueryComplianceDayDto,
  QueryComplianceHistoryDto,
} from "./dto/compliance-history.dto";
import { TaskCompliancePayrollSyncQueryDto } from "./dto/compliance-payroll-sync.dto";
import { TaskComplianceService } from "./task-compliance.service";

@ApiTags("task-auto")
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard)
@Controller("task-auto/compliance-history")
export class TaskComplianceController {
  constructor(private compliance: TaskComplianceService) {}

  @Get()
  @ApiOperation({
    summary: "Lịch sử ngày không hoàn thành đủ task theo kế hoạch",
  })
  findAll(@Query() query: QueryComplianceHistoryDto, @Request() req: any) {
    return this.compliance.findHistory(
      { id: req.user.id, roles: req.user.roles ?? [] },
      query,
    );
  }

  @Get("day")
  @ApiOperation({
    summary: "Chi tiết một người trong một ngày: từng tuyến thiếu bao nhiêu và task nào chưa nộp đúng hạn",
  })
  @ApiNotFoundResponse({ description: "Không có dữ liệu hoặc không có quyền xem" })
  findDay(@Query() query: QueryComplianceDayDto, @Request() req: any) {
    return this.compliance.findDayDetail(
      { id: req.user.id, roles: req.user.roles ?? [] },
      query,
    );
  }
}

@ApiTags("task-auto")
@ApiBearerAuth()
@ApiKeyReadOnly()
@UseGuards(JwtOrApiKeyGuard)
@Controller("task-auto")
export class TaskCompliancePayrollSyncController {
  constructor(private compliance: TaskComplianceService) {}

  @Get("teams/:teamId/task-compliance/payroll-sync")
  @UseGuards(RolesGuard)
  @Roles("ADMIN")
  @ApiHeader({
    name: "X-API-Key",
    required: false,
    description:
      "API key của hệ thống lương; có thể dùng JWT ADMIN khi thử trên Swagger",
  })
  @ApiParam({
    name: "teamId",
    description: "Team ID bên AutomationGenVideo (UUID)",
  })
  @ApiOperation({
    summary: "Snapshot lịch sử thiếu nhiệm vụ cho hệ thống lương",
    description:
      "Summary được tính trên toàn bộ snapshot trong khoảng ngày; records chỉ chứa các dòng có nhiệm vụ thiếu. " +
      "shortfall_summary, days[] (group_by=person_day) và tasks/untracked_missing của từng tuyến lấy từ cùng hàm với màn Nhiệm vụ còn thiếu nên số liệu trùng khớp. " +
      "Endpoint chỉ đọc và không kích hoạt đánh giá lại.",
  })
  @ApiOkResponse({
    description: "Snapshot tuân thủ nhiệm vụ theo team, nhân sự và khoảng ngày",
    schema: {
      example: {
        contract_version: "1.1",
        generated_at: "2026-10-02T02:00:00.000Z",
        timezone: "Asia/Ho_Chi_Minh",
        range: { from: "2026-09-01", to: "2026-09-30" },
        team: { id: "0f2a1b3c-0000-4000-8000-000000000001", name: "Team K2" },
        filters: {
          user_id: "11111111-1111-4111-8111-111111111111",
          group_by: "line",
        },
        coverage: {
          snapshot_count: 24,
          evaluated_from: "2026-09-01",
          evaluated_through: "2026-09-29",
        },
        summary: {
          expected: 50,
          completed_on_time: 46,
          missing: 4,
          affected_days: 3,
          affected_records: 4,
        },
        shortfall_summary: {
          person_days: 3,
          lines: 4,
          expected: 9,
          completed: 5,
          missing: 4,
        },
        records: [
          {
            id: "compliance-record-id",
            user_id: "11111111-1111-4111-8111-111111111111",
            employee_id: "K2_07",
            user_name: "Nguyễn Văn A",
            team_id: "0f2a1b3c-0000-4000-8000-000000000001",
            work_date: "2026-09-15",
            content_line: { id: "content-line-id", name: "A4" },
            source: "AUTO_A4",
            expected_count: 3,
            completed_count: 2,
            missing_count: 1,
            deadline: "2026-09-15T10:00:00.000Z",
            evaluated_at: "2026-09-16T00:05:00.000Z",
            untracked_missing: 0,
            tasks: [
              {
                id: "task-id",
                title: "Review nồi chiên",
                product_name: "Nồi chiên",
                status: "ASSIGNED",
                deadline: "2026-09-15T10:00:00.000Z",
                submitted_at: null,
                on_time: false,
              },
            ],
          },
        ],
        pagination: { page: 1, limit: 20, total: 4, total_pages: 1 },
        warnings: [],
      },
    },
  })
  @ApiBadRequestResponse({
    description: "UUID, khoảng ngày hoặc phân trang không hợp lệ",
  })
  @ApiNotFoundResponse({ description: "Team không tồn tại" })
  payrollSync(
    @Param("teamId", new ParseUUIDPipe({ version: "4" })) teamId: string,
    @Query() query: TaskCompliancePayrollSyncQueryDto,
  ) {
    return this.compliance.payrollSync(teamId, query);
  }
}
