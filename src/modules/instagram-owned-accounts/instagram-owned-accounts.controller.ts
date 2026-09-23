import { Controller, Get, Post, Param, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
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
  // quản lý kênh khác. Chạy dạng bất đồng bộ (non-blocking) để tránh timeout 502 Bad Gateway từ Nginx.
  @Post('sync')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async syncAll() {
    return this.service.triggerAsyncSyncAll();
  }

  @Get('sync/status')
  async getSyncStatus() {
    return this.service.getSyncStatus();
  }

  @Post('sync-profile/:username')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async syncSingleProfile(@Param('username') username: string) {
    const res = await this.service.syncSingleProfileByUsername(username);
    if (!res) {
      throw new HttpException(
        { error: 'Không tìm thấy tài khoản kết nối cho username này' },
        HttpStatus.NOT_FOUND,
      );
    }
    return res;
  }
}
