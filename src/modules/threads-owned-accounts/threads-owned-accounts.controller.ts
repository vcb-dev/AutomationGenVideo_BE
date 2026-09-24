import { Controller, Get, Post, Body, Param, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ThreadsOwnedAccountsService } from './threads-owned-accounts.service';

@UseGuards(JwtAuthGuard)
@Controller('scraper/threads/owned')
export class ThreadsOwnedAccountsController {
  constructor(private readonly threadsService: ThreadsOwnedAccountsService) {}

  @Get('profiles')
  async getProfiles() {
    return this.threadsService.getOwnedProfiles();
  }

  // Cùng lý do với Instagram nội bộ: đồng bộ tốn quota Graph API.
  // Chạy dạng bất đồng bộ (non-blocking) để tránh timeout 502 Bad Gateway từ Nginx.
  @Post('sync')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async syncAll() {
    return this.threadsService.triggerAsyncSyncAll();
  }

  @Get('sync/status')
  async getSyncStatus() {
    return this.threadsService.getSyncStatus();
  }

  @Post('sync-profile/:username')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async syncSingleProfile(@Param('username') username: string) {
    const res = await this.threadsService.syncSingleProfileByUsername(username);
    if (!res) {
      throw new HttpException(
        { error: 'Không tìm thấy tài khoản kết nối cho username này' },
        HttpStatus.NOT_FOUND,
      );
    }
    return res;
  }

  @Post('toggle-owned')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async toggleOwned(@Body() body: { username: string; is_owned: boolean }) {
    return this.threadsService.toggleOwned(body.username, body.is_owned);
  }
}
