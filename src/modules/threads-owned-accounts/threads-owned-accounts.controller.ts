import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
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

  // Cùng lý do với Instagram nội bộ: đồng bộ tốn quota Graph API, đánh dấu kênh nội bộ đổi dữ
  // liệu dùng chung cho cả công ty — cả hai đều là thao tác quản lý, không phải thao tác xem.
  @Post('sync')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async syncAll() {
    return this.threadsService.syncAllConnectedAccounts();
  }

  @Post('toggle-owned')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async toggleOwned(@Body() body: { username: string; is_owned: boolean }) {
    return this.threadsService.toggleOwned(body.username, body.is_owned);
  }
}
