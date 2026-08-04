import { Module, Global } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AiIntegrationService } from './ai-integration.service';
import { AiIntegrationController } from './ai-integration.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { GoogleDriveStorageService } from '../social-publishing/upload/google-drive-storage.service';
import { getRuntimeJwtSecret } from '../auth/jwt-secret.util';

@Global()
@Module({
  imports: [
    HttpModule.register({ timeout: 30000, maxRedirects: 5 }),
    ConfigModule,
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
  controllers: [AiIntegrationController],
  providers: [AiIntegrationService, GoogleDriveStorageService],
  exports: [AiIntegrationService],
})
export class AiIntegrationModule {}

