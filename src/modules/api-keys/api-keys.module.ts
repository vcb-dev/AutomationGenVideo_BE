import { Module } from "@nestjs/common";
import { ApiKeysController } from "./api-keys.controller";
import { ApiKeysService } from "./api-keys.service";

/**
 * Cấp & quản trị API key cho hệ thống ngoài (`X-API-Key`). `PrismaModule` đã `@Global` nên không
 * cần import lại. `JwtOrApiKeyGuard` không khai ở đây: Nest tự khởi tạo guard theo từng controller
 * (chỉ phụ thuộc `Reflector` + `PrismaService` global) — giống cách `JwtAuthGuard` đang dùng.
 */
@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
