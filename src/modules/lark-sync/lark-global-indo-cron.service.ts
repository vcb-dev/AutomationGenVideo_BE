import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LarkService } from './lark.service';

/**
 * Cron tự động riêng cho team Global - Indo, tách biệt hoàn toàn khỏi
 * LarkSyncService (Đồ Da / legacy bootstrap / unified sync). Không phụ thuộc
 * flag LARK_ENABLE_LEGACY_SYNC_SERVICE — luôn chạy, kể cả trên production/Docker.
 *
 * Poll mỗi 5 phút (thay vì 1 lần/ngày) để dữ liệu điền trên Lark gần như
 * real-time trên dashboard, không cần webhook/automation bên Lark.
 */
@Injectable()
export class LarkGlobalIndoCronService {
    private readonly logger = new Logger(LarkGlobalIndoCronService.name);
    private syncLock = false;

    constructor(private readonly larkService: LarkService) { }

    @Cron('0 */5 * * * *', { name: 'lark-global-indo-auto-sync', timeZone: 'Asia/Ho_Chi_Minh' })
    async runScheduledSync() {
        if (this.syncLock) {
            this.logger.warn('⏭️ Global Indo auto-sync skipped — sync trước vẫn đang chạy');
            return;
        }
        this.syncLock = true;
        this.logger.log('⏰ Global Indo auto-sync triggered (every 5 minutes)');
        try {
            const result = await this.larkService.syncKPIGlobalIndoData();
            this.logger.log(`✅ Global Indo auto-sync done: ${result?.synced ?? 0} rows`);
        } catch (err: any) {
            this.logger.error(`❌ Global Indo auto-sync failed: ${err?.message ?? err}`);
        } finally {
            this.syncLock = false;
        }
    }
}
