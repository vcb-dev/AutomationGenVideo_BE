import { Global, Module } from "@nestjs/common";
import { PushService } from "./push.service";
import { NotificationStreamService } from "./notification-stream.service";

@Global()
@Module({
  providers: [PushService, NotificationStreamService],
  exports: [PushService, NotificationStreamService],
})
export class PushModule {}
