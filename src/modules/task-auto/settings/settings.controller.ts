import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtOrApiKeyGuard } from "../../api-keys/guards/jwt-or-api-key.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { TaskAutoAssignService } from "../task-auto-assign/task-auto-assign.service";
import { LarkWebhookNotifyService } from "../notifications/lark-webhook-notify.service";
import {
  UpdateAutoAssignSettingDto,
  UpdateLarkWebhookSettingDto,
  UpdateMemberAutoAssignDto,
} from "./dto/settings.dto";

@ApiTags("task-auto")
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard)
@Controller("task-auto")
export class TaskAutoSettingsController {
  constructor(
    private assign: TaskAutoAssignService,
    private larkWebhook: LarkWebhookNotifyService,
  ) {}

  @Get("settings")
  @ApiOperation({ summary: "Get auto-assign settings" })
  getSettings() {
    return this.assign.getSettings();
  }

  @Put("settings")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Update auto-assign settings" })
  updateSettings(@Body() dto: UpdateAutoAssignSettingDto, @Request() req: any) {
    return this.assign.updateSettings(dto, req.user.id);
  }

  @Get("settings/members")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Lịch chia task tự động từng thành viên — LEADER chỉ thấy (các) team mình lead" })
  getMemberSchedules(@Request() req: any) {
    return this.assign.getMemberSchedules({ id: req.user.id, roles: req.user.roles ?? [] });
  }

  @Patch("settings/members/:memberId")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Bật/tắt chia task tự động + ngày trong tuần cho 1 thành viên (LEADER: team mình lead)" })
  updateMemberSchedule(
    @Param("memberId", ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateMemberAutoAssignDto,
    @Request() req: any,
  ) {
    return this.assign.updateMemberSchedule(memberId, dto, { id: req.user.id, roles: req.user.roles ?? [] });
  }

  @Get("assignment-runs")
  @ApiOperation({ summary: "Get recent assignment runs" })
  getRuns(@Query("limit") limit?: string) {
    return this.assign.getRuns(limit ? parseInt(limit) : 50);
  }

  @Post("assignment-runs/trigger")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Manually trigger auto-assign run" })
  async triggerRun() {
    const result = await this.assign.triggerManually();
    return {
      message: "Auto-assign triggered",
      timestamp: new Date(),
      ...result,
    };
  }

  @Get("settings/lark-webhook")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Webhook Lark DÙNG CHUNG — không bao giờ trả secret thật, chỉ báo đã cấu hình hay chưa" })
  getLarkWebhookSetting() {
    return this.larkWebhook.getGlobalSettingForDisplay();
  }

  @Put("settings/lark-webhook")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Cập nhật webhook Lark DÙNG CHUNG. Bỏ trống field = giữ nguyên, gửi null = xoá" })
  updateLarkWebhookSetting(@Body() dto: UpdateLarkWebhookSettingDto, @Request() req: any) {
    return this.larkWebhook.updateGlobalSetting(dto, req.user.id);
  }
}
