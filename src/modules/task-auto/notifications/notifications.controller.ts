import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { NotificationsService } from "./notifications.service";
import { QueryNotificationDto } from "./notifications.dto";

@ApiTags("task-auto")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("task-auto/notifications")
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "List notifications of the current user" })
  findAll(@Query() q: QueryNotificationDto, @Request() req: any) {
    return this.notifications.findAll(req.user.id, q);
  }

  @Get("unread-count")
  @ApiOperation({ summary: "Count unread notifications of the current user" })
  unreadCount(@Request() req: any) {
    return this.notifications.unreadCount(req.user.id);
  }

  @Patch(":id/read")
  @ApiOperation({ summary: "Mark one notification as read" })
  markRead(@Param("id") id: string, @Request() req: any) {
    return this.notifications.markRead(id, req.user.id);
  }

  @Post("read-all")
  @ApiOperation({ summary: "Mark all notifications of the current user as read" })
  markAllRead(@Request() req: any) {
    return this.notifications.markAllRead(req.user.id);
  }
}
