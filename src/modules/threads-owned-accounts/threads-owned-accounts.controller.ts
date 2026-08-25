import { Controller, Get, Post, Body, UseGuards, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ThreadsOwnedAccountsService } from './threads-owned-accounts.service';

@UseGuards(JwtAuthGuard)
@Controller('scraper/threads/owned')
export class ThreadsOwnedAccountsController {
  private readonly logger = new Logger(ThreadsOwnedAccountsController.name);

  constructor(private readonly threadsService: ThreadsOwnedAccountsService) {}

  @Get('profiles')
  async getProfiles() {
    return this.threadsService.getOwnedProfiles();
  }

  @Post('sync')
  async syncAll() {
    this.threadsService.syncAllConnectedAccounts().catch((err) => {
      this.logger.error(`❌ [ThreadsSync] Background sync failed: ${err.message}`);
    });
    return { status: 'processing', message: 'Đang bắt đầu đồng bộ kênh Threads trong nền...' };
  }

  @Post('toggle-owned')
  async toggleOwned(@Body() body: { username: string; is_owned: boolean }) {
    return this.threadsService.toggleOwned(body.username, body.is_owned);
  }
}
