import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { getRuntimeJwtSecret } from '../auth/jwt-secret.util';
import { DouyinScraperController } from './douyin-scraper.controller';
import { DouyinScraperService } from './douyin-scraper.service';
import { DouyinScraperReadService } from './douyin-scraper-read.service';
import { DouyinAiClientService } from './douyin-ai-client.service';
import { DouyinScraperCronService } from './douyin-scraper-cron.service';

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
  controllers: [DouyinScraperController],
  providers: [DouyinScraperService, DouyinScraperReadService, DouyinAiClientService, DouyinScraperCronService],
})
export class DouyinScraperModule {}
