import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LarkService } from './lark.service';
import { Cron } from '@nestjs/schedule';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PrismaClient } from '@prisma/client';
import { buildScopedPrismaDbUrl } from '../../common/prisma/build-prisma-db-url';

const execAsync = promisify(exec);

@Injectable()
export class LarkSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LarkSyncService.name);
  private syncLock = false;
  private remotePrismaClient: PrismaClient | null = null;
  /**
   * Legacy sync service used to run extra bootstrap + cron jobs that can overlap
   * with LarkService cron. Default OFF to keep one single source-of-truth flow.
   */
  private readonly legacySyncEnabled =
    String(process.env.LARK_ENABLE_LEGACY_SYNC_SERVICE ?? 'false').toLowerCase() === 'true';

  constructor(
    private readonly prisma: PrismaService,
    private readonly larkService: LarkService,
  ) {}

  private shouldWriteDirectToServer(): boolean {
    const flag = String(process.env.LARK_SYNC_DIRECT_TO_SERVER ?? 'false').toLowerCase();
    return !(flag === '0' || flag === 'false' || flag === 'no');
  }

  private getServerDbUrl(): string | null {
    const v = String(process.env.SERVER_DATABASE_URL || '').trim();
    return v || null;
  }

  private getUserPrisma() {
    if (!this.shouldWriteDirectToServer()) return this.prisma.user;
    const serverUrl = this.getServerDbUrl();
    if (!serverUrl) return this.prisma.user;

    if (!this.remotePrismaClient) {
      this.remotePrismaClient = new PrismaClient({
        datasources: { db: { url: buildScopedPrismaDbUrl(serverUrl) } },
      });
      this.logger.log('[LarkSync] Direct-to-server mode enabled for HR sync.');
    }
    return this.remotePrismaClient.user;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Tự động sync ngay khi server khởi động (Chỉ giữ lại Đồ Da & Permissions)
  // ──────────────────────────────────────────────────────────────────────────
  async onApplicationBootstrap() {
    if (!this.legacySyncEnabled) {
      this.logger.log('Legacy bootstrap sync is disabled.');
      return;
    }
    const DELAY_MS = 10 * 1000; // 10s trễ để server ổn định
    this.logger.log(`🚀 Server started — deferring Lark master sync by ${DELAY_MS / 1000}s...`);
    setTimeout(() => this.unifiedSync(), DELAY_MS);
  }

  private async runBootstrapSync() {
    this.logger.log('🔄 Starting deferred bootstrap (Unified Sync + Đồ Da + Permissions)...');

    // 1. Chạy Unified Sync (Wipe + HR + KPI)
    try {
      await this.unifiedSync();
    } catch (err: any) {
      this.logger.error(`❌ Bootstrap Unified Sync failed: ${err?.message ?? err}`);
    }

    // 2. Chạy Đồ Da (vì Đồ Da có logic riêng)
    try {
      const kpiDd = await this.larkService.syncKPIDoDaData();
      this.logger.log(`✅ Bootstrap KPI Đồ Da sync: ${kpiDd?.synced ?? 0} records`);
    } catch (err: any) {
      this.logger.error(`❌ Bootstrap KPI Đồ Da sync failed: ${err?.message ?? err}`);
    }

    // 3. Chạy Permissions & Channels
    try {
      await this.larkService.syncPermissionData();
      this.logger.log('✅ Bootstrap Permission sync completed');
    } catch (err: any) {
      this.logger.error(`❌ Bootstrap Permission sync failed: ${err?.message ?? err}`);
    }
    this.logger.log('🎉 Bootstrap sync finished!');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEAM ĐỒ DA — Giữ nguyên logic cron hiện tại (12:40 hàng ngày)
  // ──────────────────────────────────────────────────────────────────────────
  @Cron('0 40 12 * * *', { name: 'lark-doda-data-sync', timeZone: 'Asia/Ho_Chi_Minh' })
  async scheduledDoDaSync() {
    if (!this.legacySyncEnabled) return;
    if (this.syncLock) {
      this.logger.warn('⏭️ Đồ Da sync skipped — another sync is in progress');
      return;
    }
    this.syncLock = true;
    this.logger.log('⏰ Scheduled Lark Đồ Da sync triggered (daily at 12:40)');
    try {
      const kpiDd = await this.larkService.syncKPIDoDaData();
      this.logger.log(`✅ KPI Đồ Da sync: ${kpiDd?.synced ?? 0} records`);
    } catch (err: any) {
      this.logger.error(`❌ KPI Đồ Da sync failed: ${err?.message ?? err}`);
    }
    this.syncLock = false;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEAM GLOBAL INDO — Luồng riêng, chạy hàng ngày lúc 12:50
  // ──────────────────────────────────────────────────────────────────────────
  @Cron('0 50 12 * * *', { name: 'lark-global-indo-sync', timeZone: 'Asia/Ho_Chi_Minh' })
  async scheduledGlobalIndoSync() {
    if (!this.legacySyncEnabled) return;
    if (this.syncLock) {
      this.logger.warn('⏭️ Global Indo sync skipped — another sync is in progress');
      return;
    }
    this.syncLock = true;
    this.logger.log('⏰ Scheduled Lark Global Indo sync triggered (daily at 12:50)');
    try {
      const result = await this.larkService.syncKPIGlobalIndoData();
      this.logger.log(`✅ KPI Global Indo sync: ${result?.synced ?? 0} records`);
    } catch (err: any) {
      this.logger.error(`❌ KPI Global Indo sync failed: ${err?.message ?? err}`);
    }
    this.syncLock = false;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // UNIFIED LARK SYNC — Every 3 hours (Cho tất cả các phần còn lại)
  // Runs: wipe-remote-data -> sync-lark-to-server-direct -> force-sync-kpi-to-remote
  // ──────────────────────────────────────────────────────────────────────────
  @Cron('0 0 */3 * * *', { name: 'unified-lark-sync', timeZone: 'Asia/Ho_Chi_Minh' })
  async unifiedSync() {
    if (this.syncLock) {
      this.logger.warn('⏭️ Master sync skipped — another sync is in progress');
      return;
    }

    this.syncLock = true;
    this.logger.log('⏰ Master Lark Sync triggered');

    const run = async (name: string, fn: () => Promise<any>) => {
      try {
        const result = await fn();
        this.logger.log(`✅ ${name}: ${result?.synced ?? result?.count ?? 'done'}`);
      } catch (err: any) {
        this.logger.error(`❌ ${name} failed: ${err?.message ?? err}`);
      }
    };

    try {
      await run('KPI sync', () => this.larkService.syncKPIData());
      await run('KPI DoDa sync', () => this.larkService.syncKPIDoDaData());

      // Clear KPI pagination cache after sync
      this.larkService.invalidateKPICache();

      this.logger.log('🎉 MASTER SYNC COMPLETED SUCCESSFULLY!');
    } finally {
      this.syncLock = false;
    }
  }

  @Cron('0 10 */3 * * *', { name: 'sync-all-fast-script', timeZone: 'Asia/Ho_Chi_Minh' })
  async runSyncAllFastScript() {
    const enabled = String(process.env.LARK_ENABLE_SYNC_ALL_FAST_CRON ?? 'true').toLowerCase();
    if (enabled === '0' || enabled === 'false' || enabled === 'no') {
      this.logger.log('[sync:all:fast cron] disabled by LARK_ENABLE_SYNC_ALL_FAST_CRON');
      return;
    }

    if (this.syncLock) {
      this.logger.warn('[sync:all:fast cron] skipped — another sync is in progress');
      return;
    }

    this.syncLock = true;
    const cwd = process.cwd();
    this.logger.log('[sync:all:fast cron] starting package script execution');

    try {
      const { stdout, stderr } = await execAsync('npm run sync:all:fast', {
        cwd,
        env: process.env,
        maxBuffer: 1024 * 1024 * 10,
      });

      if (stdout?.trim()) {
        this.logger.log(`[sync:all:fast cron][stdout]\n${stdout.trim()}`);
      }
      if (stderr?.trim()) {
        this.logger.warn(`[sync:all:fast cron][stderr]\n${stderr.trim()}`);
      }

      this.logger.log('[sync:all:fast cron] completed successfully');
    } catch (error: any) {
      this.logger.error(
        `[sync:all:fast cron] failed: ${error?.message || error}`,
        error?.stack,
      );
      if (error?.stdout) this.logger.error(`[sync:all:fast cron][stdout]\n${error.stdout}`);
      if (error?.stderr) this.logger.error(`[sync:all:fast cron][stderr]\n${error.stderr}`);
    } finally {
      this.syncLock = false;
    }
  }

  async getSyncStatus(): Promise<{
    lark_count: number;
    db_count: number;
    missing_in_db: string[];
    extra_in_db: string[];
  }> {
    const records = await this.larkService.fetchHRRecords();
    const larkEmails = records
      .map((r) => this.larkService.parseRecord(r))
      .filter((r) => r !== null)
      .map((r) => r!.email);

    const dbUsers = await this.getUserPrisma().findMany({ select: { email: true } });
    const dbEmails = dbUsers.map((u) => u.email);

    return {
      lark_count: larkEmails.length,
      db_count: dbEmails.length,
      missing_in_db: larkEmails.filter((e) => !dbEmails.includes(e)),
      extra_in_db: dbEmails.filter((e) => !larkEmails.includes(e)),
    };
  }
}
