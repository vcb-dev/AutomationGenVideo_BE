import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ThreadsOwnedAccountsService } from './threads-owned-accounts.service';

@UseGuards(JwtAuthGuard)
@Controller('scraper/threads/owned')
export class ThreadsOwnedAccountsController {
  constructor(private readonly threadsService: ThreadsOwnedAccountsService) {}

  @Get('profiles')
  async getProfiles() {
    return this.threadsService.getOwnedProfiles();
  }

  @Post('sync')
  async syncAll() {
    return this.threadsService.syncAllConnectedAccounts();
  }

  @Post('toggle-owned')
  async toggleOwned(@Body() body: { username: string; is_owned: boolean }) {
    return this.threadsService.toggleOwned(body.username, body.is_owned);
  }
}
