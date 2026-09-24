import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { getRuntimeJwtSecret } from '../auth/jwt-secret.util';
import { ThreadsScraperController } from './threads-scraper.controller';
import { ThreadsScraperService } from './threads-scraper.service';
import { ThreadsScraperReadService } from './threads-scraper-read.service';
import { ThreadsAiClientService } from './threads-ai-client.service';

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
  controllers: [ThreadsScraperController],
  providers: [
    ThreadsScraperService,
    ThreadsScraperReadService,
    ThreadsAiClientService,
  ],
  exports: [ThreadsScraperService, ThreadsScraperReadService],
})
export class ThreadsScraperModule {}
