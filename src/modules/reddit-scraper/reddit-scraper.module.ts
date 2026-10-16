import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { getRuntimeJwtSecret } from '../auth/jwt-secret.util';
import { RedditScraperController } from './reddit-scraper.controller';
import { RedditScraperService } from './reddit-scraper.service';
import { RedditScraperReadService } from './reddit-scraper-read.service';
import { RedditAiClientService } from './reddit-ai-client.service';

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
  controllers: [RedditScraperController],
  providers: [RedditScraperService, RedditScraperReadService, RedditAiClientService],
})
export class RedditScraperModule {}
