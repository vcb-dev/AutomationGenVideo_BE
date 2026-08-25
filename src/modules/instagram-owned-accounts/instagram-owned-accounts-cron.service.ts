import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InstagramOwnedAccountsService } from './instagram-owned-accounts.service';

const VN_TZ = { timeZone: 'Asia/Ho_Chi_Minh' };

/**
 * Đồng bộ Instagram nội bộ hằng ngày.
 *
 * Chạy 07:15 — đúng khung mà ThreadsOwnedAccountsCronService đã tính trước ("nằm sau
 * Instagram owned (07:15)"). Xếp trước Threads (07:30) và tách khỏi instagram-scraper
 * (07:30, cào kênh đối thủ qua TikHub) để hai luồng không giành nhau cùng một profile.
 */
@Injectable()
export class InstagramOwnedAccountsCronService {
  private readonly logger = new Logger(InstagramOwnedAccountsCronService.name);

  constructor(private readonly service: InstagramOwnedAccountsService) {}

  @Cron('0 15 7,12 * * *', VN_TZ)
  async cronSyncOwnedInstagram(): Promise<void> {
    try {
      await this.service.syncAllConnectedAccounts();
    } catch (err: any) {
      this.logger.error(`❌ [IGCron] Lỗi: ${err.message}`);
    }
  }
}
