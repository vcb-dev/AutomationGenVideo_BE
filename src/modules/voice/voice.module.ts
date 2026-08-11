import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { VoiceService } from './voice.service';
import { VoiceController } from './voice.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { GoogleDriveStorageService } from '../social-publishing/upload/google-drive-storage.service';

/**
 * Module giọng nói (TTS + clone giọng MiniMax) — tách khỏi AiIntegrationModule
 * ngày 2026-08-07 để voice có chỗ ở riêng thay vì trộn trong service 2600 dòng.
 *
 * AiIntegrationService (cho translate-text) inject được mà không cần import
 * module: AiIntegrationModule là @Global và export service đó.
 */
@Module({
  imports: [
    // Timeout mặc định 30s cho các request thường; từng lời gọi dài (TTS 300s,
    // clone 60s) tự khai timeout riêng — xem voice.service.ts.
    HttpModule.register({ timeout: 30000, maxRedirects: 5 }),
    ConfigModule,
    PrismaModule,
  ],
  controllers: [VoiceController],
  providers: [VoiceService, GoogleDriveStorageService],
  exports: [VoiceService],
})
export class VoiceModule {}
