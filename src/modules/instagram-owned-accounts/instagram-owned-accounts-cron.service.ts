import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InstagramOwnedAccountsService } from './instagram-owned-accounts.service';

const VN_TZ = { timeZone: 'Asia/Ho_Chi_Minh' };

/**
 * Đồng bộ Instagram nội bộ hằng ngày.
 *
 * Chạy 07:15 — nằm giữa delta sync Facebook (07:00) và cron chấm PAAST (07:30). Đặt sau
 * Facebook vì Instagram dùng CHÍNH page token của Facebook: page nào vừa được import lúc 06:00
 * thì tài khoản Instagram của nó cũng có token mới nhất để dùng.
 */
@Injectable()
export class InstagramOwnedAccountsCronService {
  private readonly logger = new Logger(InstagramOwnedAccountsCronService.name);

  constructor(private readonly service: InstagramOwnedAccountsService) {}

  @Cron('0 15 7 * * *', VN_TZ)
  async cronSyncOwnedInstagram(): Promise<void> {
    try {
      await this.service.syncAllOwnedAccounts();
    } catch (err: any) {
      this.logger.error(`❌ [IG-SYNC] Lỗi: ${err.message}`);
    }
  }
}
