import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { LarkWebhookNotifyService } from './lark-webhook-notify.service'

@Module({
  imports: [
    PrismaModule,
    // Không để webhook treo giữ request/socket vô thời hạn khi DNS/TLS không phản hồi.
    HttpModule.register({ timeout: 10_000 }),
  ],
  providers: [LarkWebhookNotifyService],
  exports: [LarkWebhookNotifyService],
})
export class LarkNotificationsModule {}
