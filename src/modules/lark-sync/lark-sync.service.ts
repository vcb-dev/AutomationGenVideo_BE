import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LarkService } from './lark.service';
import { Cron } from '@nestjs/schedule';
import * as bcrypt from 'bcrypt';

@Injectable()
export class LarkSyncService implements OnApplicationBootstrap {
    private readonly logger = new Logger(LarkSyncService.name);
    private syncLock = false;

    constructor(
        private readonly prisma: PrismaService,
        private readonly larkService: LarkService,
    ) { }

    // ──────────────────────────────────────────────────────────────────────────
    // Tự động sync ngay khi server khởi động
    // ──────────────────────────────────────────────────────────────────────────
    async onApplicationBootstrap() {
        // Delay 2 phút trước khi chạy Lark sync — nhường DB connections cho user login
        // vào giờ cao điểm sáng (60-70 người cùng login).
        const DELAY_MS = 2 * 60 * 1000;
        this.logger.log(`🚀 Server started — deferring Lark sync by ${DELAY_MS / 1000}s to prioritize user traffic...`);
        setTimeout(() => this.runBootstrapSync(), DELAY_MS);
    }

    private async runBootstrapSync() {
        this.logger.log('🔄 Starting deferred bootstrap Lark sync...');
        try {
            const kpi = await this.larkService.syncKPIData();
            this.logger.log(`✅ Bootstrap KPI sync: ${kpi?.synced ?? 0} records`);
        } catch (err) {
            this.logger.error(`❌ Bootstrap KPI sync failed: ${err?.message}`);
        }
        try {
            const kpiDd = await this.larkService.syncKPIDoDaData();
            this.logger.log(`✅ Bootstrap KPI Đồ Da sync: ${kpiDd?.synced ?? 0} records`);
        } catch (err) {
            this.logger.error(`❌ Bootstrap KPI Đồ Da sync failed: ${err?.message}`);
        }
        try {
            const emp = await this.larkService.syncEmployeeData();
            this.logger.log(`✅ Bootstrap Employee sync: ${emp?.synced ?? 0} records`);
        } catch (err) {
            this.logger.error(`❌ Bootstrap Employee sync failed: ${err?.message}`);
        }
        try {
            await this.larkService.syncPermissionData();
            this.logger.log('✅ Bootstrap Permission sync completed');
        } catch (err) {
            this.logger.error(`❌ Bootstrap Permission sync failed: ${err?.message}`);
        }
        try {
            await this.syncFromLark();
            this.logger.log('✅ Bootstrap HR sync completed');
        } catch (err) {
            this.logger.error(`❌ Bootstrap HR sync failed: ${err?.message}`);
        }
        try {
            const doda = await this.larkService.syncDoDaChannelData();
            this.logger.log(`✅ Bootstrap Do Da channel sync: ${doda?.synced ?? 0} records`);
        } catch (err) {
            this.logger.error(`❌ Bootstrap Do Da channel sync failed: ${err?.message}`);
        }
        this.logger.log('🎉 Deferred Lark sync finished!');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // HR Lark sync — mỗi ngày (chạy lệch phút để tuần tự với các cron khác)
    // ──────────────────────────────────────────────────────────────────────────
    @Cron('0 30 13 * * *', { name: 'lark-auto-sync', timeZone: 'Asia/Ho_Chi_Minh' })
    async scheduledSync() {
        if (this.syncLock) {
            this.logger.warn('⏭️ HR sync skipped — another sync is in progress');
            return;
        }
        this.syncLock = true;
        this.logger.log('⏰ Scheduled Lark HR sync triggered (daily at 13:30)');
        try {
            const result = await this.syncFromLark();
            this.logger.log(
                `✅ Scheduled sync done: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`,
            );
        } catch (err) {
            this.logger.error(`❌ Scheduled Lark sync failed: ${err.message}`);
        } finally {
            this.syncLock = false;
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // KPI + Employee + Reports — mỗi ngày (tuần tự để giảm áp lực DB)
    // ──────────────────────────────────────────────────────────────────────────
    @Cron('0 40 13 * * *', { name: 'lark-sequential-data-sync', timeZone: 'Asia/Ho_Chi_Minh' })
    async scheduledDataSync() {
        if (this.syncLock) {
            this.logger.warn('⏭️ Data sync skipped — another sync is in progress');
            return;
        }
        this.syncLock = true;
        this.logger.log('⏰ Scheduled Lark data sync triggered (daily at 13:40 — KPI + Employee + Reports)');
        try {
            const kpi = await this.larkService.syncKPIData();
            this.logger.log(`✅ KPI sync: ${kpi?.synced ?? 0} records`);
        } catch (err) {
            this.logger.error(`❌ KPI sync failed: ${err.message}`);
        }
        try {
            const kpiDd = await this.larkService.syncKPIDoDaData();
            this.logger.log(`✅ KPI Đồ Da sync: ${kpiDd?.synced ?? 0} records`);
        } catch (err) {
            this.logger.error(`❌ KPI Đồ Da sync failed: ${err.message}`);
        }
        try {
            const emp = await this.larkService.syncEmployeeData();
            this.logger.log(`✅ Employee sync: ${emp?.synced ?? 0} records`);
        } catch (err) {
            this.logger.error(`❌ Employee sync failed: ${err.message}`);
        }
        try {
            await this.larkService.syncReportData();
            this.logger.log('✅ Report sync completed');
        } catch (err) {
            this.logger.error(`❌ Report sync failed: ${err.message}`);
        }
        try {
            await this.larkService.syncPermissionData();
            this.logger.log('✅ Permission sync completed');
        } catch (err) {
            this.logger.error(`❌ Permission sync failed: ${err.message}`);
        }
        this.syncLock = false;
    }

    async syncFromLark(): Promise<{
        total: number;
        created: number;
        updated: number;
        skipped: number;
        errors: string[];
        details: any[];
    }> {
        this.logger.log('🔄 Starting Lark HR sync...');
        const records = await this.larkService.fetchHRRecords();

        const result = {
            total: records.length,
            created: 0,
            updated: 0,
            skipped: 0,
            errors: [] as string[],
            details: [] as any[],
        };

        for (const record of records) {
            try {
                const parsed = this.larkService.parseRecord(record);
                if (!parsed) {
                    result.skipped++;
                    continue;
                }

                const userRoles = this.larkService.mapToUserRoles(parsed.role, parsed.team, parsed.position);

                const existingUser = await this.prisma.user.findUnique({
                    where: { email: parsed.email },
                });

                if (existingUser) {
                    // --- GIẢI PHÁP AN TOÀN: Kiểm tra chốt chặn thời gian ---
                    // Nếu user mới được sửa trên App gần đây (ví dụ trong vòng 60 phút)
                    // thì không cho Lark sync ghi đè lên, để đợi Lark cập nhật xong đã.
                    const lastUpdate = (existingUser as any).last_app_update_at;
                    if (lastUpdate) {
                        const diffMinutes = (Date.now() - new Date(lastUpdate).getTime()) / (1000 * 60);
                        if (diffMinutes < 60) {
                            this.logger.warn(`[LarkSync] 🛡️ Skip overwrite for ${parsed.email}: Recently updated in App (${Math.round(diffMinutes)} mins ago)`);
                            result.skipped++;
                            continue;
                        }
                    }

                    await this.prisma.user.update({
                        where: { email: parsed.email },
                        data: {
                            full_name: parsed.full_name,
                            roles: userRoles as any[],
                            is_active: parsed.is_active,
                        },
                    });
                    result.updated++;
                    result.details.push({ email: parsed.email, action: 'updated', roles: userRoles, team: parsed.team });
                    this.logger.log(`📝 Updated: ${parsed.email} → [${userRoles.join(', ')}]`);
                } else {
                    const defaultPassword = await bcrypt.hash('VCB@2024', 10);
                    await this.prisma.user.create({
                        data: {
                            email: parsed.email,
                            password_hash: defaultPassword,
                            full_name: parsed.full_name,
                            roles: userRoles as any[],
                            is_active: parsed.is_active,
                        },
                    });
                    result.created++;
                    result.details.push({ email: parsed.email, action: 'created', roles: userRoles, team: parsed.team });
                    this.logger.log(`✅ Created: ${parsed.email} → [${userRoles.join(', ')}]`);
                }
            } catch (error) {
                const msg = `Error processing record ${record.record_id}: ${error.message}`;
                result.errors.push(msg);
                this.logger.error(msg);
            }
        }

        await this.assignTeamRelationships();
        this.logger.log(
            `🏁 Sync complete: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.errors.length} errors`,
        );
        return result;
    }

    private async assignTeamRelationships(): Promise<void> {
        this.logger.log('🔗 Team relationship step complete (Simplified: leaders removed)');
        this.logger.log('✅ Team relationships assigned');
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

        const dbUsers = await this.prisma.user.findMany({ select: { email: true } });
        const dbEmails = dbUsers.map((u) => u.email);

        return {
            lark_count: larkEmails.length,
            db_count: dbEmails.length,
            missing_in_db: larkEmails.filter((e) => !dbEmails.includes(e)),
            extra_in_db: dbEmails.filter((e) => !larkEmails.includes(e)),
        };
    }
}
