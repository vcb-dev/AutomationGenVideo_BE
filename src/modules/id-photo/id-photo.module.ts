import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { IdPhotoController } from './id-photo.controller';
import { IdPhotoService } from './id-photo.service';

@Module({
  imports: [
    // Timeout mặc định cho request thường; merge-outfit tự truyền timeout riêng dài hơn
    // (MERGE_OUTFIT_TIMEOUT_MS trong IdPhotoService) — giống cách AiIntegrationModule đăng ký
    // HttpModule rồi content-transform tự override timeout theo từng lệnh gọi.
    HttpModule.register({ timeout: 30000, maxRedirects: 5 }),
  ],
  controllers: [IdPhotoController],
  providers: [IdPhotoService],
  exports: [IdPhotoService],
})
export class IdPhotoModule {}
