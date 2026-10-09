import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtOrApiKeyGuard } from "../../api-keys/guards/jwt-or-api-key.guard";
import { DailyPlansService } from "./daily-plans.service";
import {
  MyDailyPlansQueryDto,
  PlanSearchQueryDto,
  QuickCreateFromPlanDto,
  QuickCreateFromSearchDto,
} from "./dto/daily-plan.dto";

@ApiTags("task-auto")
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard)
@Controller("task-auto/daily-plans")
export class DailyPlansController {
  constructor(private dailyPlans: DailyPlansService) {}

  @Get("me")
  @ApiOperation({ summary: "Kế hoạch ngày (chỉ tiêu theo tuyến + gợi ý content) của chính mình" })
  getMine(@Query() query: MyDailyPlansQueryDto, @Request() req: any) {
    return this.dailyPlans.getMyPlans(req.user.id, query);
  }

  @Post("quick-create")
  @ApiOperation({ summary: "Tạo task từ các gợi ý của Kế hoạch ngày (video win → tạo content kho cá nhân trước)" })
  quickCreate(@Body() dto: QuickCreateFromPlanDto, @Request() req: any) {
    return this.dailyPlans.quickCreate(req.user.id, req.user.roles ?? [], dto.suggestion_ids);
  }

  @Get(":id/search")
  @ApiOperation({ summary: "Tìm content trong kho (cá nhân/team/tổng) hoặc video win để tạo task cho kế hoạch — mặc định lọc theo tuyến của kế hoạch" })
  search(@Param("id") id: string, @Query() query: PlanSearchQueryDto, @Request() req: any) {
    return this.dailyPlans.searchForPlan(req.user.id, id, query);
  }

  @Post(":id/quick-create-item")
  @ApiOperation({ summary: "Tạo task cho kế hoạch từ 1 kết quả tìm kiếm (content trong kho hoặc video win)" })
  quickCreateItem(@Param("id") id: string, @Body() dto: QuickCreateFromSearchDto, @Request() req: any) {
    return this.dailyPlans.quickCreateFromSearch(req.user.id, req.user.roles ?? [], id, dto);
  }
}
