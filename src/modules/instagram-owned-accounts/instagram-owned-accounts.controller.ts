import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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

  @Post('sync')
  async syncAll() {
    return this.service.syncAllConnectedAccounts();
  }
}
