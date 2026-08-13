import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { getRuntimeJwtSecret } from '../auth/jwt-secret.util';
import { NotificationsModule } from '../task-auto/notifications/notifications.module';
import { YoutubeScraperController } from './youtube-scraper.controller';
import { YoutubeScraperService } from './youtube-scraper.service';
import { YoutubeScraperReadService } from './youtube-scraper-read.service';
import { YoutubeAiClientService } from './youtube-ai-client.service';
import { YoutubeScraperCronService } from './youtube-scraper-cron.service';

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
  controllers: [YoutubeScraperController],
  providers: [
    YoutubeScraperService,
    YoutubeScraperReadService,
    YoutubeAiClientService,
    YoutubeScraperCronService,
  ],
})
export class YoutubeScraperModule {}
