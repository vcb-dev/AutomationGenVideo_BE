import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { join } from "path";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { PrismaModule } from "./common/prisma/prisma.module";
import { PushModule } from "./common/push/push.module";
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
import { ContentReportModule } from './modules/content-report/content-report.module';
import { ChannelsModule } from "./modules/channels-team/channels.module";
import { TaskAutoModule } from './modules/task-auto/task-auto.module';
import { ChatHistoryModule } from './modules/chat-history/chat-history.module';
import { ContentTransformModule } from './modules/content-transform/content-transform.module';
import { PaastAnalyzerModule } from './modules/paast-analyzer/paast-analyzer.module';
// TelegramReportModule: tạm tắt (nhánh khai) — bảng `telegram_report_config` chưa có migration/chưa
// tồn tại trên DB, TelegramReportService.onModuleInit() query bảng này lúc khởi động làm BE crash.
// import { TelegramReportModule } from './modules/telegram-report/telegram-report.module';
import { BusinessConnectionsModule } from './modules/business-connections/business-connections.module';
import { OAuthModule } from './modules/oauth/oauth.module';
import { FacebookOwnedPagesModule } from './modules/facebook-owned-pages/facebook-owned-pages.module';
import { DouyinScraperModule } from './modules/douyin-scraper/douyin-scraper.module';
import { TiktokScraperModule } from './modules/tiktok-scraper/tiktok-scraper.module';
import { InstagramScraperModule } from './modules/instagram-scraper/instagram-scraper.module';
import { XiaohongshuScraperModule } from './modules/xiaohongshu-scraper/xiaohongshu-scraper.module';
import { FacebookExternalScraperModule } from './modules/facebook-external-scraper/facebook-external-scraper.module';
import { YoutubeScraperModule } from './modules/youtube-scraper/youtube-scraper.module';
import { KuaishouScraperModule } from './modules/kuaishou-scraper/kuaishou-scraper.module';
import { BilibiliScraperModule } from './modules/bilibili-scraper/bilibili-scraper.module';
import { ScraperAggregateModule } from './modules/scraper-aggregate/scraper-aggregate.module';
import { SearchKeywordsModule } from './modules/search-keywords/search-keywords.module';
import { ScraperProxyModule } from './modules/scraper-proxy/scraper-proxy.module';
import { VideoLibraryModule } from './modules/video-library/video-library.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [join(process.cwd(), ".env"), ".env"],
      ignoreEnvFile: process.env.NODE_ENV === 'production',
    }),
    ThrottlerModule.forRoot([
      {
        // Long window: 1200 req/min/IP — 70+ users cùng mạng LAN (NAT shared IP)
        name: 'long',
        ttl: 60000,
        limit: 1200,
      },
      {
        // Short window: chống burst — 80 req/5s/IP (70 users cùng lúc qua 1 IP)
        name: 'short',
        ttl: 5000,
        limit: 80,
      },
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    PushModule,
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
    ChatHistoryModule,
    // TelegramReportModule, // tạm tắt — xem comment ở import phía trên
    RolePermissionsModule,
    SocialPublishingModule,
    ContentReportModule,
    ChannelsModule,
    TaskAutoModule,
    ContentTransformModule,
    PaastAnalyzerModule,
    BusinessConnectionsModule,
    OAuthModule,
    FacebookOwnedPagesModule,
    DouyinScraperModule,
    TiktokScraperModule,
    InstagramScraperModule,
    XiaohongshuScraperModule,
    FacebookExternalScraperModule,
    YoutubeScraperModule,
    KuaishouScraperModule,
    BilibiliScraperModule,
    ScraperAggregateModule,
    SearchKeywordsModule,
    ScraperProxyModule,
    VideoLibraryModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule { }
