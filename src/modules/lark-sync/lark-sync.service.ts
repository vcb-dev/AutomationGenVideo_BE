import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LarkService } from './lark.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class LarkSyncService {
    private readonly logger = new Logger(LarkSyncService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly larkService: LarkService,
    ) { }

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

                // Map Lark role to our UserRole array
                const userRoles = this.larkService.mapToUserRoles(parsed.role, parsed.team);

                const existingUser = await this.prisma.user.findUnique({
                    where: { email: parsed.email },
                });

                if (existingUser) {
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
        this.logger.log(`🏁 Sync complete: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.errors.length} errors`);
        return result;
    }

    private async assignTeamRelationships(): Promise<void> {
        this.logger.log('🔗 Assigning team relationships...');

        const leaders = await this.prisma.user.findMany({
            where: {
                roles: { hasSome: ['LEADER_VIDEO', 'LEADER_CONTENT'] as any[] },
                is_active: true,
            },
        });

        const managers = await this.prisma.user.findMany({
            where: {
                roles: { has: 'MANAGER' as any },
                is_active: true,
            },
        });

        if (managers.length > 0) {
            const defaultManager = managers[0];
            for (const leader of leaders) {
                if (!leader.manager_id) {
                    await this.prisma.user.update({
                        where: { id: leader.id },
                        data: { manager_id: defaultManager.id },
                    });
                    this.logger.log(`🔗 Assigned leader ${leader.email} → manager ${defaultManager.email}`);
                }
            }
        }

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
            .map((r) => r.email);

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
