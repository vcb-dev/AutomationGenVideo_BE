import {
  Body,
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
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { NotificationsService } from "./notifications.service";
import {
  QueryNotificationDto,
  SubscribePushDto,
  UnsubscribePushDto,
} from "./notifications.dto";

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

  @Get("push/public-key")
  @ApiOperation({ summary: "Get the VAPID public key used to subscribe to Web Push" })
  getPushPublicKey() {
    return this.notifications.getVapidPublicKey();
  }

  @Throttle({ short: { limit: 5, ttl: 5000 }, long: { limit: 20, ttl: 60000 } })
  @Post("push/subscribe")
  @ApiOperation({ summary: "Register a Web Push subscription for the current user" })
  subscribePush(@Body() dto: SubscribePushDto, @Request() req: any) {
    const userAgent = req.headers?.["user-agent"];
    return this.notifications.subscribePush(req.user.id, dto, userAgent);
  }

  @Throttle({ short: { limit: 5, ttl: 5000 }, long: { limit: 20, ttl: 60000 } })
  @Post("push/unsubscribe")
  @ApiOperation({ summary: "Remove a Web Push subscription of the current user" })
  unsubscribePush(@Body() dto: UnsubscribePushDto, @Request() req: any) {
    return this.notifications.unsubscribePush(req.user.id, dto.endpoint);
  }
}
