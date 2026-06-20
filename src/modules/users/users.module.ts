import { Module } from "@nestjs/common";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { LarkModule } from "../lark-sync/lark.module";
import { CacheModule } from "../../common/cache/cache.module";
import { SocialPublishingModule } from "../social-publishing/social-publishing.module";

@Module({
  imports: [LarkModule, CacheModule, SocialPublishingModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
