import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { IdPhotoController } from './id-photo.controller';
import { IdPhotoService } from './id-photo.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    // Timeout mặc định cho request thường; merge-outfit tự truyền timeout riêng dài hơn
    // (MERGE_OUTFIT_TIMEOUT_MS trong IdPhotoService) — giống cách AiIntegrationModule đăng ký
    // HttpModule rồi content-transform tự override timeout theo từng lệnh gọi.
    HttpModule.register({ timeout: 30000, maxRedirects: 5 }),
    // Tái dùng UsersService.getTeamMembers() cho phạm vi quyền của tab "Thống kê" (Leader thấy
    // team mình / Manager-Admin thấy hết) — đúng cách AiIntegrationModule đã làm cho
    // content-transform/history/team-summary, không viết lại cách lọc team mới.
    UsersModule,
  ],
  controllers: [IdPhotoController],
  providers: [IdPhotoService],
  exports: [IdPhotoService],
})
export class IdPhotoModule {}
