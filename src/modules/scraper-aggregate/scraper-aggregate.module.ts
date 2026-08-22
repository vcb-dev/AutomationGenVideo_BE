import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ScraperAggregateController } from './scraper-aggregate.controller';
import { ScraperAggregateReadService } from './scraper-aggregate-read.service';
import { OwnedStatsService } from './owned-stats.service';
import { OwnedScriptService } from './owned-script.service';
import { OwnedDuplicateService } from './owned-duplicate.service';
import { OwnedPaastCronService } from './owned-paast-cron.service';
import { VideoStreamController } from './video-stream.controller';
import { CacheModule } from '../../common/cache/cache.module';
import { getRuntimeJwtSecret } from '../auth/jwt-secret.util';

// AiIntegrationService là @Global nên dùng được luôn, nhưng CacheModule thì KHÔNG —
// phải import tường minh, thiếu nó Nest không dựng được VideoStreamController và cả app
// không khởi động nổi (cổng 3000 không mở).
//
// JwtModule để MediaTokenGuard tự xác thực token lấy từ query — thẻ <video src> không gắn
// được header Authorization nên không dùng JwtAuthGuard ở route phát được. Dùng chung đúng
// một hàm lấy secret với AuthModule, lệch secret là mọi link phát đều 401.
import { TrafficInsightsService } from './traffic-insights.service';
import { CryptoService } from '../social-publishing/crypto/crypto.service';

@Module({
  imports: [
    PrismaModule,
    CacheModule,
    // Chấm PAAST qua AiIntegrationService (global, không cần import module) ngay trong
    // tiến trình, thay vì BE tự gọi HTTP vào chính mình — vừa thừa một vòng mạng vừa phải
    // bịa token.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: getRuntimeJwtSecret(configService),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [ScraperAggregateController, VideoStreamController],
  providers: [
    ScraperAggregateReadService,
    OwnedStatsService,
    OwnedScriptService,
    OwnedDuplicateService,
    OwnedPaastCronService,
    TrafficInsightsService,
    CryptoService,
  ],
  exports: [TrafficInsightsService],
})
export class ScraperAggregateModule {}
