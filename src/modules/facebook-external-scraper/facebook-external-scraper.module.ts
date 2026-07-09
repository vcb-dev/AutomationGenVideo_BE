import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { getRuntimeJwtSecret } from '../auth/jwt-secret.util';
import { FacebookExternalScraperController } from './facebook-external-scraper.controller';
import { FacebookReelsSearchController } from './facebook-reels-search.controller';
import { FacebookExternalScraperService } from './facebook-external-scraper.service';
import { FacebookExternalScraperReadService } from './facebook-external-scraper-read.service';
import { FacebookExternalAiClientService } from './facebook-external-ai-client.service';
import { FacebookExternalScraperCronService } from './facebook-external-scraper-cron.service';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: getRuntimeJwtSecret(configService),
        signOptions: { expiresIn: '10m' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [FacebookExternalScraperController, FacebookReelsSearchController],
  providers: [
    FacebookExternalScraperService,
    FacebookExternalScraperReadService,
    FacebookExternalAiClientService,
    FacebookExternalScraperCronService,
  ],
})
export class FacebookExternalScraperModule {}
