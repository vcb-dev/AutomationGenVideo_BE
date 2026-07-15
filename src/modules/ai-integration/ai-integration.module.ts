import { Module, Global } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { AiIntegrationService } from './ai-integration.service';
import { AiIntegrationController } from './ai-integration.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { GoogleDriveStorageService } from '../social-publishing/upload/google-drive-storage.service';

@Global()
@Module({
  imports: [
    HttpModule.register({ timeout: 30000, maxRedirects: 5 }),
    ConfigModule,
    PrismaModule,
  ],
  controllers: [AiIntegrationController],
  providers: [AiIntegrationService, GoogleDriveStorageService],
  exports: [AiIntegrationService],
})
export class AiIntegrationModule {}

