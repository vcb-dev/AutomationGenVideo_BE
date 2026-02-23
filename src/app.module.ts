import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { join } from "path";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { PrismaModule } from "./common/prisma/prisma.module";
import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { AiIntegrationModule } from "./modules/ai-integration/ai-integration.module";
import { CollectionModule } from "./modules/collection/collection.module";
import { TrackedChannelsModule } from "./modules/tracked-channels/tracked-channels.module";
import { VideosModule } from "./modules/videos/videos.module";
import { HeygenVideoModule } from "./modules/heygen-video/heygen-video.module";
import { DouyinModule } from './douyin/douyin.module';
import { XiaohongshuModule } from './xiaohongshu/xiaohongshu.module';
import { SearchRecommendationModule } from './modules/search-recommendations/search-recommendations.module';
import { LarkModule } from './modules/lark/lark.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [join(process.cwd(), ".env"), ".env"],
      ignoreEnvFile: false,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
      },
    ]),
    PrismaModule,
    AuthModule,
    UsersModule,
    AiIntegrationModule,
    CollectionModule,
    TrackedChannelsModule,
    VideosModule,
    HeygenVideoModule,
    DouyinModule,
    XiaohongshuModule,
    SearchRecommendationModule,
    LarkModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
