import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { PrismaModule } from "../../../common/prisma/prisma.module";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { LarkWebhookNotifyService } from "./lark-webhook-notify.service";

@Module({
  imports: [
    PrismaModule,
    // Timeout cho LarkWebhookNotifyService — không để webhook treo giữ request/socket vô thời hạn
    // khi DNS/TLS không phản hồi.
    HttpModule.register({ timeout: 10_000 }),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, LarkWebhookNotifyService],
  exports: [NotificationsService, LarkWebhookNotifyService],
})
export class NotificationsModule {}
