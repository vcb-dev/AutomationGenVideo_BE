import { Module } from "@nestjs/common";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { LarkModule } from "../lark-sync/lark.module";
import { CacheModule } from "../../common/cache/cache.module";

@Module({
  imports: [LarkModule, CacheModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
