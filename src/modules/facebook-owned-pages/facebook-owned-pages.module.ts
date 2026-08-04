import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { getRuntimeJwtSecret } from '../auth/jwt-secret.util';
import { FacebookOwnedPagesController } from './facebook-owned-pages.controller';
import { FacebookOwnedPagesService } from './facebook-owned-pages.service';
import { FacebookOwnedPagesReadService } from './facebook-owned-pages-read.service';
import { FacebookAiClientService } from './facebook-ai-client.service';
import { FacebookOwnedPagesCronService } from './facebook-owned-pages-cron.service';

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
  controllers: [FacebookOwnedPagesController],
  providers: [FacebookOwnedPagesService, FacebookOwnedPagesReadService, FacebookAiClientService, FacebookOwnedPagesCronService],
  exports: [FacebookOwnedPagesService],
})
export class FacebookOwnedPagesModule {}
