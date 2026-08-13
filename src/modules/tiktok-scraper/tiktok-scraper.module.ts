import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { getRuntimeJwtSecret } from '../auth/jwt-secret.util';
import { NotificationsModule } from '../task-auto/notifications/notifications.module';
import { TiktokScraperController } from './tiktok-scraper.controller';
import { TiktokScraperService } from './tiktok-scraper.service';
import { TiktokScraperReadService } from './tiktok-scraper-read.service';
import { TiktokAiClientService } from './tiktok-ai-client.service';
import { TiktokScraperCronService } from './tiktok-scraper-cron.service';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: getRuntimeJwtSecret(configService),
        signOptions: { expiresIn: '10m' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [TiktokScraperController],
  providers: [TiktokScraperService, TiktokScraperReadService, TiktokAiClientService, TiktokScraperCronService],
})
export class TiktokScraperModule {}
