import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { getRuntimeJwtSecret } from '../auth/jwt-secret.util';
import { NotificationsModule } from '../task-auto/notifications/notifications.module';
import { BilibiliScraperController } from './bilibili-scraper.controller';
import { BilibiliScraperService } from './bilibili-scraper.service';
import { BilibiliScraperReadService } from './bilibili-scraper-read.service';
import { BilibiliAiClientService } from './bilibili-ai-client.service';
import { BilibiliScraperCronService } from './bilibili-scraper-cron.service';

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
  controllers: [BilibiliScraperController],
  providers: [
    BilibiliScraperService,
    BilibiliScraperReadService,
    BilibiliAiClientService,
    BilibiliScraperCronService,
  ],
})
export class BilibiliScraperModule {}
