import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { getRuntimeJwtSecret } from '../auth/jwt-secret.util';
import { XiaohongshuScraperController } from './xiaohongshu-scraper.controller';
import { XiaohongshuScraperService } from './xiaohongshu-scraper.service';
import { XiaohongshuScraperReadService } from './xiaohongshu-scraper-read.service';
import { XiaohongshuAiClientService } from './xiaohongshu-ai-client.service';
import { XiaohongshuScraperCronService } from './xiaohongshu-scraper-cron.service';

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
  controllers: [XiaohongshuScraperController],
  providers: [XiaohongshuScraperService, XiaohongshuScraperReadService, XiaohongshuAiClientService, XiaohongshuScraperCronService],
})
export class XiaohongshuScraperModule {}
