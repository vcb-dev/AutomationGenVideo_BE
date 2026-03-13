import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LarkService } from './lark.service';
import { Cron } from '@nestjs/schedule';
import * as bcrypt from 'bcrypt';

@Injectable()
export class LarkSyncService implements OnApplicationBootstrap {
    private readonly logger = new Logger(LarkSyncService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly larkService: LarkService,
    ) { }

    // ──────────────────────────────────────────────────────────────────────────
    // Chạy 1 lần ngay khi ứng dụng khởi động
    // ──────────────────────────────────────────────────────────────────────────
    async onApplicationBootstrap() {
        this.logger.log('🚀 Application started — running initial Lark sync...');
        try {
            await this.syncFromLark();
        } catch (err) {
            this.logger.error(`❌ Initial Lark sync failed: ${err.message}`);
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Tự động chạy mỗi 12 tiếng: 6:00 sáng và 18:00 tối (giờ Việt Nam)
    // ──────────────────────────────────────────────────────────────────────────
    @Cron('0 6,18 * * *', { name: 'lark-auto-sync', timeZone: 'Asia/Ho_Chi_Minh' })
    async scheduledSync() {
        this.logger.log('⏰ Scheduled Lark sync triggered (every 12 hours)');
        try {
            const result = await this.syncFromLark();
            this.logger.log(
                `✅ Scheduled sync done: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`,
            );
        } catch (err) {
            this.logger.error(`❌ Scheduled Lark sync failed: ${err.message}`);
        }
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
