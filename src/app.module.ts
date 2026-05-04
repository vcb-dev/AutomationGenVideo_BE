import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { ScheduleModule } from "@nestjs/schedule";
import { join } from "path";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { PrismaModule } from "./common/prisma/prisma.module";
import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { AiIntegrationModule } from "./modules/ai-integration/ai-integration.module";
import { ChannelEnrichmentModule } from "./modules/channel-enrichment/channel-enrichment.module";
import { CollectionModule } from "./modules/collection/collection.module";
import { TrackedChannelsModule } from "./modules/tracked-channels/tracked-channels.module";
import { VideosModule } from "./modules/videos/videos.module";
import { HeygenVideoModule } from "./modules/heygen-video/heygen-video.module";
import { DouyinModule } from './douyin/douyin.module';
import { XiaohongshuModule } from './xiaohongshu/xiaohongshu.module';
import { SearchRecommendationModule } from './modules/search-recommendations/search-recommendations.module';
import { LarkModule } from './modules/lark-sync/lark.module';
import { RolePermissionsModule } from './modules/role-permissions/role-permissions.module';
import { SocialPublishingModule } from './modules/social-publishing/social-publishing.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [join(process.cwd(), ".env"), ".env"],
      ignoreEnvFile: process.env.NODE_ENV === 'production',
    }),
    ThrottlerModule.forRoot([
      {
        // Long window: 600 req/min/IP – đủ cho 50 users × 12 req/min (bao gồm auto-refresh 60s)
        // Trước đây 120 req/min dễ bị throttle khi 50 users cùng mạng LAN (same IP/NAT)
        name: 'long',
        ttl: 60000,
        limit: 600,
      },
      {
        // Short window: chống burst attack – tối đa 30 req/5s/IP
        name: 'short',
        ttl: 5000,
        limit: 30,
      },
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    AiIntegrationModule,
    ChannelEnrichmentModule,
    CollectionModule,
    TrackedChannelsModule,
    VideosModule,
    HeygenVideoModule,
    DouyinModule,
    XiaohongshuModule,
    SearchRecommendationModule,
    LarkModule,
    RolePermissionsModule,
    SocialPublishingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
