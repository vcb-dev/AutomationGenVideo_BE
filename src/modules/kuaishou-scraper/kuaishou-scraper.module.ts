import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { getRuntimeJwtSecret } from '../auth/jwt-secret.util';
import { NotificationsModule } from '../task-auto/notifications/notifications.module';
import { KuaishouScraperController } from './kuaishou-scraper.controller';
import { KuaishouScraperService } from './kuaishou-scraper.service';
import { KuaishouScraperReadService } from './kuaishou-scraper-read.service';
import { KuaishouAiClientService } from './kuaishou-ai-client.service';
import { KuaishouScraperCronService } from './kuaishou-scraper-cron.service';

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
  controllers: [KuaishouScraperController],
  providers: [
    KuaishouScraperService,
    KuaishouScraperReadService,
    KuaishouAiClientService,
    KuaishouScraperCronService,
  ],
})
export class KuaishouScraperModule {}
