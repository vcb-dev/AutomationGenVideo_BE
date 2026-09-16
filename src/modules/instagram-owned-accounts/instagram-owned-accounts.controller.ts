import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { InstagramOwnedAccountsService } from './instagram-owned-accounts.service';

/**
 * Kênh Instagram nội bộ, suy ra từ tài khoản đã kết nối ở trang đăng bài MXH.
 *
 * Đường dẫn đặt song song với Threads (`scraper/threads/owned`) để hai nền tảng cùng một
 * kiểu gọi.
 */
@UseGuards(JwtAuthGuard)
@Controller('scraper/instagram/owned')
export class InstagramOwnedAccountsController {
  constructor(private readonly service: InstagramOwnedAccountsService) {}

  @Get('profiles')
  async getProfiles() {
    return this.service.getOwnedProfiles();
  }

  // Đồng bộ gọi Graph API cho từng tài khoản đã kết nối — tốn quota thật, siết như các thao tác
  // quản lý kênh khác. Ẩn nút bên FE là trang trí, chặn thật phải ở đây.
  @Post('sync')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async syncAll() {
    return this.service.syncAllConnectedAccounts();
  }
}
