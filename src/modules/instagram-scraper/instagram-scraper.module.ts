import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { getRuntimeJwtSecret } from '../auth/jwt-secret.util';
import { InstagramScraperController } from './instagram-scraper.controller';
import { InstagramScraperService } from './instagram-scraper.service';
import { InstagramScraperReadService } from './instagram-scraper-read.service';
import { InstagramAiClientService } from './instagram-ai-client.service';
import { InstagramScraperCronService } from './instagram-scraper-cron.service';

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
  controllers: [InstagramScraperController],
  providers: [InstagramScraperService, InstagramScraperReadService, InstagramAiClientService, InstagramScraperCronService],
})
export class InstagramScraperModule {}
