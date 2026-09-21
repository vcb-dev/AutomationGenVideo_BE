import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { SapoIntegrationService } from './sapo-integration.service';
import { SapoIntegrationController } from './sapo-integration.controller';
import { SapoRevenueCronService } from './sapo-revenue-cron.service';

import { CryptoService } from '../social-publishing/crypto/crypto.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 15000,
      maxRedirects: 5,
    }),
    PrismaModule,
  ],
  controllers: [SapoIntegrationController],
  providers: [SapoIntegrationService, SapoRevenueCronService, CryptoService],
  exports: [SapoIntegrationService],
})
export class SapoIntegrationModule {}
