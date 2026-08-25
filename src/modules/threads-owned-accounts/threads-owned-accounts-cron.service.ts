import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ThreadsOwnedAccountsService } from './threads-owned-accounts.service';

const VN_TZ = { timeZone: 'Asia/Ho_Chi_Minh' };

/**
 * Đồng bộ Threads nội bộ hằng ngày.
 *
 * Chạy 07:30 — nằm sau Instagram owned (07:15). Threads dùng OAuth token riêng
 * (không phụ thuộc Facebook page token) nên thứ tự không bắt buộc, nhưng xếp sau
 * để không chồng chéo với hai cron Facebook + Instagram đang chạy trước đó.
 */
@Injectable()
export class ThreadsOwnedAccountsCronService {
  private readonly logger = new Logger(ThreadsOwnedAccountsCronService.name);

  constructor(private readonly service: ThreadsOwnedAccountsService) {}

  @Cron('0 30 7 * * *', VN_TZ)
  async cronSyncOwnedThreads(): Promise<void> {
    try {
      await this.service.syncAllConnectedAccounts();
    } catch (err: any) {
      this.logger.error(`❌ [ThreadsCron] Lỗi: ${err.message}`);
    }
  }
}
