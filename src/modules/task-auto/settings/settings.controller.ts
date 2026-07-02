import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../../common/guards/roles.guard";
import { Roles } from "../../../common/decorators/roles.decorator";
import { TaskAutoAssignService } from "../task-auto-assign/task-auto-assign.service";
import { UpdateAutoAssignSettingDto } from "../dto/settings.dto";

@ApiTags("task-auto")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("task-auto")
export class TaskAutoSettingsController {
  constructor(private assign: TaskAutoAssignService) {}

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
}
