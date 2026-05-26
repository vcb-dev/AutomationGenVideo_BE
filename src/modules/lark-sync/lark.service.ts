
import { Injectable, Logger, OnModuleInit, OnApplicationBootstrap } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, PrismaClient, UserRole } from '@prisma/client';
import { resolveTrackedUsername } from './channel-to-tracked.util';
import { ChannelStatsEnrichmentService } from '../channel-enrichment/channel-stats-enrichment.service';
import { CacheService } from '../../common/cache/cache.service';

/** Chuẩn hóa cột trạng thái kênh Lark — chỉ "Đang hoạt động" (sau chuẩn hóa) được coi là active. */
function normalizeLarkChannelActivityStatus(status: string | null | undefined): string {
    if (!status || typeof status !== 'string') return '';
    return status.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isLarkChannelActiveStatus(status: string | null | undefined): boolean {
    const s = normalizeLarkChannelActivityStatus(status);
    return s === 'đang hoạt động' || s === 'on' || s === 'active' || s === 'hoạt động';
}

@Injectable()
export class LarkService implements OnModuleInit, OnApplicationBootstrap {
    private readonly logger = new Logger(LarkService.name);
    private accessToken: string;
    private tokenExpiresAt: number;
    private readonly activitySharedCacheTtlMs: number;
    private readonly activityRoleCacheTtlMs: number;

    // Lark API credentials
    private readonly APP_ID: string;
    private readonly APP_SECRET: string;

    // Lark Bitable IDs - Report Table
    private readonly REPORT_BASE_ID: string;
    private readonly REPORT_TABLE_ID: string;

    // Lark Bitable IDs - KPI & Employee Tables
    private readonly KPI_BASE_ID: string;
    private readonly KPI_TABLE_ID: string;
    private readonly EMPLOYEE_TABLE_ID: string;
    private readonly PERMISSION_TABLE_ID: string;
    private readonly LIST_TASK_TABLE_ID: string;
    private readonly OUTSTANDING_TABLE_ID: string;
    private readonly TRAFFIC_TABLE_ID: string;
    /** KPI hiệu suất Đồ Da — wiki Bitable (cùng app token nhiều khi dùng cho kênh Đồ Da) */
    private readonly KPI_DODA_BASE_ID: string;
    private readonly KPI_DODA_TABLE_ID: string;

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
        private readonly prisma: PrismaService,
        private readonly channelStatsEnrichment: ChannelStatsEnrichmentService,
        private readonly cacheService: CacheService,
    ) {
        // Load credentials from environment
        this.APP_ID = this.configService.get<string>('LARK_APP_ID');
        this.APP_SECRET = this.configService.get<string>('LARK_APP_SECRET');

        // Load Bitable IDs from environment
        this.REPORT_BASE_ID = this.configService.get<string>('LARK_VCB_HR_BASE_ID');
        this.REPORT_TABLE_ID = this.configService.get<string>('LARK_REPORT_TABLE_ID');
        this.KPI_BASE_ID = this.configService.get<string>('LARK_QLTASK_BASE_ID');
        this.KPI_TABLE_ID = this.configService.get<string>('LARK_KPI_TABLE_ID');
        this.EMPLOYEE_TABLE_ID = this.configService.get<string>('LARK_EMPLOYEE_TABLE_ID');
        this.PERMISSION_TABLE_ID = this.configService.get<string>('LARK_PERMISSION_TABLE_ID');
        this.LIST_TASK_TABLE_ID = this.configService.get<string>('LARK_LIST_TASK_TABLE_ID') || 'tblUubDhUoJ9TV7m';
        this.OUTSTANDING_TABLE_ID = this.configService.get<string>('LARK_OUTSTANDING_TABLE_ID') || 'tbluurIuf2qDCdFr';
        this.TRAFFIC_TABLE_ID = this.configService.get<string>('LARK_TRAFFIC_TABLE_ID') || 'tblsybBYaPKfsqQK';
        this.KPI_DODA_BASE_ID =
            this.configService.get<string>('LARK_KPI_DODA_BASE_ID') || 'Livew1AE0i2vo5kF3YXlCPNWg8f';
        this.KPI_DODA_TABLE_ID =
            this.configService.get<string>('LARK_KPI_DODA_TABLE_ID') || 'tblI1NzUOszaehhQ';
        // Keep activity data cached longer to cut repeated SQL load from frequent polling.
        this.activitySharedCacheTtlMs = Math.max(
            30_000,
            Number(this.configService.get<string>('LARK_ACTIVITY_SHARED_CACHE_TTL_MS') || 5 * 60 * 1000),
        );
        this.activityRoleCacheTtlMs = Math.max(
            60_000,
            Number(this.configService.get<string>('LARK_ACTIVITY_ROLE_CACHE_TTL_MS') || 30 * 60 * 1000),
        );
    }

    async onModuleInit() {
        this.logger.log('LarkService initialized, invalidating activity reports cache...');
        this.invalidateActivityCache();
    }

    async onApplicationBootstrap() {
        // Delay 30s để DB + Redis kịp kết nối trước khi sync
        const DELAY_MS = 30_000;
        this.logger.log(`🚀 [Bootstrap] Server started — sẽ tự động sync Lark sau ${DELAY_MS / 1000}s...`);
        setTimeout(() => {
            this.logger.log('🔄 [Bootstrap] Kích hoạt tiến trình Sync dữ liệu Lark (Non-blocking)...');
            this.handleCron().catch(err => this.logger.error('CRON Bootstrap failure', err));
        }, DELAY_MS);
    }

    /**
     * Bảng `lark_kpi_do_da` (model LarkKpiDoDa). Cùng hình delegate với `larkKPI` trong schema.
     * Dùng unknown + LarkKPIDelegate để tránh lệch kiểu giữa IDE (client cũ/cache) và `npx prisma generate`.
     */
    private get prismaLarkKpiDoDa(): Prisma.LarkKPIDelegate {
        return (this.prisma as unknown as { larkKpiDoDa: Prisma.LarkKPIDelegate }).larkKpiDoDa;
    }

    /** Bảng KPI Đồ Da tách riêng theo Người edit + Ngày edit. */
    private get prismaLarkKpiDoDaEditor() {
        return (this.prisma as unknown as { larkKpiDoDaEditor: any }).larkKpiDoDaEditor;
    }

    /** Merge team strings while preserving all unique teams. */
    private mergeTeamValues(...values: Array<string | null | undefined>): string | null {
        const tokens: string[] = [];
        for (const raw of values) {
            if (!raw) continue;
            for (const part of String(raw).split(',')) {
                const clean = part.trim();
                if (!clean) continue;
                if (!tokens.some((t) => t.toLowerCase() === clean.toLowerCase())) {
                    tokens.push(clean);
                }
            }
        }
        return tokens.length ? tokens.join(', ') : null;
    }

    /**
     * Build YYYY-MM-DD key in Vietnam timezone.
     * Used for day-level comparisons to avoid UTC off-by-one issues.
     */
    private toVietnamDateKey(date: Date): string {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Ho_Chi_Minh',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(date);
    }

    /**
     * Global lower bound for KPI sync window used by startup + cron sync.
     * Default: March 1st of the current Vietnam year (auto-advances each year).
     * Override by env `LARK_KPI_MIN_DATE` (format YYYY-MM-DD) if needed.
     */
    private getKpiMinDateKey(): string {
        const envVal = String(this.configService.get<string>('LARK_KPI_MIN_DATE') || '').trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(envVal)) return envVal;
        // Dynamic: always March 1st of the current year in Vietnam timezone
        const nowVN = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Ho_Chi_Minh',
            year: 'numeric',
        }).format(new Date());
        const currentYear = nowVN.slice(0, 4);
        return `${currentYear}-03-01`;
    }

    /** Min date riêng cho KPI Đồ Da (lark_kpi_do_da_editor). Default: March 1st current year. */
    private getKpiDoDaMinDateKey(): string {
        const envVal = String(this.configService.get<string>('LARK_KPI_DODA_MIN_DATE') || '').trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(envVal)) return envVal;
        const nowVN = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Ho_Chi_Minh',
            year: 'numeric',
        }).format(new Date());
        const currentYear = nowVN.slice(0, 4);
        return `${currentYear}-03-01`;
    }

    /**
     * Upper bound for KPI sync window: today in Vietnam timezone (inclusive).
     * Records with report_date after today are excluded.
     */
    private getKpiMaxDateKey(): string {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Ho_Chi_Minh',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date());
    }

    private stripEnvQuotes(val: string): string {
        const t = val.trim();
        if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
        return t;
    }

    /** Expose sanitized DB targets for debugging (no passwords). */
    getDbTargetsDebugInfo() {
        const dbRaw = String(this.configService.get<string>('DATABASE_URL') || '').trim();
        const remote = this.getRemoteMirrorDbUrl();
        const sanitize = (raw: string | null) => {
            if (!raw) return null;
            const v = this.stripEnvQuotes(raw);
            try {
                const u = new URL(v);
                // Hide credentials completely
                const safe = `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname}${u.search}`;
                return { host: u.hostname, port: u.port || null, database: u.pathname?.replace(/^\//, '') || null, safe };
            } catch {
                // Not a URL (or contains unsupported chars) → do best-effort redaction
                const safe = v.replace(/\/\/([^:@/]+):([^@/]+)@/g, '//$1:***@');
                return { host: null, port: null, database: null, safe };
            }
        };

        return {
            databaseUrl: sanitize(dbRaw || null),
            remoteMirrorUrl: sanitize(remote),
            kpiMirrorEnabled: String(this.configService.get<string>('LARK_KPI_MIRROR_TO_SERVER') ?? 'true'),
            channelMirrorEnabled: String(this.configService.get<string>('LARK_CHANNEL_MIRROR_TO_SERVER') ?? 'true'),
            kpiMinDate: this.getKpiMinDateKey(),
        };
    }

    /**
     * Optional: sau khi build batch KPI từ Lark và ghi vào DATABASE_URL, replace-all cùng batch
     * lên DB remote (SERVER_DATABASE_URL hoặc LARK_KPI_REMOTE_DATABASE_URL) để server khớp máy đang chạy sync.
     * Tắt: LARK_KPI_MIRROR_TO_SERVER=false. Bỏ qua nếu trùng URL với DATABASE_URL.
     * Production: đặt DATABASE_URL trỏ thẳng Postgres server — cron ghi Lark → server trực tiếp, không cần mirror.
     */
    private getRemoteMirrorDbUrl(): string | null {
        const flag = String(this.configService.get<string>('LARK_KPI_MIRROR_TO_SERVER') ?? 'true').toLowerCase();
        if (flag === '0' || flag === 'false' || flag === 'no') return null;
        const serverRaw =
            this.configService.get<string>('SERVER_DATABASE_URL')?.trim() ||
            this.configService.get<string>('LARK_KPI_REMOTE_DATABASE_URL')?.trim();
        const localRaw = this.configService.get<string>('DATABASE_URL');
        if (!serverRaw) return null;
        const su = this.stripEnvQuotes(serverRaw);
        const lu = localRaw ? this.stripEnvQuotes(localRaw) : '';
        if (lu && su === lu) return null;
        return su;
    }

    /**
     * Direct-sync mode: write Lark data straight to SERVER_DATABASE_URL (used by API + cron paths).
     * Disable with LARK_SYNC_DIRECT_TO_SERVER=false.
     */
    private getDirectSyncDbUrl(): string | null {
        const flag = String(this.configService.get<string>('LARK_SYNC_DIRECT_TO_SERVER') ?? 'false').toLowerCase();
        if (flag === '0' || flag === 'false' || flag === 'no') return null;
        const serverRaw = this.configService.get<string>('SERVER_DATABASE_URL')?.trim();
        if (!serverRaw) return null;
        const su = this.stripEnvQuotes(serverRaw);
        const lu = this.stripEnvQuotes(String(this.configService.get<string>('DATABASE_URL') || '').trim());
        if (lu && su === lu) return null;
        return su;
    }

    /**
     * Explicit target for local -> server snapshot push.
     * Uses SERVER_DATABASE_URL first, then fallback LARK_KPI_REMOTE_DATABASE_URL.
     */
    private getServerSyncDbUrl(): string | null {
        const serverRaw =
            this.configService.get<string>('SERVER_DATABASE_URL')?.trim() ||
            this.configService.get<string>('LARK_KPI_REMOTE_DATABASE_URL')?.trim();
        if (!serverRaw) return null;
        const su = this.stripEnvQuotes(serverRaw);
        const lu = this.stripEnvQuotes(String(this.configService.get<string>('DATABASE_URL') || '').trim());
        if (lu && su === lu) return null;
        return su;
    }

    /** Số lần thử mirror (mạng / Cloud SQL transient). Env LARK_KPI_MIRROR_RETRIES, mặc định 3, tối đa 10. */
    private getMirrorRetryCount(): number {
        const n = Number(this.configService.get<string>('LARK_KPI_MIRROR_RETRIES') || '3');
        if (!Number.isFinite(n) || n < 1) return 3;
        return Math.min(Math.floor(n), 10);
    }

    /** Disable expensive background channel enrichment when API latency is priority. */
    private shouldRunBackgroundChannelEnrich(): boolean {
        const flag = String(this.configService.get<string>('LARK_ENABLE_BACKGROUND_CHANNEL_ENRICH') ?? 'false').toLowerCase();
        return flag === '1' || flag === 'true' || flag === 'yes';
    }

    /** Runtime throttle for background enrich queue. */
    private getBackgroundChannelEnrichConcurrency(): number {
        const n = Number(this.configService.get<string>('LARK_BACKGROUND_CHANNEL_ENRICH_CONCURRENCY') || '1');
        if (!Number.isFinite(n) || n < 1) return 1;
        return Math.min(Math.floor(n), 5);
    }

    private async mirrorLarkKpiSnapshotToServer(rows: Record<string, unknown>[]): Promise<number> {
        const url = this.getRemoteMirrorDbUrl();
        if (!url) return 0;
        const remote = new PrismaClient({ datasources: { db: { url } } });
        const maxRetries = this.getMirrorRetryCount();
        const CHUNK = 400;
        try {
            await this.withRetry(
                async () => {
                    await remote.larkKPI.deleteMany({});
                    for (let i = 0; i < rows.length; i += CHUNK) {
                        const chunk = rows.slice(i, i + CHUNK);
                        if (chunk.length) await remote.larkKPI.createMany({ data: chunk as any, skipDuplicates: true });
                    }
                },
                maxRetries,
                'mirrorLarkKpiSnapshotToServer',
            );
            this.logger.log(`[KPI] Mirrored ${rows.length} lark_kpi row(s) to remote DB (replace-all).`);
            return rows.length;
        } finally {
            await remote.$disconnect().catch(() => undefined);
        }
    }

    private async mirrorLarkKpiDoDaSnapshotToServer(rows: Record<string, unknown>[]): Promise<number> {
        const url = this.getRemoteMirrorDbUrl();
        if (!url) return 0;
        const remote = new PrismaClient({ datasources: { db: { url } } });
        const delegate = (remote as unknown as { larkKpiDoDa: Prisma.LarkKPIDelegate | undefined }).larkKpiDoDa;
        if (!delegate) {
            await remote.$disconnect().catch(() => undefined);
            this.logger.warn('[KPI DoDa] Remote Prisma has no larkKpiDoDa delegate — skip mirror.');
            return 0;
        }
        const maxRetries = this.getMirrorRetryCount();
        const CHUNK = 400;
        try {
            await this.withRetry(
                async () => {
                    await delegate.deleteMany({});
                    for (let i = 0; i < rows.length; i += CHUNK) {
                        const chunk = rows.slice(i, i + CHUNK);
                        if (chunk.length) await delegate.createMany({ data: chunk as any, skipDuplicates: true });
                    }
                },
                maxRetries,
                'mirrorLarkKpiDoDaSnapshotToServer',
            );
            this.logger.log(`[KPI DoDa] Mirrored ${rows.length} lark_kpi_do_da row(s) to remote DB.`);
            return rows.length;
        } finally {
            await remote.$disconnect().catch(() => undefined);
        }
    }

    private async mirrorLarkKpiDoDaEditorSnapshotToServer(rows: Record<string, unknown>[]): Promise<number> {
        const url = this.getRemoteMirrorDbUrl();
        if (!url) return 0;
        const remote = new PrismaClient({ datasources: { db: { url } } });
        const delegate = (remote as unknown as { larkKpiDoDaEditor: any }).larkKpiDoDaEditor;
        if (!delegate) {
            await remote.$disconnect().catch(() => undefined);
            this.logger.warn('[KPI DoDa Editor] Remote Prisma has no larkKpiDoDaEditor delegate — skip mirror.');
            return 0;
        }
        const maxRetries = this.getMirrorRetryCount();
        const CHUNK = 400;
        try {
            await this.withRetry(
                async () => {
                    await delegate.deleteMany({});
                    for (let i = 0; i < rows.length; i += CHUNK) {
                        const chunk = rows.slice(i, i + CHUNK);
                        if (chunk.length) await delegate.createMany({ data: chunk as any, skipDuplicates: true });
                    }
                },
                maxRetries,
                'mirrorLarkKpiDoDaEditorSnapshotToServer',
            );
            this.logger.log(`[KPI DoDa Editor] Mirrored ${rows.length} row(s) to remote DB.`);
            return rows.length;
        } finally {
            await remote.$disconnect().catch(() => undefined);
        }
    }

    /**
     * Optional mirror Channel (non-DoDa) to remote DB to keep dashboard metrics consistent between local and server.
     * Controlled by env LARK_CHANNEL_MIRROR_TO_SERVER (default: true when remote DB url is provided).
     */
    private shouldMirrorChannels(): boolean {
        const flag = String(this.configService.get<string>('LARK_CHANNEL_MIRROR_TO_SERVER') ?? 'true').toLowerCase();
        if (flag === '0' || flag === 'false' || flag === 'no') return false;
        return true;
    }

    private async mirrorChannelSnapshotToServer(rows: Record<string, unknown>[]): Promise<number> {
        const url = this.getRemoteMirrorDbUrl();
        if (!url || !this.shouldMirrorChannels()) return 0;
        const remote = new PrismaClient({ datasources: { db: { url } } });
        const maxRetries = this.getMirrorRetryCount();
        const CHUNK = 400;
        try {
            await this.withRetry(
                async () => {
                    await remote.channel.deleteMany({ where: { NOT: { id: { startsWith: 'doda_' } } } });
                    for (let i = 0; i < rows.length; i += CHUNK) {
                        const chunk = rows.slice(i, i + CHUNK);
                        if (chunk.length) await remote.channel.createMany({ data: chunk as any, skipDuplicates: true });
                    }
                },
                maxRetries,
                'mirrorChannelSnapshotToServer',
            );
            this.logger.log(`[Channel] Mirrored ${rows.length} channel row(s) to remote DB (kept Do Da).`);
            return rows.length;
        } finally {
            await remote.$disconnect().catch(() => undefined);
        }
    }

    /** Replace-all chỉ các dòng `doda_*` trên server (sau khi sync Đồ Da + enrich local). */
    private async mirrorDoDaChannelSnapshotToServer(rows: Record<string, unknown>[]): Promise<number> {
        const url = this.getRemoteMirrorDbUrl();
        if (!url || !this.shouldMirrorChannels()) return 0;
        const remote = new PrismaClient({ datasources: { db: { url } } });
        const maxRetries = this.getMirrorRetryCount();
        const CHUNK = 400;
        try {
            await this.withRetry(
                async () => {
                    await remote.channel.deleteMany({ where: { id: { startsWith: 'doda_' } } });
                    for (let i = 0; i < rows.length; i += CHUNK) {
                        const chunk = rows.slice(i, i + CHUNK);
                        if (chunk.length) await remote.channel.createMany({ data: chunk as any, skipDuplicates: true });
                    }
                },
                maxRetries,
                'mirrorDoDaChannelSnapshotToServer',
            );
            this.logger.log(`[Channel DoDa] Mirrored ${rows.length} row(s) to remote DB.`);
            return rows.length;
        } finally {
            await remote.$disconnect().catch(() => undefined);
        }
    }

    /**
     * Push snapshot from local DATABASE_URL -> SERVER_DATABASE_URL.
     * Order:
     * 1) users
     * 2) channel
     * 3) lark_kpi
     * 4) lark_kpi_do_da
     */
    private async syncLocalSnapshotToServer(): Promise<{
        kpi: number;
        kpiDoDa: number;
        kpiDoDaEditor: number;
    }> {
        const url = this.getServerSyncDbUrl();
        if (!url) {
            this.logger.log('[Local->Server] Skipped: SERVER_DATABASE_URL is not configured (or equals DATABASE_URL).');
            return { kpi: 0, kpiDoDa: 0, kpiDoDaEditor: 0 };
        }

        const CHUNK = 400;
        const maxRetries = this.getMirrorRetryCount();
        const remote = new PrismaClient({ datasources: { db: { url } } });
        const remoteDoDa = (remote as unknown as { larkKpiDoDa?: Prisma.LarkKPIDelegate }).larkKpiDoDa;
        const remoteDoDaEditor = (remote as unknown as { larkKpiDoDaEditor?: any }).larkKpiDoDaEditor;

        try {
            const KPI_MIN_DATE_KEY = this.getKpiMinDateKey();
            const KPI_MAX_DATE_KEY = this.getKpiMaxDateKey();
            const kpiDateWindow = {
                gte: new Date(`${KPI_MIN_DATE_KEY}T00:00:00.000Z`),
                lte: new Date(`${KPI_MAX_DATE_KEY}T23:59:59.999Z`),
            };
            const [kpis, kpiDoDaRows, kpiDoDaEditorRows] = await Promise.all([
                this.prisma.larkKPI.findMany({ where: { report_date: kpiDateWindow } }),
                this.prismaLarkKpiDoDa.findMany({ where: { report_date: kpiDateWindow } }),
                this.prismaLarkKpiDoDaEditor.findMany({ where: { report_date: kpiDateWindow } }),
            ]);

            await this.withRetry(
                async () => {
                    await remote.larkKPI.deleteMany({});
                    for (let i = 0; i < kpis.length; i += CHUNK) {
                        const chunk = kpis.slice(i, i + CHUNK);
                        if (chunk.length) await remote.larkKPI.createMany({ data: chunk as any, skipDuplicates: true });
                    }
                },
                maxRetries,
                'syncLocalKpiToServer',
            );

            if (remoteDoDa) {
                await this.withRetry(
                    async () => {
                        await remoteDoDa.deleteMany({});
                        for (let i = 0; i < kpiDoDaRows.length; i += CHUNK) {
                            const chunk = kpiDoDaRows.slice(i, i + CHUNK);
                            if (chunk.length) await remoteDoDa.createMany({ data: chunk as any, skipDuplicates: true });
                        }
                    },
                    maxRetries,
                    'syncLocalKpiDoDaToServer',
                );
            } else {
                this.logger.warn('[Local->Server] Remote Prisma has no larkKpiDoDa delegate - skipped lark_kpi_do_da.');
            }

            if (remoteDoDaEditor) {
                await this.withRetry(
                    async () => {
                        try {
                            await remoteDoDaEditor.deleteMany({});
                            for (let i = 0; i < kpiDoDaEditorRows.length; i += CHUNK) {
                                const chunk = kpiDoDaEditorRows.slice(i, i + CHUNK);
                                if (chunk.length) await remoteDoDaEditor.createMany({ data: chunk as any, skipDuplicates: true });
                            }
                        } catch (err: any) {
                            const msg = String(err?.message || err || '');
                            if (msg.includes('lark_kpi_do_da_editor') && msg.toLowerCase().includes('does not exist')) {
                                this.logger.warn('[Local->Server] Remote DB missing table lark_kpi_do_da_editor - skipped mirror.');
                                return;
                            }
                            throw err;
                        }
                    },
                    maxRetries,
                    'syncLocalKpiDoDaEditorToServer',
                );
            } else {
                this.logger.warn('[Local->Server] Remote Prisma has no larkKpiDoDaEditor delegate - skipped lark_kpi_do_da_editor.');
            }

            this.logger.log(
                `[Local->Server] KPI snapshot pushed: lark_kpi=${kpis.length}, lark_kpi_do_da=${remoteDoDa ? kpiDoDaRows.length : 0}, lark_kpi_do_da_editor=${remoteDoDaEditor ? kpiDoDaEditorRows.length : 0}, window=[${KPI_MIN_DATE_KEY}..${KPI_MAX_DATE_KEY}]`,
            );
            return {
                kpi: kpis.length,
                kpiDoDa: remoteDoDa ? kpiDoDaRows.length : 0,
                kpiDoDaEditor: remoteDoDaEditor ? kpiDoDaEditorRows.length : 0,
            };
        } finally {
            await remote.$disconnect().catch(() => undefined);
        }
    }

    /**
     * Pull lark_kpi snapshot từ SERVER_DATABASE_URL về local DATABASE_URL.
     * D�ng khi local DB bị lỗi / cần đồng bộ lại từ server.
     * Đ�y l� chiều ngược với syncLocalSnapshotToServer (server → local).
     */
    async pullKpiFromServer(): Promise<{ pulled: number }> {
        const url = this.getServerSyncDbUrl();
        if (!url) {
            this.logger.warn('[Server->Local] Skipped: SERVER_DATABASE_URL kh�ng được cấu h�nh (hoặc tr�ng DATABASE_URL).');
            return { pulled: 0 };
        }

        const CHUNK = 400;
        const maxRetries = this.getMirrorRetryCount();
        const remote = new PrismaClient({ datasources: { db: { url } } });

        try {
            const rows = await remote.larkKPI.findMany();
            this.logger.log(`[Server->Local] Lấy ${rows.length} lark_kpi row(s) từ server...`);

            await this.withRetry(
                async () => {
                    await this.prisma.larkKPI.deleteMany({});
                    for (let i = 0; i < rows.length; i += CHUNK) {
                        const chunk = rows.slice(i, i + CHUNK);
                        if (chunk.length) {
                            await this.prisma.larkKPI.createMany({ data: chunk as any, skipDuplicates: true });
                        }
                    }
                },
                maxRetries,
                'pullKpiFromServer',
            );

            this.logger.log(`[Server->Local] Đ� pull ${rows.length} lark_kpi row(s) v�o local DB.`);
            this.invalidateActivityCache();
            return { pulled: rows.length };
        } finally {
            await remote.$disconnect().catch(() => undefined);
        }
    }

    /**
     * Normalize any parsed date into a stable instant representing that Vietnam day.
     * We store 12:00 VN (05:00 UTC) so both VN date and UTC date remain the same calendar day.
     */
    private toVietnamNoonUtc(date: Date): Date {
        const dateKey = this.toVietnamDateKey(date); // YYYY-MM-DD in VN
        const [y, m, d] = dateKey.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d, 5, 0, 0, 0)); // 12:00 Asia/Ho_Chi_Minh
    }

    async getAccessToken(): Promise<string> {
        if (!this.APP_ID || !this.APP_SECRET) {
            throw new Error('LARK_APP_ID and LARK_APP_SECRET must be configured in .env file');
        }

        if (this.accessToken && Date.now() < this.tokenExpiresAt) {
            return this.accessToken;
        }

        return this.withRetry(async () => {
            const response = await firstValueFrom(
                this.httpService.post(
                    'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal',
                    {
                        app_id: this.APP_ID,
                        app_secret: this.APP_SECRET,
                    },
                ),
            );

            if (response.data.code !== 0) {
                throw new Error(`Failed to get access token: ${response.data.msg}`);
            }

            const { tenant_access_token, expire } = response.data;
            this.accessToken = tenant_access_token;
            this.tokenExpiresAt = Date.now() + (expire - 300) * 1000; // Expire 5 mins early
            return this.accessToken;
        }, 3, 'getAccessToken');
    }

    // @Cron('0 0 8,10,12,14,16,18,20,22 * * *', { name: 'lark-data-sync', timeZone: 'Asia/Ho_Chi_Minh' })
    async handleCron() {
        this.logger.log('[Cron] Start full Lark sync: Lark -> local + Lark -> server');
        const startTime = Date.now();

        // Mỗi task flush cache ngay khi xong → UI thấy data của task đó lập tức
        const runTask = async (name: string, task: () => Promise<any>) => {
            try {
                const start = Date.now();
                await task();
                this.logger.log(`[Cron] ${name} completed in ${Date.now() - start}ms`);
                this.invalidateActivityCache(); // flush ngay sau khi task xong
            } catch (e: any) {
                this.logger.error(`[Cron] ${name} failed: ${e?.message || e}`, e?.stack);
            }
        };

        // Phase 1: Sequential KPI sync
        await runTask('KPI (local+server)', () => this.syncKPIData());
        await runTask('KPI DoDa (local+server)', () => this.syncKPIDoDaData());

        // Phase 2: Sequential remaining sync tasks
        await runTask('ListTask', () => this.syncListTaskData());
        await runTask('Permission', () => this.syncPermissionData());
        await runTask('Employee', () => this.syncEmployeeData());
        await runTask('Channel VCB', () => this.syncChannelData());
        await runTask('Channel DoDa', () => this.syncDoDaChannelData());

        this.logger.log(`[Cron] Finished full sync flow in ${Date.now() - startTime}ms.`);
    }
    @Cron('0 10 8,10,12,14,16,18,20,22 * * *', { name: 'lark-activity-cache-flush', timeZone: 'Asia/Ho_Chi_Minh' })
    async handleCacheFlushCron() {
        this.logger.log('Scheduled activity cache flush (post-sync)...');
        this.invalidateActivityCache();
    }

    // Cleanup invalid Lark rows — chạy sau sync chính để giảm tải DB giờ cao điểm
    @Cron('0 20 12 * * *', { name: 'lark-data-cleanup', timeZone: 'Asia/Ho_Chi_Minh' })  // cleanup chỉ cần 1 lần/ngày
    async handleCleanup() {
        this.logger.log('Starting scheduled data cleanup for Lark tables (daily at 12:20)...');
        try {
            // Cleanup Logic for LarkKPI
            const kpiResult = await this.prisma.larkKPI.deleteMany({
                where: {
                    OR: [
                        { name: null },
                        { name: '' },
                        { name: { equals: 'Unknown' } },
                        { name: { equals: ' ' } },
                        { name: { equals: '  ' } }
                    ]
                }
            });

            // Cleanup Logic for LarkReport
            const reportResult = await this.prisma.larkReport.deleteMany({
                where: {
                    OR: [
                        { name: { equals: 'Unknown' } },
                        { name: { equals: '' } }
                    ]
                }
            });

            // Cleanup synthetic Lark-only users with invalid names
            const employeeResult = await this.prisma.user.deleteMany({
                where: {
                    email: { endsWith: '@employee.vcb.internal' },
                    OR: [
                        { full_name: { equals: 'Unknown' } },
                        { full_name: { equals: '' } },
                        { full_name: { equals: ' ' } },
                    ],
                },
            });

            this.logger.log(`Cleanup completed: 
                - Removed ${kpiResult.count} invalid KPI records.
                - Removed ${reportResult.count} invalid Report records.
                - Removed ${employeeResult.count} invalid Lark-placeholder user records.`);
        } catch (error) {
            this.logger.error('Failed to run data cleanup', error);
        }
    }

    async syncReportData() {
        try {
            const records = await this.fetchLarkRecordsGeneric(this.REPORT_BASE_ID, this.REPORT_TABLE_ID, 500);
            this.logger.log(`Fetched ${records.length} Report records from Lark (Table: ${this.REPORT_TABLE_ID}). Syncing to database...`);

            if (!records || records.length === 0) {
                this.logger.warn('No report records fetched from Lark.');
                return { synced: 0 };
            }

            // Load users for role and team lookup (chỉ active, giới hạn 5000)
            const sysUsers = await this.prisma.user.findMany({
                where: { is_active: true },
                select: { full_name: true, employee_id: true, email: true, team: true, roles: true },
                take: 5000,
            });
            const dbUsersMap = new Map<string, any>();
            sysUsers.forEach(u => {
                if (u.employee_id) dbUsersMap.set(String(u.employee_id).trim(), u);
                if (u.email) dbUsersMap.set(String(u.email).toLowerCase().trim(), u);
                if (u.full_name) dbUsersMap.set(u.full_name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' '), u);
            });

            let syncedCount = 0;
            for (const record of records) {
                const reportData = this.mapRecordToReport(record, dbUsersMap);

                if (!reportData.name || reportData.name === 'Unknown') continue;

                await this.prisma.larkReport.upsert({
                    where: { id: reportData.id },
                    update: {
                        name: reportData.name,
                        email: reportData.email,
                        team: reportData.team,
                        role: reportData.role,
                        date: reportData.date,
                        answers: reportData.answers,
                        updated_at: new Date(),
                    },
                    create: {
                        id: reportData.id,
                        name: reportData.name,
                        email: reportData.email,
                        team: reportData.team,
                        role: reportData.role,
                        date: reportData.date,
                        answers: reportData.answers,
                    },
                });
                syncedCount++;
            }

            this.logger.log(`Synced ${syncedCount} report records.`);
            return { synced: syncedCount };
        } catch (error) {
            this.logger.error('Failed to sync report data', error);
            throw error;
        }
    }

    async syncTrafficData() {
        this.logger.log('[LarkSync] syncTrafficData disabled - this table is now independent.');
        return;
    }

    /**
     * DEBUG: Fetch all field metadata from the Traffic table in Lark
     */
    async getTrafficTableFields() {
        const token = await this.getAccessToken();
        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${this.KPI_BASE_ID}/tables/${this.TRAFFIC_TABLE_ID}/fields`;
        const response = await firstValueFrom(
            this.httpService.get(url, { headers: { Authorization: `Bearer ${token}` } })
        );
        const fields = response.data?.data?.items || [];
        return {
            total: fields.length,
            fields: fields.map((f: any) => ({
                id: f.field_id,
                name: f.field_name,
                type: f.type,
            }))
        };
    }

    /**
     * Upload a file buffer to Lark Drive and return file_token
     * Uses: POST /open-apis/drive/v1/medias/upload_all (multipart/form-data)
     */
    async uploadEvidenceToLark(fileBuffer: Buffer, fileName: string, mimeType: string): Promise<string> {
        const token = await this.getAccessToken();
        const FormData = require('form-data');
        const form = new FormData();
        form.append('file_name', fileName);
        form.append('parent_type', 'bitable_file');
        form.append('parent_node', this.KPI_BASE_ID);
        form.append('size', fileBuffer.length.toString());
        form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });

        try {
            const response = await firstValueFrom(
                this.httpService.post(
                    'https://open.larksuite.com/open-apis/drive/v1/medias/upload_all',
                    form,
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            ...form.getHeaders(),
                        },
                    }
                )
            );

            if (response.data.code !== 0) {
                throw new Error(`Lark upload failed: ${response.data.msg}`);
            }

            return response.data.data.file_token;
        } catch (error) {
            this.logger.error('Failed to upload evidence to Lark:', error?.response?.data || error.message);
            throw new Error('Could not upload evidence file to Lark');
        }
    }

    async submitTrafficReport(payload: any) {
        const { email, name, traffic, channels, platformEvidences, reportDate, team: payloadTeam } = payload;
        const normalizedSubmitterEmail = (email || '').trim().toLowerCase();
        // Use precise Vietnam timezone bounds for a report day (UI day -> DB UTC window)
        const getVietnamBounds = (dateInput?: string | Date) => {
            let y = 0, m = 0, d = 0;
            if (typeof dateInput === 'string' && dateInput.length === 10) {
                const parts = dateInput.split('-');
                y = parseInt(parts[0], 10);
                m = parseInt(parts[1], 10) - 1;
                d = parseInt(parts[2], 10);
            } else {
                const dateObj = typeof dateInput === 'string' ? new Date(dateInput) : (dateInput || new Date());
                const vnKey = this.toVietnamDateKey(dateObj);
                const parts = vnKey.split('-');
                y = parseInt(parts[0], 10);
                m = parseInt(parts[1], 10) - 1;
                d = parseInt(parts[2], 10);
            }
            return {
                start: new Date(Date.UTC(y, m, d - 1, 17, 0, 0, 0)),
                end: new Date(Date.UTC(y, m, d, 16, 59, 59, 999))
            };
        };

        // #region agent log
        try {
            const keys = ['fb', 'ig', 'tiktok', 'yt', 'thread', 'lemon8', 'zalo', 'twitter'];
            const evidenceCounts = keys.reduce((acc: any, k) => {
                const v = (platformEvidences as any)?.[k];
                acc[k] = Array.isArray(v) ? v.length : 0;
                return acc;
            }, {} as Record<string, number>);
            const positiveTrafficPlatforms = keys.filter((k) => {
                const v = (traffic as any)?.[k];
                return v && Number(v) > 0;
            });
            fetch('http://127.0.0.1:7242/ingest/50a1c944-63a6-4094-af64-9a73a105402a', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    location: 'lark.service.ts:submitTrafficReport',
                    message: 'traffic report received (evidence optional)',
                    data: {
                        reportDate,
                        positiveTrafficPlatforms,
                        evidenceCounts,
                        hasTrafficDetails: !!(payload as any)?.trafficDetails,
                    },
                    timestamp: Date.now(),
                    hypothesisId: 'H2',
                    runId: 'post-fix',
                }),
            }).catch(() => { });
        } catch {
            // ignore
        }
        // #endregion

        // Remove time constraint 17:00 - 18:00 to match frontend's "Tạm tắt rule chặn thời gian"

        // Check if user is Admin/Manager to bypass constraint
        const userRec = await this.prisma.user.findFirst({ where: { email: { equals: normalizedSubmitterEmail, mode: 'insensitive' as any } } });
        const roles = userRec?.roles || [];
        const isAdmin = roles.includes('ADMIN') || roles.includes('MANAGER');

        // 0. Validate and check date (only for non-admins)
        if (!isAdmin) {
            // Use Intl-based helper to get current date string in VN
            const todayVN = this.toVietnamDateKey(new Date());

            if (reportDate && reportDate > todayVN) {
                throw new Error('Không thể gửi báo cáo cho ngày trong tương lai.');
            }
        }

        const trafficDetails = (payload as any).trafficDetails;
        const breakdown = trafficDetails?.breakdown || {};
        const now = reportDate ? new Date(reportDate) : new Date();
        const monthString = 'T' + (now.getMonth() + 1).toString();
        const bounds = getVietnamBounds(reportDate || now);

        // Guard: once a user already submitted traffic for this day, prevent duplicate re-submit.
        const duplicateOr: any[] = [];
        if (normalizedSubmitterEmail) {
            duplicateOr.push({ email: { equals: normalizedSubmitterEmail, mode: 'insensitive' as any } });
        }
        if (name && String(name).trim()) {
            duplicateOr.push({ name: { equals: String(name).trim(), mode: 'insensitive' as any } });
        }
        if (duplicateOr.length > 0) {
            const existingTraffic = await this.prisma.larkTraffic.findFirst({
                where: {
                    date: { gte: bounds.start, lte: bounds.end },
                    OR: duplicateOr,
                },
                orderBy: { created_at: 'desc' },
            });
            if (existingTraffic) {
                // For multi-team users: allow submitting for a different team on the same day
                if (payloadTeam && String(payloadTeam).trim() && existingTraffic.team !== String(payloadTeam).trim()) {
                    // Different team — allow submission to continue
                } else {
                    return {
                        message: 'Bạn đã báo cáo traffic cho ngày này rồi. Hệ thống giữ dữ liệu đã báo cáo.',
                        alreadySubmitted: true,
                        existingRecordDate: existingTraffic.created_at || existingTraffic.date,
                        recordIds: [],
                    };
                }
            }
        }

        // Lookup team — prefer the specific team sent by FE (multi-team users pick one)
        let team = '';
        if (payloadTeam && String(payloadTeam).trim()) {
            team = String(payloadTeam).trim();
        } else {
            const userRecord = await this.prisma.user.findFirst({ where: { email: { equals: normalizedSubmitterEmail, mode: 'insensitive' as any } } });
            if (userRecord?.team) team = userRecord.team;
            if (!team) {
                const userPerm = await this.getPermissionByEmail(email);
                if (userPerm?.team) team = userPerm.team;
            }
            if (!team && name) {
                const emp = await this.prisma.user.findFirst({
                    where: { full_name: { equals: name, mode: 'insensitive' }, lark_employee_record_id: { not: null } },
                });
                if (emp?.team) team = emp.team;
            }
        }

        const platformKeys = ['fb', 'ig', 'tiktok', 'yt', 'thread', 'lemon8', 'zalo', 'twitter'];
        const recordsToCreate = [];

        // 1. Process breakdown-based submissions
        platformKeys.forEach(pKey => {
            const platformEntries = breakdown[pKey] || [];
            platformEntries.forEach((entry: any) => {
                const val = parseInt(entry.value || '0');
                if (val > 0) {
                    const data: any = {
                        id: `local_trf_${pKey}_${Math.random().toString(36).slice(2, 7)}_${Date.now()}`,
                        email, name, date: now, employee: name, team, month: monthString,
                        total_traffic: BigInt(val),
                        is_confirmed: 'Pending',
                    };
                    data[`traffic_${pKey}`] = BigInt(val);
                    data[`channel_${pKey}`] = entry.channel || null;
                    if (entry.evidences && entry.evidences.length > 0) {
                        data[`evidence_${pKey}`] = JSON.stringify(entry.evidences.map((ev: any) => ev.token));
                    }
                    recordsToCreate.push(data);
                }
            });
        });

        // 2. Fallback for legacy submissions (if no breakdown entries were created but traffic object has values)
        if (recordsToCreate.length === 0) {
            platformKeys.forEach(pKey => {
                const val = parseInt(traffic[pKey as keyof typeof traffic] || '0');
                if (val > 0) {
                    const data: any = {
                        id: `local_legacy_${pKey}_${Date.now()}`,
                        email, name, date: now, employee: name, team, month: monthString,
                        total_traffic: BigInt(val),
                        is_confirmed: 'Pending',
                    };
                    data[`traffic_${pKey}`] = BigInt(val);
                    data[`channel_${pKey}`] = (channels as any)?.[pKey] || null;
                    const evidence = (platformEvidences as any)?.[pKey];
                    if (evidence && Array.isArray(evidence) && evidence.length > 0) {
                        data[`evidence_${pKey}`] = JSON.stringify(evidence);
                    }
                    recordsToCreate.push(data);
                }
            });
        }

        try {
            // Batch insert all rows in a single round-trip
            if (recordsToCreate.length > 0) {
                await this.prisma.larkTraffic.createMany({
                    data: recordsToCreate,
                    skipDuplicates: true,
                });
            }

            return {
                message: `Traffic report submitted successfully. Created ${recordsToCreate.length} records.`,
                recordIds: recordsToCreate.map(r => r.id)
            };
        } catch (dbError) {
            this.logger.error('Error saving multi-row traffic report:', dbError);
            throw new Error(`Could not save traffic report: ${dbError.message}`);
        }
    }

    async submitChecklistReport(payload: any) {
        console.log('--- submitChecklistReport RAW PAYLOAD ---');
        console.log(JSON.stringify(payload, null, 2));

        const metadataKeys = ['email', 'name', 'team', 'answers', 'reportDate', 'userEmail', 'userName', 'userTeam', 'userRoles', 'isLate'];
        const finalAnswers: Record<string, any> = {};

        // Collect everything not in metadataKeys into finalAnswers
        Object.keys(payload || {}).forEach(key => {
            if (!metadataKeys.includes(key)) {
                finalAnswers[key] = payload[key];
            }
        });

        // If there was an explicit answers object, merge it in
        if (payload.answers && typeof payload.answers === 'object') {
            Object.assign(finalAnswers, payload.answers);
        }

        console.log('Final Answers collected:', JSON.stringify(finalAnswers, null, 2));

        const { email, name, team, reportDate, userEmail, userName, userTeam } = payload;

        const normalizedEmail = (email || userEmail || '').trim().toLowerCase();
        const dateObj = reportDate ? new Date(reportDate) : new Date();

        // Check for existing user to get fallback values
        const userRec = await this.prisma.user.findFirst({
            where: { email: { equals: normalizedEmail, mode: 'insensitive' as any } }
        });

        // Consolidate final values
        const finalName = String(name || userName || userRec?.full_name || 'Unknown');
        const finalTeam = String(team || userTeam || userRec?.team || '');

        console.log('>>> SUBMIT CHECKLIST DEBUG <<<');
        console.log('Payload:', JSON.stringify(payload));
        console.log('finalName:', finalName);
        console.log('finalTeam:', finalTeam);

        this.logger.debug(`[submitChecklistReport] Payload: ${JSON.stringify({ email, name, team, userEmail, userName, userTeam })}`);
        this.logger.debug(`[submitChecklistReport] finalName: "${finalName}", finalTeam: "${finalTeam}"`);

        // Use precise Vietnam timezone bounds for the report day
        const getVietnamBounds = (dateInput?: string | Date) => {
            let y = 0, m = 0, d = 0;
            if (typeof dateInput === 'string' && dateInput.length === 10) {
                const parts = dateInput.split('-');
                y = parseInt(parts[0], 10);
                m = parseInt(parts[1], 10) - 1;
                d = parseInt(parts[2], 10);
            } else {
                const dObj = typeof dateInput === 'string' ? new Date(dateInput) : (dateInput || new Date());
                // Use Intl-based date key splitting to get VN parts accurately
                const vnKey = this.toVietnamDateKey(dObj);
                const parts = vnKey.split('-');
                y = parseInt(parts[0], 10);
                m = parseInt(parts[1], 10) - 1;
                d = parseInt(parts[2], 10);
            }
            return {
                start: new Date(Date.UTC(y, m, d - 1, 17, 0, 0, 0)),
                end: new Date(Date.UTC(y, m, d, 16, 59, 59, 999))
            };
        };

        const bounds = getVietnamBounds(reportDate || dateObj);

        // Check for Admin/Manager to bypass constraints
        const roles = userRec?.roles || [];
        const isAdmin = roles.includes('ADMIN') || roles.includes('MANAGER');

        // Block future dates
        if (!isAdmin) {
            const todayVN = this.toVietnamDateKey(new Date());
            if (reportDate && reportDate > todayVN) {
                throw new Error('Không thể gửi báo cáo cho ngày trong tương lai.');
            }
        }

        // Logic chống spam/duplicate: nếu hôm nay đã báo cáo rồi thì update hoặc bỏ qua
        const existing = await this.prisma.larkReport.findFirst({
            where: {
                date: { gte: bounds.start, lte: bounds.end },
                team: finalTeam ? { equals: finalTeam, mode: 'insensitive' as any } : undefined,
                OR: [
                    { email: { equals: normalizedEmail, mode: 'insensitive' as any } },
                    { name: { equals: finalName, mode: 'insensitive' as any } }
                ]
            },
            orderBy: { created_at: 'desc' }
        });

        const reportId = existing?.id || `local_chk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        const data = {
            id: reportId,
            name: finalName,
            email: normalizedEmail,
            team: finalTeam,
            answers: finalAnswers || {},
            date: dateObj,
            updated_at: new Date(),
        };

        await this.prisma.larkReport.upsert({
            where: { id: reportId },
            create: { ...data, created_at: new Date() },
            update: data
        });

        this.invalidateActivityCache();

        return {
            success: true,
            message: existing ? 'Cập nhật báo cáo thành công' : 'Gửi báo cáo thành công',
            id: reportId
        };
    }

    async syncOutstandingData() {
        this.logger.log('[LarkSync] syncOutstandingData disabled - this table is now independent.');
        return;
    }

    async fetchLarkRecords() {
        const token = await this.getAccessToken();
        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${this.REPORT_BASE_ID}/tables/${this.REPORT_TABLE_ID}/records`;

        let allRecords = [];
        let pageToken = '';
        let hasMore = true;

        try {
            while (hasMore) {
                const response = await firstValueFrom(
                    this.httpService.get(url, {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                        params: {
                            text_field_as_key: true,
                            page_size: 100,
                            page_token: pageToken || undefined
                        },
                    }),
                );

                if (response.data.code !== 0) {
                    throw new Error(`Lark API Error: ${response.data.msg}`);
                }

                const data = response.data.data;
                if (data.items) {
                    allRecords = allRecords.concat(data.items);
                }

                hasMore = data.has_more;
                pageToken = data.page_token;
            }

            return allRecords;
        } catch (error) {
            this.logger.error('Failed to fetch records from Lark', error);
            throw error;
        }
    }

    // Helper to get all reports from DB (for controller)
    async getReportData() {
        return this.prisma.larkReport.findMany({
            orderBy: { created_at: 'desc' },
            take: 1000,
            select: { id: true, name: true, team: true, date: true, email: true, role: true, answers: true, created_at: true, updated_at: true },
        });
    }

    async getPermissionData() {
        // Updated to use "users" table instead of "lark_permissions"
        const users = await this.prisma.user.findMany({
            orderBy: { created_at: 'desc' },
            select: { id: true, email: true, full_name: true, team: true, roles: true, employee_status: true, employee_id: true, image_url: true, created_at: true, updated_at: true },
            take: 3000,
        });

        return users.map(u => ({
            id: u.id,
            email: u.email,
            name: u.full_name,
            team: u.team,
            role: (u.roles || []).includes('LEADER') ? 'Leader' : (u.roles || []).includes('MANAGER') ? 'Manager' : (u.roles || []).includes('ADMIN') ? 'Admin' : 'Member',
            status: u.employee_status,
            employee: u.employee_id ? JSON.stringify([{ id: u.employee_id, name: u.full_name, avatar_url: u.image_url }]) : null,
            created_at: u.created_at,
            updated_at: u.updated_at
        }));
    }

    async getPermissionByEmail(email: string) {
        if (!email) return null;
        const u = await this.prisma.user.findFirst({
            where: { email: { equals: email.trim(), mode: 'insensitive' } }
        });

        if (!u) return null;

        return {
            id: u.id,
            email: u.email,
            name: u.full_name,
            team: u.team,
            role: (u.roles || []).includes('LEADER') ? 'Leader' : (u.roles || []).includes('MANAGER') ? 'Manager' : (u.roles || []).includes('ADMIN') ? 'Admin' : 'Member',
            status: u.employee_status,
            employee: u.employee_id ? JSON.stringify([{ id: u.employee_id, name: u.full_name, avatar_url: u.image_url }]) : null,
            created_at: u.created_at,
            updated_at: u.updated_at
        };
    }

    // Clear all larkReport data
    async clearAllReports() {
        this.logger.log('Clearing all larkReport data...');
        const result = await this.prisma.larkReport.deleteMany({});
        this.logger.log(`Deleted ${result.count} records from larkReport`);
        return result;
    }

    async listTables() {
        const token = await this.getAccessToken();
        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${this.KPI_BASE_ID}/tables`;

        try {
            const response = await firstValueFrom(
                this.httpService.get(url, {
                    headers: { Authorization: `Bearer ${token}` }
                })
            );
            return response.data;
        } catch (error) {
            this.logger.error('Failed to list tables', error);
            throw error;
        }
    }

    async syncChannelData() {
        try {
            const baseId = this.configService.get<string>('LARK_CHANNEL_BASE_ID')
                || 'JAEmwmWQkixHOOkumU5lRU7ogkb';
            const tableId = this.configService.get<string>('LARK_CHANNEL_TABLE_ID')
                || 'tblWxMtDAkvh1gWS';

            this.logger.log(`Syncing Channel table: ${tableId} from base: ${baseId}`);
            const records = await this.fetchLarkRecordsGeneric(baseId, tableId);
            this.logger.log(`Fetched ${records.length} records from Channel table. Overwriting Channel model...`);

            const extractString = (val: any): string | null => {
                if (val === null || val === undefined) return null;
                if (typeof val === 'string') return val;
                if (typeof val === 'number' || typeof val === 'boolean') return String(val);
                if (Array.isArray(val)) {
                    if (val.length === 0) return null;
                    const first = val[0];
                    if (typeof first === 'string') return first;
                    if (typeof first === 'object' && first !== null) {
                        return first.text || first.name || first.value || first.en_name || JSON.stringify(first);
                    }
                    return String(first);
                }
                if (typeof val === 'object') {
                    return val.text || val.value || val.name || val.link || null;
                }
                return String(val);
            };

            const extractUrl = (val: any): string | null => {
                if (!val) return null;
                if (typeof val === 'string') return val;
                if (Array.isArray(val) && val.length > 0) {
                    const first = val[0];
                    return first.link || first.url || first.text || (typeof first === 'string' ? first : null);
                }
                if (typeof val === 'object') return val.link || val.url || val.text || null;
                return String(val);
            };

            const extractEmail = (val: any): string | null => {
                if (!val) return null;
                if (Array.isArray(val) && val.length > 0) {
                    return val[0].email || null;
                }
                if (typeof val === 'object') return val.email || null;
                return null;
            };

            const EXCLUDED_TEAMS = ['global - jp2', 'global - jp3'];

            const channelsToInsert: any[] = [];
            let skippedTeam = 0;
            
            for (const record of records) {
                const f = record.fields;

                const teamTraffic = extractString(f['Team Traffic'])
                    || extractString(f['Team traffic'])
                    || '';

                if (EXCLUDED_TEAMS.includes(teamTraffic.toLowerCase().trim())) {
                    skippedTeam++;
                    continue;
                }

                const name = extractString(f['Tên kênh hiện tại'])
                    || extractString(f['Tên kênh A?'])
                    || extractString(f['name'])
                    || 'N/A';

                const owner = extractString(f['Nhân viên traffic xây kênh'])
                    || extractString(f['NV traffic xây kênh'])
                    || extractString(f['owner A?'])
                    || '';

                const data = {
                    id: record.record_id,
                    name,
                    platform: extractString(f['Nền tảng'])
                        || extractString(f['Nền tảng A?'])
                        || '',
                    channel_id: extractString(f['ID kênh hiện tại'])
                        || extractString(f['channel_id A?'])
                        || extractString(f['channel_id'])
                        || '',
                    link_channel: extractUrl(f['Link kênh'])
                        || extractUrl(f['link_channel A?'])
                        || extractUrl(f['link_channel'])
                        || '',
                    status: extractString(
                        f['Trạng thái hoạt động']
                        ?? f['Trạng thái A?']
                        ?? f['Trạng thái']
                        ?? f['Trạng Thái']
                        ?? f['status'],
                    ) || 'Đang hoạt động',
                    team_traffic: teamTraffic,
                    owner,
                    email: extractEmail(f['Nhân viên traffic xây kênh'])
                        || extractEmail(f['NV traffic xây kênh'])
                        || null,
                };

                channelsToInsert.push(data);
            }

            let synced = 0;
            if (channelsToInsert.length > 0) {
                this.logger.log(`Syncing ${channelsToInsert.length} fresh records to Channel atomically...`);
                
                // Use atomic transaction: drop old non-doda records and batch insert fresh ones 
                // to prevent connection overload and avoid parallel execution race conditions.
                await this.prisma.$transaction([
                    this.prisma.channel.deleteMany({
                        where: { NOT: { id: { startsWith: 'doda_' } } },
                    }),
                    this.prisma.channel.createMany({
                        data: channelsToInsert,
                        skipDuplicates: true,
                    }),
                ]);
                synced = channelsToInsert.length;
            } else {
                this.logger.log('No channel records to sync.');
            }

            this.logger.log(`Successfully synced ${synced}/${records.length} records to Channel (skipped ${skippedTeam} from excluded teams).`);

            // Cross-reference: gắn email chính xác từ bảng Users dựa theo owner name
            try {
                const enriched = await this.enrichChannelEmailsFromUsers();
                this.logger.log(`[Channel] Email enrichment: updated ${enriched} channels from Users table.`);
            } catch (enrichErr: any) {
                this.logger.warn(`[Channel] Email enrichment failed: ${enrichErr?.message}`);
            }

            try {
                const imp = await this.importTrackedChannelsFromChannelTable();
                this.logger.log(
                    `[Lark] tracked_channels import: imported=${imp.imported} no_user=${imp.skipped_no_user} no_parse=${imp.skipped_no_identity} skip_inactive=${imp.skipped_inactive} deactivated=${imp.deactivated_inactive_lark}`,
                );
            } catch (ie: any) {
                this.logger.warn(`[Lark] import tracked after channel sync: ${ie?.message}`);
            }

            // Mirror sau enrich/import — giống KPI: snapshot local khớp server (email Users đã gán).
            try {
                const localRows = await this.prisma.channel.findMany({
                    where: { NOT: { id: { startsWith: 'doda_' } } },
                });
                const mirroredRemote = await this.mirrorChannelSnapshotToServer(localRows as any);
                if (mirroredRemote) this.logger.log(`[Channel] Remote mirror success: ${mirroredRemote} row(s).`);
            } catch (mirrorErr: any) {
                this.logger.error('[Channel] Mirror to remote DB failed — local channel is already updated', mirrorErr);
            }
        } catch (error) {
            this.logger.error('Failed to sync Channel data', error);
            throw error;
        }
    }

    /**
     * Cross-reference Channel.owner với Users.full_name để gắn email chính xác.
     * Returns số channels đã được update email.
     */
    async enrichChannelEmailsFromUsers(): Promise<number> {
        const users = await this.prisma.user.findMany({
            where: { is_active: true },
            select: { email: true, full_name: true },
        });

        // Build map: normalized full_name → email
        const nameToEmail = new Map<string, string>();
        for (const u of users) {
            if (u.full_name && u.email) {
                nameToEmail.set(this.normalizeOwnerName(u.full_name), u.email);
            }
        }
        // Debug: log first 10 entries in map
        const mapSample = Array.from(nameToEmail.entries()).slice(0, 10);
        this.logger.debug(`[enrich] nameToEmail sample: ${JSON.stringify(mapSample)}`);

        const channels = await this.prisma.channel.findMany({
            select: { id: true, owner: true, email: true },
        });

        let updated = 0;
        let unmatched = 0;
        for (const ch of channels) {
            if (!ch.owner) continue;
            // NOTE: Do NOT skip channels that already have an email.
            // The email extracted during Lark sync may be a Lark SSO email that does not match
            // the system login email in the Users table.  Always overwrite with the system email.

            const normalizedOwner = this.normalizeOwnerName(ch.owner);
            let matchedEmail = nameToEmail.get(normalizedOwner);

            // Fallback: try partial match (owner contains user name or vice versa)
            if (!matchedEmail) {
                for (const [normalizedName, email] of nameToEmail) {
                    if (normalizedOwner.includes(normalizedName) || normalizedName.includes(normalizedOwner)) {
                        matchedEmail = email;
                        break;
                    }
                }
            }

            if (matchedEmail) {
                await this.prisma.channel.update({
                    where: { id: ch.id },
                    data: { email: matchedEmail },
                });
                updated++;
            } else {
                unmatched++;
                this.logger.debug(`[enrich] No email match for owner="${ch.owner}" (normalized="${normalizedOwner}")`);
            }
        }

        this.logger.log(`[enrich] Updated ${updated}, unmatched ${unmatched} (total channels: ${channels.length})`);
        return updated;
    }

    /**
     * Sync kênh team Đồ Da từ Lark Bitable riêng vào Channel table.
     * Tất cả records được gán team_traffic = "Đồ Da", id prefix "doda_".
     */
    async syncDoDaChannelData() {
        const DODA_BASE_ID = 'Livew1AE0i2vo5kF3YXlCPNWg8f';
        const DODA_TABLE_ID = 'tblgOat8ymmJ6oi9';
        const TEAM_NAME = 'Đồ Da';

        try {
            this.logger.log(`[DoDa] Syncing channels from base: ${DODA_BASE_ID}, table: ${DODA_TABLE_ID}`);
            const records = await this.fetchLarkRecordsGeneric(DODA_BASE_ID, DODA_TABLE_ID);
            this.logger.log(`[DoDa] Fetched ${records.length} records.`);

            // Clear old Do Da channels
            const deleted = await this.prisma.channel.deleteMany({
                where: { id: { startsWith: 'doda_' } },
            });
            this.logger.log(`[DoDa] Cleared ${deleted.count} old Do Da channels.`);

            const extractString = (val: any): string | null => {
                if (val === null || val === undefined) return null;
                if (typeof val === 'string') return val;
                if (typeof val === 'number' || typeof val === 'boolean') return String(val);
                if (Array.isArray(val)) {
                    if (val.length === 0) return null;
                    const first = val[0];
                    if (typeof first === 'string') return first;
                    if (typeof first === 'object' && first !== null) {
                        return first.text || first.name || first.value || first.en_name || null;
                    }
                    return String(first);
                }
                if (typeof val === 'object') {
                    return val.text || val.value || val.name || val.link || null;
                }
                return String(val);
            };

            const extractUrl = (val: any): string | null => {
                if (!val) return null;
                if (typeof val === 'string') return val;
                if (Array.isArray(val) && val.length > 0) {
                    const first = val[0];
                    return first.link || first.url || first.text || (typeof first === 'string' ? first : null);
                }
                if (typeof val === 'object') return val.link || val.url || val.text || null;
                return String(val);
            };

            const normalizePlatform = (raw: string | null): string => {
                if (!raw) return '';
                const lower = raw.toLowerCase().trim();
                if (lower === 'ig' || lower === 'instagram') return 'Instagram';
                if (lower === 'tiktok') return 'TikTok';
                if (lower === 'facebook' || lower === 'fb') return 'Facebook';
                if (lower === 'douyin') return 'Douyin';
                if (lower === 'xiaohongshu' || lower === 'xhs') return 'Xiaohongshu';
                if (lower === 'youtube' || lower === 'yt') return 'YouTube';
                return raw.trim();
            };

            let synced = 0;
            for (const record of records) {
                const f = record.fields;

                const name = extractString(f['Tên Kênh'])
                    || extractString(f['Tên kênh'])
                    || 'N/A';

                const owner = extractString(f['Họ Và Tên'])
                    || extractString(f['Họ và Tên'])
                    || extractString(f['HoTen'])
                    || '';

                const larkAccount = f['Tài khoản Lark'] || f['Tài khoản lark'];
                let email: string | null = null;
                if (Array.isArray(larkAccount) && larkAccount.length > 0) {
                    email = larkAccount[0].email || null;
                }

                const platformRaw = extractString(f['Nền Tảng'])
                    || extractString(f['Nền tảng'])
                    || '';

                const data = {
                    id: `doda_${record.record_id}`,
                    name,
                    platform: normalizePlatform(platformRaw),
                    channel_id: '',
                    link_channel: extractUrl(f['Link kênh'])
                        || extractUrl(f['Link Kênh'])
                        || '',
                    status: extractString(f['Trạng Thái HD'])
                        || extractString(f['Trạng thái HD'])
                        || 'ON',
                    team_traffic: TEAM_NAME,
                    owner,
                    email,
                };

                try {
                    await this.prisma.channel.create({ data });
                    synced++;
                } catch (e: any) {
                    this.logger.warn(`[DoDa] Skip record ${record.record_id}: ${e?.message}`);
                }
            }

            this.logger.log(`[DoDa] Synced ${synced}/${records.length} channels.`);

            // Cross-reference email từ Users table
            try {
                const enriched = await this.enrichChannelEmailsFromUsers();
                this.logger.log(`[DoDa] Email enrichment: updated ${enriched} channels.`);
            } catch (err: any) {
                this.logger.warn(`[DoDa] Email enrichment failed: ${err?.message}`);
            }

            // Import vào tracked_channels
            try {
                const imp = await this.importTrackedChannelsFromChannelTable();
                this.logger.log(`[DoDa] tracked_channels import: imported=${imp.imported}`);
            } catch (ie: any) {
                this.logger.warn(`[DoDa] import tracked failed: ${ie?.message}`);
            }

            try {
                const dodaRows = await this.prisma.channel.findMany({ where: { id: { startsWith: 'doda_' } } });
                const mirroredRemote = await this.mirrorDoDaChannelSnapshotToServer(dodaRows as any);
                if (mirroredRemote) this.logger.log(`[Channel DoDa] Remote mirror success: ${mirroredRemote} row(s).`);
            } catch (mirrorErr: any) {
                this.logger.error('[Channel DoDa] Mirror to remote DB failed — local channel is already updated', mirrorErr);
            }

            return { synced, total: records.length };
        } catch (error) {
            this.logger.error('[DoDa] Failed to sync Do Da channel data', error);
            throw error;
        }
    }

    /** Chuẩn hóa tên để so khớp owner Channel ↔ full_name User / Họ tên bảng Permission */
    private normalizeOwnerName(s: string | null | undefined): string {
        return (s || '')
            .normalize('NFC')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ');
    }

    /**
     * Đọc huyk_channels (đã sync từ Lark) → tạo/cập nhật tracked_channels theo email hoặc owner khớp user.
     */
    async importTrackedChannelsFromChannelTable(opts?: {
        onlyUserId?: string;
        prioritizePlatform?: string;
    }): Promise<{
        imported: number;
        skipped_no_user: number;
        skipped_no_identity: number;
        skipped_inactive: number;
        deactivated_inactive_lark: number;
        errors: string[];
    }> {
        const stats = {
            imported: 0,
            skipped_no_user: 0,
            skipped_no_identity: 0,
            skipped_inactive: 0,
            deactivated_inactive_lark: 0,
            errors: [] as string[],
        };

        let me: { email: string; full_name: string } | null = null;
        if (opts?.onlyUserId) {
            const u = await this.prisma.user.findUnique({ where: { id: opts.onlyUserId } });
            if (!u?.email) {
                stats.errors.push('User không tồn tại hoặc không có email');
                return stats;
            }
            me = { email: u.email.toLowerCase(), full_name: (u.full_name || '').trim() };
        }

        let myPermissionDisplayNames = new Set<string>();
        if (me) {
            const fnN = this.normalizeOwnerName(me.full_name);
            if (fnN) myPermissionDisplayNames.add(fnN);
        }

        // Lấy tất cả rows có status không rỗng, rồi validate active bằng isLarkChannelActiveStatus
        // (hỗ trợ cả "Đang hoạt động", "ON", "active", v.v. — bao gồm kênh Đồ Da)
        const baseWhere = {
            AND: [
                { status: { not: null } },
                { NOT: { status: '' } },
            ],
        };
        let rows = await this.prisma.channel.findMany({ where: baseWhere });
        const beforeActive = rows.length;
        rows = rows.filter((row) => isLarkChannelActiveStatus(row.status));
        stats.skipped_inactive = beforeActive - rows.length;
        if (me) {
            rows = rows.filter((row) => {
                const r = row as typeof row & { email?: string | null };
                const em = r.email?.trim().toLowerCase();
                if (em && em === me!.email) return true;
                const ownerN = this.normalizeOwnerName(r.owner);
                if (!em && ownerN) {
                    for (const alias of myPermissionDisplayNames) {
                        if (alias && ownerN === alias) return true;
                    }
                }
                return false;
            });
        }

        // Pre-load all active users into maps — eliminates N×2-3 DB queries in the loop
        const allActiveUsers = await this.prisma.user.findMany({
            where: { is_active: true },
            select: { id: true, email: true, full_name: true },
        });
        const userByEmail = new Map<string, typeof allActiveUsers[0]>();
        const userByNormName = new Map<string, typeof allActiveUsers[0]>();
        const ownerNormToEmails = new Map<string, string[]>();
        for (const u of allActiveUsers) {
            if (u.email) {
                userByEmail.set(u.email.trim().toLowerCase(), u);
                // also build ownerNormToEmails for fuzzy-name fallback
                const key = this.normalizeOwnerName(u.full_name);
                const em = u.email.trim();
                if (key && em) {
                    if (!ownerNormToEmails.has(key)) ownerNormToEmails.set(key, []);
                    ownerNormToEmails.get(key)!.push(em);
                }
            }
            const normName = this.normalizeOwnerName(u.full_name);
            if (normName && !userByNormName.has(normName)) userByNormName.set(normName, u);
        }

        // Pre-load all existing tracked channels keyed by lark_channel_id
        const larkChannelIds = rows.map(r => r.id).filter(Boolean);
        const existingTcList = larkChannelIds.length
            ? await this.prisma.trackedChannel.findMany({
                where: { lark_channel_id: { in: larkChannelIds } },
                select: { user_id: true, platform: true, username: true, lark_channel_id: true, total_followers: true, total_likes: true, total_videos: true, last_synced_at: true },
            })
            : [];
        const tcByLarkId = new Map<string, typeof existingTcList[0]>();
        for (const tc of existingTcList) {
            if (tc.lark_channel_id) tcByLarkId.set(tc.lark_channel_id, tc);
        }

        const enrichKeys = new Set<string>();
        const enrichQueue: { userId: string; platform: import('@prisma/client').Platform; username: string }[] = [];

        for (const row of rows) {
            try {
                const r = row as typeof row & { email?: string | null };
                const identity = resolveTrackedUsername(row);
                if (!identity) {
                    stats.skipped_no_identity++;
                    continue;
                }

                // Fast map lookup instead of per-row DB queries
                let user: typeof allActiveUsers[0] | null = null;
                if (r.email?.trim()) {
                    user = userByEmail.get(r.email.trim().toLowerCase()) ?? null;
                }
                if (!user && r.owner?.trim()) {
                    user = userByNormName.get(this.normalizeOwnerName(r.owner)) ?? null;
                }
                if (!user && r.owner?.trim()) {
                    const emails = ownerNormToEmails.get(this.normalizeOwnerName(r.owner));
                    if (emails?.length) {
                        for (const em of emails) {
                            user = userByEmail.get(em.toLowerCase()) ?? null;
                            if (user) break;
                        }
                    }
                }
                if (!user) {
                    stats.skipped_no_user++;
                    continue;
                }

                // Fast map lookup instead of per-row DB query
                const existingTc = tcByLarkId.get(row.id) ?? null;

                // Chỉ cần enrich khi:
                // 1. Kênh hoàn toàn mới (chưa tồn tại trong DB)
                // 2. Chưa bao giờ được sync (last_synced_at = null) VÀ chưa có số liệu gì
                // KHÔNG enrich nếu kênh đã từng sync (dù bị block → followers=0),
                // tránh gọi Apify lại mỗi lần user login/reload
                const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 giờ
                const isNeverSynced = !existingTc || existingTc.last_synced_at == null;
                const hasNoData = !existingTc ||
                    ((existingTc.total_followers == null || existingTc.total_followers === 0) &&
                        Number(existingTc.total_likes) === 0 &&
                        (existingTc.total_videos == null || existingTc.total_videos === 0));
                const isStaleWithNoData = hasNoData &&
                    existingTc?.last_synced_at != null &&
                    (Date.now() - new Date(existingTc.last_synced_at).getTime()) > STALE_THRESHOLD_MS;

                const needsApifyEnrich = isNeverSynced ? hasNoData : isStaleWithNoData;

                await this.prisma.$transaction(async (tx) => {
                    // CỰC KỲ QUAN TRỌNG: KHÔNG ĐƯỢC DETELE NẾU USERNAME KHÔNG ĐỔI
                    // Chỉ xóa các bản ghi cũ của lark_channel_id này nếu username/platform bị đổi
                    await (tx.trackedChannel as any).deleteMany({
                        where: {
                            lark_channel_id: row.id,
                            NOT: {
                                AND: [
                                    { platform: identity.platform },
                                    { username: identity.username }
                                ]
                            }
                        }
                    });

                    await tx.trackedChannel.upsert({
                        where: {
                            user_id_platform_username: {
                                user_id: user!.id,
                                platform: identity.platform,
                                username: identity.username,
                            },
                        },
                        create: {
                            user_id: user!.id,
                            platform: identity.platform,
                            username: identity.username,
                            display_name: row.name || null,
                            lark_channel_id: row.id,
                            added_via: 'lark',
                            is_active: true,
                            total_likes: BigInt(0),
                            total_views: BigInt(0),
                            total_videos: 0,
                            engagement_rate: 0,
                            initial_video_count: 0,
                            // Kế thừa data từ existingTc nếu channel bị đổi ID Lark nhưng vẫn giữ username (để không mất số)
                            total_followers: existingTc?.total_followers || null,
                            last_synced_at: existingTc?.last_synced_at || null,
                        } as any,
                        update: {
                            lark_channel_id: row.id,
                            added_via: 'lark',
                            display_name: row.name || undefined,
                            is_active: true,
                        } as any,
                    });
                });
                stats.imported++;
                if (needsApifyEnrich) {
                    const ek = `${user!.id}|${identity.platform}|${identity.username}`;
                    if (!enrichKeys.has(ek)) {
                        enrichKeys.add(ek);
                        enrichQueue.push({
                            userId: user!.id,
                            platform: identity.platform,
                            username: identity.username,
                        });
                    }
                }
            } catch (e: any) {
                stats.errors.push(`${row.id}: ${e?.message || e}`);
            }
        }

        if (enrichQueue.length > 0) {
            if (!this.shouldRunBackgroundChannelEnrich()) {
                this.logger.log(
                    `[Lark] Background channel enrich is disabled (LARK_ENABLE_BACKGROUND_CHANNEL_ENRICH=false). Skipped ${enrichQueue.length} queue item(s).`,
                );
            } else {
                const pri = (opts?.prioritizePlatform || '').toUpperCase().trim();
                const validPri = ['FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'DOUYIN', 'XIAOHONGSHU', 'YOUTUBE'].includes(pri)
                    ? pri
                    : null;
                if (validPri) {
                    enrichQueue.sort((a, b) => {
                        const af = a.platform === validPri ? 0 : 1;
                        const bf = b.platform === validPri ? 0 : 1;
                        return af - bf;
                    });
                    this.logger.log(`[Lark] Ưu tiên Apify nền tảng: ${validPri}`);
                }
                this.logger.log(
                    `[Lark] Đã đẩy ${enrichQueue.length} kênh vào hàng đợi làm giàu số liệu (chạy ngầm).`,
                );
                // FIRE AND FORGET - KHÔNG AWAIT ĐỂ KHÔNG CHẶN API
                this.channelStatsEnrichment.enrichBatch(enrichQueue, {
                    concurrency: this.getBackgroundChannelEnrichConcurrency(),
                }).then(({ ok, failed }) => {
                    this.logger.log(`[Lark] Làm giàu số liệu xong: thành công=${ok}, lỗi/bỏ qua=${failed}`);
                }).catch(e => {
                    this.logger.warn(`[Lark] Làm giàu số liệu hàng loạt lỗi (background): ${e?.message || e}`);
                });
            }
        }

        const allCh = await this.prisma.channel.findMany({ select: { id: true, status: true }, take: 5000 });
        const inactiveLarkIds = allCh.filter((ch) => !isLarkChannelActiveStatus(ch.status)).map((ch) => ch.id);
        if (inactiveLarkIds.length > 0) {
            try {
                // Dùng raw SQL: client Prisma cũ có thể chưa có field lark_channel_id sau generate
                const n = await this.prisma.$executeRaw`
                    UPDATE "tracked_channels"
                    SET "is_active" = false, "updated_at" = NOW()
                    WHERE "lark_channel_id" IN (${Prisma.join(inactiveLarkIds)})
                      AND "added_via" = 'lark'
                      AND "is_active" = true
                `;
                stats.deactivated_inactive_lark = Number(n);
            } catch (e: any) {
                this.logger.warn(
                    `[Lark] deactivate inactive lark tracked_channels skipped: ${e?.message || e}. Chạy migration + npx prisma generate nếu cột lark_channel_id chưa có.`,
                );
            }
        }

        return stats;
    }

    async importTrackedChannelsForUser(userId: string, prioritizePlatform?: string) {
        return this.importTrackedChannelsFromChannelTable({ onlyUserId: userId, prioritizePlatform });
    }

    async getChannelData(owner?: string, team?: string, email?: string) {
        // Base conditions – only channels that have a non-empty status
        const andConditions: any[] = [
            { status: { not: null } },
            { NOT: { status: '' } },
        ];

        // Resolve owner name: use the caller-supplied `owner` param first (frontend now sends it),
        // then fall back to a DB lookup via email.  This dual-match lets the backend find channels
        // by EITHER channel.email or channel.owner regardless of which field was populated.
        let resolvedOwnerName: string | undefined = owner;
        if (email && !resolvedOwnerName) {
            const sysUser = await this.prisma.user.findFirst({
                where: { email: { equals: email, mode: 'insensitive' } },
                select: { full_name: true },
            });
            resolvedOwnerName = sysUser?.full_name ?? undefined;
        }

        // Build OR conditions for owner identity
        const ownerOrConds: any[] = [];
        if (email) {
            ownerOrConds.push({ email: { equals: email, mode: 'insensitive' } });
        }
        if (resolvedOwnerName) {
            // Exact case-insensitive match on owner name to avoid false positives
            ownerOrConds.push({ owner: { equals: resolvedOwnerName, mode: 'insensitive' } });
        }
        if (ownerOrConds.length > 0) {
            andConditions.push({ OR: ownerOrConds });
        }

        // Optional team filter – additive AND with the owner/email conditions
        if (team) {
            andConditions.push({ team_traffic: { contains: team, mode: 'insensitive' } });
        }

        const list = await this.prisma.channel.findMany({
            where: { AND: andConditions },
            orderBy: { name: 'asc' },
        });
        return list.filter((ch) => isLarkChannelActiveStatus(ch.status));
    }

    async clearChannels() {
        return this.prisma.channel.deleteMany({});
    }

    async fetchLarkRecordsGeneric(baseId: string, tableId: string, pageSize = 500) {
        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/records`;

        let allRecords = [];
        let pageToken = '';
        let hasMore = true;
        const MAX_RETRIES = 3;

        try {
            while (hasMore) {
                // Luôn lấy token mới trước mỗi request để tránh token hết hạn giữa chừng
                const token = await this.getAccessToken();
                this.logger.debug(`Fetching: ${url} (Token: ${token.substring(0, 10)}...)`);

                let response: any;
                let retries = 0;
                while (retries < MAX_RETRIES) {
                    try {
                        response = await firstValueFrom(
                            this.httpService.get(url, {
                                headers: { Authorization: `Bearer ${token}` },
                                params: {
                                    text_field_as_key: true,
                                    page_size: Math.max(50, Math.min(pageSize, 500)),
                                    // Chỉ gửi page_token khi có giá trị — tránh gửi empty string gây lỗi
                                    ...(pageToken ? { page_token: pageToken } : {}),
                                },
                            }),
                        );
                        break; // Thành công → thoát retry loop
                    } catch (reqErr: any) {
                        const statusCode = reqErr?.response?.status;
                        retries++;
                        if (statusCode === 400 && retries < MAX_RETRIES) {
                            // page_token có thể đã hết hạn (Lark TTL ngắn với bảng lớn)
                            // Reset → fetch lại từ đầu để tránh mất dữ liệu
                            this.logger.warn(
                                `[LarkFetch] 400 Bad Request khi fetch table ${tableId} (page_token hết hạn?). Retry ${retries}/${MAX_RETRIES} — reset từ trang đầu...`
                            );
                            allRecords = [];
                            pageToken = '';
                            await new Promise(r => setTimeout(r, 1000 * retries));
                        } else {
                            throw reqErr;
                        }
                    }
                }

                if (response.data.code !== 0) {
                    throw new Error(`Lark API Error: ${response.data.msg}`);
                }

                const data = response.data.data;
                if (data.items) {
                    allRecords = allRecords.concat(data.items);
                }

                hasMore = !!data.has_more;
                // Đảm bảo pageToken không bị undefined (trang cuối thường không trả page_token)
                pageToken = data.page_token || '';
            }

            return allRecords;
        } catch (error) {
            this.logger.error(`Failed to fetch records from table ${tableId}`, error);
            throw error;
        }
    }

    // Temporary method to inspect table structure
    async inspectTableStructure() {
        try {
            const records = await this.fetchLarkRecords();
            if (records.length > 0) {
                this.logger.log('=== INSPECTING NEW TABLE STRUCTURE ===');
                this.logger.log(`Total records: ${records.length}`);

                // Collect ALL unique field names across ALL records
                const allFieldNames = new Set<string>();
                records.forEach(record => {
                    Object.keys(record.fields).forEach(key => allFieldNames.add(key));
                });

                this.logger.log('All unique field names across all records:');
                this.logger.log(JSON.stringify(Array.from(allFieldNames), null, 2));

                // Find records with Answers and Date
                const recordsWithAnswers = records.filter(r => r.fields['Answers'] || r.fields['Date']);
                this.logger.log(`\nRecords with Answers or Date: ${recordsWithAnswers.length}`);

                if (recordsWithAnswers.length > 0) {
                    this.logger.log('\n=== RECORDS WITH ANSWERS/DATE (First 3) ===');
                    for (let i = 0; i < Math.min(3, recordsWithAnswers.length); i++) {
                        this.logger.log(`\nRecord ${i + 1}:`);
                        this.logger.log(JSON.stringify(recordsWithAnswers[i].fields, null, 2));
                    }
                }

                // Also show first 3 general records
                this.logger.log('\n=== FIRST 3 RECORDS (General) ===');
                for (let i = 0; i < Math.min(3, records.length); i++) {
                    this.logger.log(`\nRecord ${i + 1}:`);
                    this.logger.log(JSON.stringify(records[i].fields, null, 2));
                }

                return {
                    totalRecords: records.length,
                    allUniqueFields: Array.from(allFieldNames),
                    recordsWithAnswersOrDate: recordsWithAnswers.length,
                    sampleRecordsWithData: recordsWithAnswers.slice(0, 3).map(r => r.fields),
                    generalSample: records.slice(0, 3).map(r => r.fields)
                };
            }
            return { message: 'No records found' };
        } catch (error) {
            this.logger.error('Failed to inspect table', error);
            throw error;
        }
    }


    private mapRecordToReport(record: any, dbUsersMap: Map<string, any>) {
        const fields = record.fields;

        const extractString = (val: any): string | null => {
            if (!val) return null;
            if (typeof val === 'string') return val;
            if (Array.isArray(val) && val.length > 0) {
                const first = val[0];
                return first.name || first.text || (typeof first === 'string' ? first : null);
            }
            if (typeof val === 'object') return val.name || val.text || null;
            return String(val);
        };

        let name = extractString(fields['HoTen'] || fields['Họ tên'] || fields['Nhân viên']);
        const email = fields['Email'] || null;

        // Look up user from dbUsersMap
        let user = null;
        if (email) {
            user = dbUsersMap.get(String(email).toLowerCase().trim());
        }
        if (!user && name) {
            user = dbUsersMap.get(name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' '));
        }

        // Get role and team from user
        let role = fields['Role'] || null;
        let team = fields['Team'] || null;
        if (user) {
            team = user.team || team;
            if (user.roles && user.roles.length > 0) {
                if (user.roles.includes('LEADER')) role = 'Leader';
                else if (user.roles.includes('MANAGER')) role = 'Manager';
                else if (user.roles.includes('ADMIN')) role = 'Admin';
                else role = 'Member';
            }
        }

        let dateValue = null;
        if (fields['Date']) {
            const rawDate = fields['Date'];
            if (typeof rawDate === 'number') {
                dateValue = new Date(rawDate);
            } else if (typeof rawDate === 'string' && !isNaN(Number(rawDate))) {
                dateValue = new Date(Number(rawDate));
            } else {
                dateValue = new Date(rawDate);
            }
        }

        return {
            id: record.record_id,
            email: email,
            name: name || 'Unknown',
            employee: fields['Nhân viên'] || null,
            role: role,
            team: team,
            date: dateValue,
            answers: fields['Answers'] || null,
        };
    }

    // Inspect employee table (different BASE/TABLE)
    async inspectEmployeeTable() {
        try {
            const token = await this.getAccessToken();
            const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${this.KPI_BASE_ID}/tables/${this.EMPLOYEE_TABLE_ID}/records`;

            const response = await firstValueFrom(
                this.httpService.get(url, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                    params: {
                        text_field_as_key: true,
                        page_size: 10,
                    },
                }),
            );

            if (response.data.code !== 0) {
                throw new Error(`Lark API Error: ${response.data.msg}`);
            }

            const records = response.data.data.items || [];

            if (records.length > 0) {
                this.logger.log('=== EMPLOYEE TABLE STRUCTURE ===');
                this.logger.log(`Total sample records: ${records.length}`);

                const allFieldNames = new Set<string>();
                records.forEach(record => {
                    Object.keys(record.fields).forEach(key => allFieldNames.add(key));
                });

                this.logger.log('All field names:');
                this.logger.log(JSON.stringify(Array.from(allFieldNames), null, 2));

                this.logger.log('\n=== FIRST 3 RECORDS ===');
                for (let i = 0; i < Math.min(3, records.length); i++) {
                    this.logger.log(`\nRecord ${i + 1}:`);
                    this.logger.log(JSON.stringify(records[i].fields, null, 2));
                }

                return {
                    totalRecords: records.length,
                    allUniqueFields: Array.from(allFieldNames),
                    sampleRecords: records.slice(0, 3).map(r => r.fields)
                };
            }

            return { message: 'No records found in employee table' };
        } catch (error) {
            this.logger.error('Failed to inspect employee table', error);
            throw error;
        }
    }

    // Inspect KPI table
    async inspectKPITable() {
        try {
            const token = await this.getAccessToken();
            const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${this.KPI_BASE_ID}/tables/${this.KPI_TABLE_ID}/records`;

            const response = await firstValueFrom(
                this.httpService.get(url, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                    params: {
                        text_field_as_key: true,
                        page_size: 10,
                    },
                }),
            );

            if (response.data.code !== 0) {
                throw new Error(`Lark API Error: ${response.data.msg}`);
            }

            const records = response.data.data.items || [];

            if (records.length > 0) {
                this.logger.log('=== KPI TABLE STRUCTURE ===');
                this.logger.log(`Total sample records: ${records.length}`);

                const allFieldNames = new Set<string>();
                records.forEach(record => {
                    Object.keys(record.fields).forEach(key => allFieldNames.add(key));
                });

                this.logger.log('All field names:');
                this.logger.log(JSON.stringify(Array.from(allFieldNames), null, 2));

                this.logger.log('\n=== FIRST 3 RECORDS ===');
                for (let i = 0; i < Math.min(3, records.length); i++) {
                    this.logger.log(`\nRecord ${i + 1}:`);
                    this.logger.log(JSON.stringify(records[i].fields, null, 2));
                }

                return {
                    totalRecords: records.length,
                    allUniqueFields: Array.from(allFieldNames),
                    sampleRecords: records.slice(0, 3).map(r => r.fields)
                };
            }

            return { message: 'No records found in KPI table' };
        } catch (error) {
            this.logger.error('Failed to inspect KPI table', error);
            throw error;
        }
    }

    async inspectKPITableDoDa() {
        try {
            const token = await this.getAccessToken();
            const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${this.KPI_DODA_BASE_ID}/tables/${this.KPI_DODA_TABLE_ID}/records`;

            const response = await firstValueFrom(
                this.httpService.get(url, {
                    headers: { Authorization: `Bearer ${token}` },
                    params: { text_field_as_key: true, page_size: 10 },
                }),
            );

            if (response.data.code !== 0) {
                throw new Error(`Lark API Error: ${response.data.msg}`);
            }

            const records = response.data.data.items || [];

            if (records.length > 0) {
                const allFieldNames = new Set<string>();
                records.forEach((record) => {
                    Object.keys(record.fields).forEach((key) => allFieldNames.add(key));
                });
                return {
                    totalRecords: records.length,
                    allUniqueFields: Array.from(allFieldNames),
                    sampleRecords: records.slice(0, 3).map((r) => r.fields),
                };
            }

            return { message: 'No records found in KPI Đồ Da table' };
        } catch (error) {
            this.logger.error('Failed to inspect KPI Đồ Da table', error);
            throw error;
        }
    }

    // Fetch employee records from Lark
    async fetchEmployeeRecords() {
        const token = await this.getAccessToken();
        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${this.KPI_BASE_ID}/tables/${this.EMPLOYEE_TABLE_ID}/records`;

        let allRecords = [];
        let pageToken = '';
        let hasMore = true;

        try {
            while (hasMore) {
                const response = await firstValueFrom(
                    this.httpService.get(url, {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                        params: {
                            text_field_as_key: true,
                            page_size: 100,
                            page_token: pageToken || undefined
                        },
                    }),
                );

                if (response.data.code !== 0) {
                    throw new Error(`Lark API Error: ${response.data.msg}`);
                }

                const data = response.data.data;
                if (data.items) {
                    allRecords = allRecords.concat(data.items);
                }

                hasMore = data.has_more;
                pageToken = data.page_token;
            }

            return allRecords;
        } catch (error) {
            this.logger.error('Failed to fetch employee records from Lark', error);
            throw error;
        }
    }

    // Sync employee data from Lark to database
    async syncEmployeeData() {
        try {
            const records = await this.fetchEmployeeRecords();
            this.logger.log(`Fetched ${records.length} employee records from Lark. Syncing to database...`);

            // Debug: log first record's fields
            if (records.length > 0) {
                const firstRecord = records[0];
                this.logger.debug('===== FIRST RECORD FIELDS (for debugging) =====');
                Object.keys(firstRecord.fields).forEach(key => {
                    this.logger.debug(`Field: "${key}" = ${JSON.stringify(firstRecord.fields[key])}`);
                });
            }

            let syncedCount = 0;
            for (const record of records) {
                const employeeData = this.mapRecordToEmployee(record);

                // Skip garbage
                if (!employeeData.name || employeeData.name === 'Unknown') {
                    this.logger.debug(`Skipping garbage employee record: ${record.record_id}`);
                    continue;
                }

                const syntheticEmail =
                    `lark-${String(employeeData.id).replace(/[^a-zA-Z0-9]/g, '_')}@employee.vcb.internal`;

                const byRecord = await this.prisma.user.findFirst({
                    where: { lark_employee_record_id: employeeData.id },
                });
                const byEmpId = employeeData.employee_id
                    ? await this.prisma.user.findFirst({
                        where: { employee_id: employeeData.employee_id },
                    })
                    : null;
                const byName = await this.prisma.user.findFirst({
                    where: {
                        full_name: { equals: employeeData.name, mode: 'insensitive' },
                        NOT: { email: { endsWith: '@employee.vcb.internal' } },
                    },
                });

                // Priority: record-ID match > employee_id match > name match
                const target = byRecord || byEmpId || byName;

                if (!target) {
                    this.logger.debug(`Skipping synthetic email creation for employee: ${employeeData.name}`);
                    syncedCount++;
                    continue;
                }

                // Guard: if another user already owns this employee_id, skip writing it to avoid
                // PrismaClientKnownRequestError: Unique constraint failed on the fields: (employee_id)
                const empIdConflict =
                    employeeData.employee_id &&
                    byEmpId &&
                    byEmpId.id !== target.id;

                if (empIdConflict) {
                    this.logger.warn(
                        `Employee-ID conflict for "${employeeData.name}": ` +
                        `employee_id="${employeeData.employee_id}" already belongs to user ${byEmpId.id} (${byEmpId.email}). ` +
                        `Skipping employee_id update for target ${target.id} (${target.email}).`,
                    );
                }

                const payload = {
                    lark_employee_record_id: employeeData.id,
                    // Only write employee_id when it won't cause a unique constraint violation
                    employee_id: empIdConflict ? undefined : (employeeData.employee_id || undefined),
                    image_url: employeeData.image_url ?? undefined,
                    employee_data: employeeData.employee_data ?? undefined,
                    employee_position: employeeData.position ?? undefined,
                    team: this.mergeTeamValues(target.team, employeeData.team) ?? undefined,
                    employee_status: employeeData.status ?? undefined,
                    employee_date: employeeData.date ?? undefined,
                };

                await this.prisma.user.update({
                    where: { id: target.id },
                    data: {
                        ...payload,
                        ...(target.email.endsWith('@employee.vcb.internal')
                            ? { full_name: employeeData.name }
                            : {}),
                    },
                });
                syncedCount++;
            }

            this.logger.log(`Successfully synced ${syncedCount} employee records.`);
            return { synced: syncedCount, total: records.length };
        } catch (error) {
            this.logger.error('Failed to sync employee data', error);
            throw error;
        }
    }

    // Map Lark employee record to database format
    private mapRecordToEmployee(record: any) {
        const fields = record.fields;

        const extractString = (val: any): string | null => {
            if (!val) return null;
            if (typeof val === 'string') return val;
            if (Array.isArray(val) && val.length > 0) {
                const first = val[0];
                return first.name || first.text || (typeof first === 'string' ? first : null);
            }
            if (typeof val === 'object') return val.name || val.text || null;
            return String(val);
        };
        const extractTeamList = (val: any): string[] => {
            if (!val) return [];
            if (typeof val === 'string') {
                return val
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
            }
            if (Array.isArray(val)) {
                return val
                    .map((item) => {
                        if (!item) return null;
                        if (typeof item === 'string') return item;
                        if (typeof item === 'object') return item.name || item.text || null;
                        return String(item);
                    })
                    .filter((s): s is string => !!s)
                    .map((s) => s.trim())
                    .filter(Boolean);
            }
            if (typeof val === 'object') {
                const one = val.name || val.text || null;
                return one ? [String(one).trim()] : [];
            }
            return [String(val).trim()].filter(Boolean);
        };

        let name = extractString(fields['Tên'] || fields['Ten'] || fields['Họ tên'] || fields['Nhân viên']);
        let email = extractString(fields['Email'] || fields['email']);

        // Extract image URL from Hình ảnh field
        let imageUrl = null;
        if (fields['Hình ảnh'] && Array.isArray(fields['Hình ảnh']) && fields['Hình ảnh'].length > 0) {
            imageUrl = fields['Hình ảnh'][0].url || fields['Hình ảnh'][0].tmp_url || null;
        }

        // report_date: Prefer 'Ngày báo cáo', then 'Ngày', then 'NGÀY'
        let reportDate = null;
        const rawReportDate = fields['Ngày báo cáo'] || fields['Ngày'] || fields['Ngay'];
        if (rawReportDate) {
            reportDate = new Date(rawReportDate);
        } else if (fields['NGÀY']) {
            const excelEpoch = new Date(1899, 11, 30);
            const days = parseInt(fields['NGÀY']);
            reportDate = new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000);
        }

        const toNum = (val: any) => {
            if (val === null || val === undefined) return 0;
            if (typeof val === 'number') return val;
            const parsed = parseFloat(String(val).replace(/[^0-9.-]+/g, ''));
            return isNaN(parsed) ? 0 : parsed;
        };

        const teams = Array.from(new Set(extractTeamList(fields['Team'])));

        return {
            id: record.record_id,
            employee_id: fields['ID nhân viên'] ? String(fields['ID nhân viên']).trim() : null,
            name: name || 'Unknown',
            email: email,
            image_url: imageUrl,
            employee_data: fields['Nhân viên'] || null,
            position: fields['Chức vụ'] || null,
            team: teams.length ? teams.join(', ') : null,
            kpi_day: toNum(fields['KPI Ngày']),
            completed_day: toNum(fields['Hoàn thành']),
            kpi_month: toNum(fields['KPI THÁNG']),
            completed_month: toNum(fields['Hoàn thành Tháng']),
            traffic_month: toNum(fields['Traffic Tháng']),
            revenue_month: toNum(fields['Doanh thu tháng']),
            kpi_progress_month: toNum(fields['Tiến độ KPI tháng']),
            target_traffic_month: toNum(fields['Mục tiêu Traffic tháng']),
            target_revenue_month: toNum(fields['Mục tiêu doanh thu tháng']),
            status: fields['Tình trạng'] || null,
            state: fields['Trạng thái'] || null,
            date: reportDate,
            month: fields['Tháng'] ? String(fields['Tháng']).trim() : null,
        };
    }

    // Get all employees from DB (merged into users)
    async getEmployeeData() {
        const rows = await this.prisma.user.findMany({
            where: {
                lark_employee_record_id: { not: null },
                OR: [
                    { employee_status: null },
                    {
                        NOT: {
                            employee_status: { contains: 'nghỉ', mode: 'insensitive' },
                        },
                    },
                ],
            },
            orderBy: { updated_at: 'desc' },
        });
        return rows.map((u) => ({
            id: u.lark_employee_record_id,
            employee_id: u.employee_id,
            name: u.full_name,
            image_url: u.image_url,
            employee_data: u.employee_data,
            team: u.team,
            status: u.employee_status,
            date: u.employee_date,
            position: u.employee_position,
            created_at: u.created_at,
            updated_at: u.updated_at,
        }));
    }

    // Fetch KPI records from Lark - Updated to use tblh9DeeqDBItrg7 as requested

    // Sync KPI data from Lark to database
    async syncKPIData(options?: { forceLocalWrite?: boolean; skipRemoteMirror?: boolean }) {
        // Only sync records within [March 1st of current year .. today] (Vietnam calendar day)
        const KPI_MIN_DATE_KEY = this.getKpiMinDateKey();
        const KPI_MAX_DATE_KEY = this.getKpiMaxDateKey();
        const directDbUrl = options?.forceLocalWrite ? null : this.getDirectSyncDbUrl();
        const targetClient = directDbUrl ? new PrismaClient({ datasources: { db: { url: directDbUrl } } }) : null;
        const targetLarkKPI = targetClient ? targetClient.larkKPI : this.prisma.larkKPI;
        const targetUsers = targetClient ? targetClient.user : this.prisma.user;
        const isOnStatus = (raw: unknown): boolean => {
            const s = String(raw || '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/đ/g, 'd')
                .trim();
            return s === 'on' || s === 'dang hoat dong' || s === 'hoat dong' || s === 'active' || s === 'leader';
        };

        try {
            const records = await this.fetchLarkRecordsGeneric(this.KPI_BASE_ID, this.KPI_TABLE_ID, 500);
            this.logger.log(`Fetched ${records.length} KPI records from Lark (Table: ${this.KPI_TABLE_ID}). Clearing database and syncing...`);
            if (!records || records.length === 0) {
                throw new Error('KPI sync aborted: no records fetched from Lark, skip replacing local table.');
            }

            // We now use upsert to avoid clearing table and causing downtime/data loss
            // await targetLarkKPI.deleteMany({});

            let syncedCount = 0;
            let skippedOutsideDateWindow = 0;
            const rawSamples = [];
            const allKeys = new Set<string>();

            // Tải bảng users làm nguồn chuẩn hoá Team và Status
            const sysUsers = await targetUsers.findMany({
                select: { full_name: true, employee_id: true, email: true, team: true, employee_status: true }
            });
            const dbUsersMap = new Map<string, any>();
            sysUsers.forEach(u => {
                if (u.employee_id) dbUsersMap.set(String(u.employee_id).trim(), u);
                if (u.email) dbUsersMap.set(String(u.email).toLowerCase().trim(), u);
                if (u.full_name) dbUsersMap.set(u.full_name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' '), u);
            });

            const kpiRecordsToInsert: any[] = [];
            for (const record of records) {
                Object.keys(record.fields).forEach(k => allKeys.add(k));
                if (rawSamples.length < 3) rawSamples.push(record);

                const kpiData = this.mapRecordToKPI(record);

                const cleanName = (kpiData.name || '').trim();
                if (!cleanName || cleanName.toLowerCase() === 'unknown') continue;

                if (!kpiData.report_date) {
                    skippedOutsideDateWindow++;
                    continue;
                }
                const recordDate = kpiData.report_date instanceof Date
                    ? kpiData.report_date
                    : new Date(kpiData.report_date);
                if (isNaN(recordDate.getTime())) {
                    skippedOutsideDateWindow++;
                    continue;
                }
                const dateKey = this.toVietnamDateKey(recordDate);
                if (dateKey < KPI_MIN_DATE_KEY || dateKey > KPI_MAX_DATE_KEY) {
                    skippedOutsideDateWindow++;
                    continue;
                }

                const nameKey = cleanName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' ');
                const empIdKey = kpiData.employee_id ? String(kpiData.employee_id).trim() : null;

                let larkUserId = null;
                if (kpiData.employee_data) {
                    const empArr = Array.isArray(kpiData.employee_data) ? kpiData.employee_data : [kpiData.employee_data];
                    if (empArr[0]?.id) larkUserId = String(empArr[0].id).trim();
                }

                const sysMatch = (empIdKey ? dbUsersMap.get(empIdKey) : null) ||
                                 (larkUserId ? dbUsersMap.get(larkUserId) : null) ||
                                 dbUsersMap.get(nameKey);
                if (sysMatch) {
                    // Role comes from Users table (handled in getUserActivityReports)
                    // We also fetch current employee_status to skip resigned users.
                    if (sysMatch.employee_status) kpiData.employee_status = sysMatch.employee_status;
                }

                // LarkKPI (traffic teams): chỉ filter employee status khi match được user trong DB.
                // KHÔNG dùng kpiData.state vì đó là trạng thái task (Hoàn thành/Đang làm),
                // KHÔNG phải trạng thái nhân viên (ON/OFF/Đang hoạt động).
                if (sysMatch?.employee_status && !isOnStatus(sysMatch.employee_status)) {
                    continue;
                }

                if (!kpiData.name && !kpiData.team) {
                    continue;
                }

                kpiRecordsToInsert.push({
                    id: kpiData.id,
                    employee_id: kpiData.employee_id,
                    name: kpiData.name,
                    tag: kpiData.tag,
                    team: kpiData.team,
                    image_url: kpiData.image_url,
                    kpi_day: kpiData.kpi_day,
                    kpi_month: kpiData.kpi_month,
                    kpii_status: kpiData.kpii_status,
                    kpi_day_percent: kpiData.kpi_day_percent,
                    completed_day: kpiData.completed_day,
                    completed_month: kpiData.completed_month,
                    task_new: kpiData.task_new,
                    task_new_month: kpiData.task_new_month,
                    task_auto: kpiData.task_auto,
                    task_auto_month: kpiData.task_auto_month,
                    task_creative: kpiData.task_creative,
                    content_win_new: kpiData.content_win_new,
                    revenue_month: kpiData.revenue_month,
                    traffic_month: kpiData.traffic_month,
                    target_revenue_month: kpiData.target_revenue_month,
                    target_traffic_month: kpiData.target_traffic_month,
                    kpi_progress_month: kpiData.kpi_progress_month,
                    employee_status: kpiData.employee_status,
                    state: kpiData.state,
                    employee_data: kpiData.employee_data,
                    report_date: kpiData.report_date,
                    month: kpiData.month,
                    link_image: kpiData.link_image,
                });
            }

            if (kpiRecordsToInsert.length > 0) {
                const CHUNK = 2000;
                this.logger.log(`[KPI] Transactionally replacing ${kpiRecordsToInsert.length} records...`);

                const createQueries = [];
                for (let i = 0; i < kpiRecordsToInsert.length; i += CHUNK) {
                    createQueries.push(
                        targetLarkKPI.createMany({
                            data: kpiRecordsToInsert.slice(i, i + CHUNK),
                            skipDuplicates: true
                        })
                    );
                }

                // Execute drop and re-insert in a single atomic transaction. 
                // This guarantees zero downtime on the frontend because queries overlap with the snapshot.
                const clientToUse = targetClient || this.prisma;
                await clientToUse.$transaction([
                    targetLarkKPI.deleteMany({}),
                    ...createQueries
                ]);

                syncedCount = kpiRecordsToInsert.length;
            }

            let mirroredRemote = 0;
            if (!targetClient && !options?.skipRemoteMirror) {
                try {
                    mirroredRemote = await this.mirrorLarkKpiSnapshotToServer(kpiRecordsToInsert);
                } catch (mirrorErr) {
                    this.logger.error('[KPI] Mirror to SERVER_DATABASE_URL failed — local lark_kpi is already updated', mirrorErr);
                }
            }

            this.logger.log(`Successfully synced ${syncedCount} KPI records (skipped ${skippedOutsideDateWindow} records outside [${KPI_MIN_DATE_KEY} .. ${KPI_MAX_DATE_KEY}] or missing report_date).`);
            this.invalidateActivityCache();
            return {
                synced: syncedCount,
                total: records.length,
                skippedBeforeMinDate: skippedOutsideDateWindow,
                samples: rawSamples,
                allKeys: Array.from(allKeys),
                mirroredRemote,
            };
        } catch (error) {
            this.logger.error('Failed to sync KPI data', error);
            throw error;
        } finally {
            if (targetClient) {
                await targetClient.$disconnect().catch(() => undefined);
            }
        }
    }

    /**
     * Đồng bộ KPI Đồ Da từ Bitable wiki (LARK_KPI_DODA_BASE_ID / LARK_KPI_DODA_TABLE_ID)
     * vào bảng lark_kpi_do_da. Cấu trúc cột giống KPI chính — dùng chung mapRecordToKPI.
     */
    async syncKPIDoDaData(options?: { forceLocalWrite?: boolean; skipRemoteMirror?: boolean }) {
        const KPI_MIN_DATE_KEY = this.getKpiDoDaMinDateKey();
        const KPI_MAX_DATE_KEY = this.getKpiMaxDateKey();
        const directDbUrl = options?.forceLocalWrite ? null : this.getDirectSyncDbUrl();
        const targetClient = directDbUrl ? new PrismaClient({ datasources: { db: { url: directDbUrl } } }) : null;
        const targetUsers = targetClient ? targetClient.user : this.prisma.user;
        const targetDoDa = targetClient
            ? (targetClient as unknown as { larkKpiDoDa: Prisma.LarkKPIDelegate | undefined }).larkKpiDoDa
            : this.prismaLarkKpiDoDa;
        const targetDoDaEditor = targetClient
            ? (targetClient as unknown as { larkKpiDoDaEditor: any }).larkKpiDoDaEditor
            : this.prismaLarkKpiDoDaEditor;
        if (!this.KPI_DODA_BASE_ID || !this.KPI_DODA_TABLE_ID) {
            this.logger.warn('[KPI DoDa] LARK_KPI_DODA_BASE_ID / LARK_KPI_DODA_TABLE_ID chưa cấu hình — bỏ qua sync.');
            return { synced: 0, total: 0, skippedBeforeMinDate: 0, samples: [], allKeys: [] };
        }
        const isDoDaEditKpiTable = this.KPI_DODA_TABLE_ID === 'tblPIc4EQjd2wfAa';
        if (!targetDoDa && !isDoDaEditKpiTable) {
            throw new Error('[KPI DoDa] Target Prisma has no larkKpiDoDa delegate.');
        }
        if (!targetDoDaEditor && isDoDaEditKpiTable) {
            throw new Error('[KPI DoDa] Target Prisma has no larkKpiDoDaEditor delegate.');
        }

        try {
            const records = await this.fetchLarkRecordsGeneric(this.KPI_DODA_BASE_ID, this.KPI_DODA_TABLE_ID, 500);
            this.logger.log(
                `[KPI DoDa] Fetched ${records.length} records (base=${this.KPI_DODA_BASE_ID}, table=${this.KPI_DODA_TABLE_ID}). Replacing ${isDoDaEditKpiTable ? 'lark_kpi_do_da_editor' : 'lark_kpi_do_da'}...`,
            );
            if (!records || records.length === 0) {
                throw new Error('KPI DoDa sync aborted: no records fetched from Lark, skip replacing local table.');
            }

            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/50a1c944-63a6-4094-af64-9a73a105402a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hypothesisId: 'H1', location: 'lark.service.ts:syncKPIDoDaData:beforeDeleteMany', message: 'KPI DoDa about to deleteMany lark_kpi_do_da', data: { recordCount: records.length }, timestamp: Date.now() }) }).catch(() => { });
            // #endregion

            let syncedCount = 0;
            let skippedBeforeMinDate = 0;
            const rawSamples: any[] = [];
            const allKeys = new Set<string>();

            const sysUsers = await targetUsers.findMany({
                select: { id: true, full_name: true, employee_id: true, email: true, team: true, employee_status: true },
            });
            const dbUsersMap = new Map<string, any>();
            sysUsers.forEach((u) => {
                if (u.employee_id) dbUsersMap.set(String(u.employee_id).trim(), u);
                if (u.email) dbUsersMap.set(String(u.email).toLowerCase().trim(), u);
                if (u.full_name) {
                    const normFull = u.full_name
                        .toLowerCase()
                        .normalize('NFD')
                        .replace(/[\u0300-\u036f]/g, '')
                        .replace(/đ/g, 'd')
                        .trim()
                        .replace(/\s+/g, ' ');
                    dbUsersMap.set(normFull, u);
                    // Also index by "first + last" token (e.g. "tran quy" for "Trần Minh Quý")
                    // so short Lark names like "Tran Quy" can match full Vietnamese names.
                    const tokens = normFull.split(' ').filter(Boolean);
                    if (tokens.length >= 3) {
                        const shortKey = `${tokens[0]} ${tokens[tokens.length - 1]}`;
                        if (!dbUsersMap.has(shortKey)) dbUsersMap.set(shortKey, u);
                    }
                }
            });

            const normalizeNameKey = (name: string) =>
                String(name || '')
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .replace(/đ/g, 'd')
                    .trim()
                    .replace(/\s+/g, ' ');
            const parseEditor = (value: any): { name: string | null; email: string | null; userId: string | null } => {
                const empty = { name: null, email: null, userId: null };
                if (!value) return null;
                if (Array.isArray(value) && value.length > 0) {
                    const first = value[0];
                    if (first && typeof first === 'object') {
                        return {
                            name: first.name || first.en_name || first.text || null,
                            email: first.email || null,
                            userId: first.id || first.user_id || first.open_id || null,
                        };
                    }
                    return { ...empty, name: typeof first === 'string' ? first : null };
                }
                if (typeof value === 'object') {
                    return {
                        name: value.name || value.en_name || value.text || null,
                        email: value.email || null,
                        userId: value.id || value.user_id || value.open_id || null,
                    };
                }
                return { ...empty, name: typeof value === 'string' ? value : null };
            };
            const isDoneByStatus = (statusField: any, checkedField: any): boolean => {
                // Accept either multi-select "Trạng thái=Đã hoàn thành" or checkbox "Đã edit".
                if (checkedField === true || checkedField === 1 || String(checkedField).toLowerCase() === 'true') return true;
                if (Array.isArray(statusField)) {
                    return statusField.some((x: any) => {
                        const name = String(x?.name || x?.text || x || '')
                            .toLowerCase()
                            .normalize('NFD')
                            .replace(/[\u0300-\u036f]/g, '')
                            .trim();
                        return name.includes('da hoan thanh') || name.includes('hoan thanh');
                    });
                }
                return false;
            };

            const rows: any[] = [];
            const editorRows: any[] = [];
            if (isDoDaEditKpiTable) {
                const matchedDoDaUserIds = new Set<string>();
                type Bucket = {
                    name: string;
                    dateKey: string;
                    reportDate: Date;
                    monthKey: string;
                    total: number;
                    done: number;
                    team?: string | null;
                    employee_id?: string | null;
                    employee_status?: string | null;
                };
                const dayBuckets = new Map<string, Bucket>();
                const monthTotals = new Map<string, { total: number; done: number }>();

                for (const record of records) {
                    const fields = record.fields || {};
                    Object.keys(fields).forEach((k) => allKeys.add(k));
                    if (rawSamples.length < 3) rawSamples.push(record);

                    const rawDate = fields['Ngày edit'] || fields['Ngay edit'] || fields['Ngày đăng'];
                    const reportDate = rawDate ? new Date(rawDate) : null;
                    if (!reportDate || isNaN(reportDate.getTime())) {
                        skippedBeforeMinDate++;
                        continue;
                    }
                    const dateKey = this.toVietnamDateKey(reportDate);
                    if (dateKey < KPI_MIN_DATE_KEY || dateKey > KPI_MAX_DATE_KEY) {
                        skippedBeforeMinDate++;
                        continue;
                    }

                    const editor = parseEditor(fields['Người edit'] || fields['Nguoi edit']);
                    const editorName = editor?.name ? String(editor.name).trim() : '';
                    if (!editorName) continue;
                    const nameKey = normalizeNameKey(editorName);
                    const editorEmailKey = editor?.email ? String(editor.email).toLowerCase().trim() : null;
                    const monthKey = dateKey.slice(0, 7);
                    const done = isDoneByStatus(fields['Trạng thái'] || fields['Trang thai'], fields['Đã edit'] || fields['Da edit']);

                    const sysMatch = (editorEmailKey ? dbUsersMap.get(editorEmailKey) : null) || dbUsersMap.get(nameKey);
                    if (sysMatch?.id) matchedDoDaUserIds.add(String(sysMatch.id));
                    // Dùng full_name từ users table nếu có để tránh 2 card riêng (e.g. "Tran Quy" vs "Trần Minh Quý")
                    const canonicalName = sysMatch?.full_name || editorName;
                    const canonicalNameKey = normalizeNameKey(canonicalName);
                    // KPI Đồ Da table is team-specific.
                    const resolvedTeam = 'Đồ Da';
                    const teamKey = normalizeNameKey(resolvedTeam);
                    const bucketKey = `${canonicalNameKey}|${teamKey}|${dateKey}`;
                    const existing = dayBuckets.get(bucketKey);
                    if (existing) {
                        existing.total += 1;
                        if (done) existing.done += 1;
                    } else {
                        dayBuckets.set(bucketKey, {
                            name: canonicalName,
                            dateKey,
                            reportDate,
                            monthKey,
                            total: 1,
                            done: done ? 1 : 0,
                            team: sysMatch?.team || resolvedTeam,
                            employee_id: sysMatch?.employee_id || null,
                            employee_status: sysMatch?.employee_status || 'ON',
                        });
                    }

                    const monthTotalKey = `${canonicalNameKey}|${teamKey}|${monthKey}`;
                    const monthAgg = monthTotals.get(monthTotalKey) || { total: 0, done: 0 };
                    monthAgg.total += 1;
                    if (done) monthAgg.done += 1;
                    monthTotals.set(monthTotalKey, monthAgg);
                }

                dayBuckets.forEach((bucket, key) => {
                    const [nameBucketKey, teamBucketKey] = key.split('|');
                    const monthAgg = monthTotals.get(`${nameBucketKey}|${teamBucketKey}|${bucket.monthKey}`) || { total: 0, done: 0 };
                    editorRows.push({
                        id: `doda-kpi-editor-${bucket.dateKey}-${nameBucketKey}-${teamBucketKey}`.slice(0, 191),
                        editor_name: bucket.name,
                        editor_name_key: nameBucketKey,
                        team: bucket.team,
                        report_date: bucket.reportDate,
                        report_date_key: bucket.dateKey,
                        month: `T${parseInt(bucket.monthKey.slice(5, 7), 10)}`,
                        kpi_day: bucket.total,
                        completed_day: bucket.done,
                        kpi_month: monthAgg.total,
                        completed_month: monthAgg.done,
                        source_table_id: this.KPI_DODA_TABLE_ID,
                    });
                });

                // Ensure multi-team members keep Do Da membership in users table.
                if (matchedDoDaUserIds.size > 0) {
                    const touchedUsers = await targetUsers.findMany({
                        where: { id: { in: Array.from(matchedDoDaUserIds) } },
                        select: { id: true, team: true },
                    });
                    for (const u of touchedUsers) {
                        const mergedTeam = this.mergeTeamValues(u.team, 'Đồ Da');
                        if (mergedTeam !== u.team) {
                            await targetUsers.update({
                                where: { id: u.id },
                                data: { team: mergedTeam },
                            });
                        }
                    }
                }
            } else {
                for (const record of records) {
                    Object.keys(record.fields).forEach((k) => allKeys.add(k));
                    if (rawSamples.length < 3) rawSamples.push(record);

                    const kpiData = this.mapRecordToKPI(record);
                    const cleanName = (kpiData.name || '').trim();
                    if (!cleanName || cleanName.toLowerCase() === 'unknown') continue;

                    // Skip records outside [KPI_MIN_DATE_KEY .. KPI_MAX_DATE_KEY] (Vietnam day).
                    if (kpiData.report_date) {
                        const recordDate =
                            kpiData.report_date instanceof Date ? kpiData.report_date : new Date(kpiData.report_date);
                        if (!isNaN(recordDate.getTime())) {
                            const dateKey = this.toVietnamDateKey(recordDate);
                            if (dateKey < KPI_MIN_DATE_KEY || dateKey > KPI_MAX_DATE_KEY) {
                                skippedBeforeMinDate++;
                                continue;
                            }
                        }
                    }

                    const nameKey = normalizeNameKey(cleanName);
                    const empIdKey = kpiData.employee_id ? String(kpiData.employee_id).trim() : null;
                    let larkUserId = null;
                    if (kpiData.employee_data) {
                        const empArr = Array.isArray(kpiData.employee_data) ? kpiData.employee_data : [kpiData.employee_data];
                        if (empArr[0]?.id) larkUserId = String(empArr[0].id).trim();
                    }

                    const sysMatch = (empIdKey ? dbUsersMap.get(empIdKey) : null) ||
                                     (larkUserId ? dbUsersMap.get(larkUserId) : null) ||
                                     dbUsersMap.get(nameKey);
                    if (sysMatch) {
                        // Team strictly follows Lark source (unless it's null/empty, but usually it's set).
                        // Role and user-specific attributes stay in Users table.
                        if (sysMatch.employee_status) kpiData.employee_status = sysMatch.employee_status;
                    }

                    if (!kpiData.name && !kpiData.team) continue;

                    rows.push({
                        id: kpiData.id,
                        employee_id: kpiData.employee_id,
                        name: kpiData.name,
                        tag: kpiData.tag,
                        team: kpiData.team,
                        image_url: kpiData.image_url,
                        kpi_day: kpiData.kpi_day,
                        kpi_month: kpiData.kpi_month,
                        kpii_status: kpiData.kpii_status,
                        kpi_day_percent: kpiData.kpi_day_percent,
                        completed_day: kpiData.completed_day,
                        completed_month: kpiData.completed_month,
                        task_new: kpiData.task_new,
                        task_new_month: kpiData.task_new_month,
                        task_auto: kpiData.task_auto,
                        task_auto_month: kpiData.task_auto_month,
                        task_creative: kpiData.task_creative,
                        content_win_new: kpiData.content_win_new,
                        revenue_month: kpiData.revenue_month,
                        traffic_month: kpiData.traffic_month,
                        target_revenue_month: kpiData.target_revenue_month,
                        target_traffic_month: kpiData.target_traffic_month,
                        kpi_progress_month: kpiData.kpi_progress_month,
                        employee_status: kpiData.employee_status,
                        state: kpiData.state,
                        employee_data: kpiData.employee_data,
                        report_date: kpiData.report_date,
                        month: kpiData.month,
                        link_image: kpiData.link_image,
                    });
                }
            }

            if (isDoDaEditKpiTable) {
                const editorDelegate = targetDoDaEditor as any;
                await editorDelegate.deleteMany({});
                if (editorRows.length > 0) {
                    const CHUNK = 500;
                    for (let i = 0; i < editorRows.length; i += CHUNK) {
                        const chunk = editorRows.slice(i, i + CHUNK);
                        await editorDelegate.createMany({ data: chunk, skipDuplicates: true });
                    }
                    syncedCount = editorRows.length;
                }
            } else {
                const doDaDelegate = targetDoDa as Prisma.LarkKPIDelegate;
                await doDaDelegate.deleteMany({});
                if (rows.length > 0) {
                    const CHUNK = 500;
                    for (let i = 0; i < rows.length; i += CHUNK) {
                        const chunk = rows.slice(i, i + CHUNK);
                        await doDaDelegate.createMany({ data: chunk, skipDuplicates: true });
                    }
                    syncedCount = rows.length;
                }
            }

            let mirroredRemote = 0;
            if (!targetClient && !options?.skipRemoteMirror) {
                try {
                    mirroredRemote = isDoDaEditKpiTable
                        ? await this.mirrorLarkKpiDoDaEditorSnapshotToServer(editorRows)
                        : await this.mirrorLarkKpiDoDaSnapshotToServer(rows);
                } catch (mirrorErr) {
                    this.logger.error('[KPI DoDa] Mirror to SERVER_DATABASE_URL failed — local DoDa KPI table is already updated', mirrorErr);
                }
            }

            this.logger.log(
                `[KPI DoDa] Synced ${syncedCount} rows into ${isDoDaEditKpiTable ? 'lark_kpi_do_da_editor' : 'lark_kpi_do_da'} (skipped ${skippedBeforeMinDate} outside [${KPI_MIN_DATE_KEY} .. ${KPI_MAX_DATE_KEY}]).`,
            );
            this.invalidateActivityCache();
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/50a1c944-63a6-4094-af64-9a73a105402a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hypothesisId: 'H1', location: 'lark.service.ts:syncKPIDoDaData:success', message: 'KPI DoDa sync completed', data: { syncedCount, runId: 'post-fix' }, timestamp: Date.now() }) }).catch(() => { });
            // #endregion
            return {
                synced: syncedCount,
                total: records.length,
                skippedBeforeMinDate,
                samples: rawSamples,
                allKeys: Array.from(allKeys),
                mirroredRemote,
            };
        } catch (error) {
            this.logger.error('[KPI DoDa] Sync failed', error);
            // #region agent log
            const pe = error as { code?: string; meta?: unknown; message?: string };
            fetch('http://127.0.0.1:7242/ingest/50a1c944-63a6-4094-af64-9a73a105402a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hypothesisId: 'H1', location: 'lark.service.ts:syncKPIDoDaData:catch', message: 'KPI DoDa sync error', data: { code: pe?.code, meta: pe?.meta, errMsg: pe?.message?.slice?.(0, 200) }, timestamp: Date.now() }) }).catch(() => { });
            // #endregion
            throw error;
        } finally {
            if (targetClient) {
                await targetClient.$disconnect().catch(() => undefined);
            }
        }
    }

    // Map Lark KPI record to database format
    private mapRecordToKPI(record: any) {
        const fields = record.fields;

        // Robust key normalization to handle mangled Unicode and variations
        const normalizeKey = (key: string) => {
            return key.toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '') // Remove accents
                .replace(/đ/g, 'd') // Handle Vietnamese 'đ'
                .replace(/\?/g, '') // Remove mangled question marks
                .replace(/\s+/g, '') // Remove spaces
                .trim();
        };

        const fieldKeysMap = new Map();
        Object.keys(fields).forEach(k => {
            fieldKeysMap.set(normalizeKey(k), k);
        });

        const findValue = (possibleKeys: string[]) => {
            for (const pk of possibleKeys) {
                const normPk = normalizeKey(pk);
                // Try direct normalized match
                const actualKey = fieldKeysMap.get(normPk);
                if (actualKey !== undefined) return fields[actualKey];
            }
            return null;
        };

        // Extract image URL from attachments
        let imageUrl = null;
        const hinhAnh = findValue(['Hình ảnh', 'Hinh anh']);
        if (Array.isArray(hinhAnh) && hinhAnh.length > 0) {
            imageUrl = hinhAnh[0].url || hinhAnh[0].tmp_url || null;
        }

        // Extract name
        // Helper to extract string from Lark's complex field types
        const extractString = (val: any): string | null => {
            if (!val) return null;
            if (typeof val === 'string') return val;
            if (Array.isArray(val) && val.length > 0) {
                return val.map((item: any) => {
                    if (item && typeof item === 'object') {
                        return item.name || item.text || item.primary_val || item.title || '';
                    }
                    return String(item);
                }).filter(Boolean).join(', ');
            }
            if (typeof val === 'object') {
                return val.name || val.text || val.primary_val || val.title || null;
            }
            return String(val);
        };

        // Priority 1: 'Nhân viên' Person field — Lark trả về .name chính xác (VD: "Huyền Cam").
        // Trường "Tên" (text/formula) thường bị đảo ngược thành "Cam Huyền" nên chỉ dùng làm fallback.
        let name = extractString(findValue(['Nhân viên', 'Nhan vien', 'Employee']));

        // Priority 2: Fallback sang các trường text nếu Person field rỗng
        if (!name) {
            name = extractString(
                findValue([
                    'Họ tên',
                    'Ho ten',
                    'Họ và tên',
                    'Ho va ten',
                    'Tên nhân sự',
                    'Ten nhan su',
                    'Họ tên nhân sự',
                    'Ho ten nhan su',
                    'Full Name',
                    'Name',
                    'Tên',
                    'Ten',
                    'Người sưu tầm',
                    'Nguoi suu tam',
                    'Người phụ trách',
                    'Nguoi phu trach',
                    'Owner',
                    'Người tạo',
                    'Nguoi tao'
                ]),
            );
        }

        // Fallback for child/detail KPI tables that only expose parent relation title.
        if (!name) {
            name = extractString(
                findValue([
                    'Các mục mẹ',
                    'Cac muc me',
                    'Mục mẹ',
                    'Muc me',
                    'Parent',
                    'Parent Item',
                    'Tên mục mẹ',
                    'Ten muc me',
                ]),
            );
        }

        // Final fallback: ID nhân viên or TAG if it looks like a name/code
        if (!name) {
            name = extractString(findValue(['ID nhân viên', 'Mã Nhân Viên VCB', 'TAG']));
        }

        if (!name) {
            const extraLog = `RAW Các mục mẹ: ${JSON.stringify(findValue(['Các mục mẹ', 'Cac muc me', 'Mục mẹ', 'Muc me', 'Parent']))}`;
            this.logger.warn(`KPI Record ${record.record_id} has no name. Fields: ${Object.keys(record.fields).join(', ')}. ${extraLog}`);
        }

        // Extract KPI day percent
        let kpiDayPercent = null;
        const kpiDayPctVal = findValue(['% KPI NGÀY', '% KPI NGAY']);
        if (Array.isArray(kpiDayPctVal) && kpiDayPctVal.length > 0) {
            kpiDayPercent = kpiDayPctVal[0].text || null;
        }

        // Extract creative task
        let taskCreative = null;
        const taskCreativeField = findValue(['Task sáng tạo', 'Task sang tao']);
        if (Array.isArray(taskCreativeField) && taskCreativeField.length > 0) {
            taskCreative = parseInt(taskCreativeField[0]) || null;
        }

        // Extract auto task
        let taskAutoVal = findValue(['Số task tự động', 'So task tu dong', 'Task Auto']);
        if (Array.isArray(taskAutoVal) && taskAutoVal.length > 0) {
            taskAutoVal = parseInt(taskAutoVal[0]) || null;
        }

        // Date parsing
        let reportDate = null;
        const rawNgayBaoCao = findValue(['Ngày báo cáo', 'Ngay bao cao', 'Ngày', 'Ngay', 'NGÀY']);
        if (rawNgayBaoCao) {
            const stringVal = extractString(rawNgayBaoCao);
            const numVal = Number(stringVal);
            if (!isNaN(numVal) && stringVal !== null) {
                // If it's a timestamp (ms or s) or a small number (Excel date)
                if (numVal > 1000000000000) {
                    reportDate = new Date(numVal);
                } else if (numVal > 30000 && numVal < 60000) {
                    // Excel serial date (approx 1982 to 2064)
                    reportDate = new Date((numVal - 25569) * 86400 * 1000);
                } else {
                    // Might be seconds or other format
                    reportDate = new Date(numVal * (numVal < 10000000000 ? 1000 : 1));
                }
            } else if (stringVal) {
                const isoDateOnly = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
                const vnDateOnly = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
                const isoMatch = stringVal.match(isoDateOnly);
                const vnMatch = stringVal.match(vnDateOnly);

                if (isoMatch) {
                    const y = Number(isoMatch[1]);
                    const m = Number(isoMatch[2]);
                    const d = Number(isoMatch[3]);
                    reportDate = new Date(Date.UTC(y, m - 1, d, 5, 0, 0, 0)); // 12:00 VN
                } else if (vnMatch) {
                    const d = Number(vnMatch[1]);
                    const m = Number(vnMatch[2]);
                    const y = Number(vnMatch[3]);
                    reportDate = new Date(Date.UTC(y, m - 1, d, 5, 0, 0, 0)); // 12:00 VN
                } else {
                    reportDate = new Date(stringVal);
                }
            }
        }
        if (reportDate && !isNaN(reportDate.getTime())) {
            reportDate = this.toVietnamNoonUtc(reportDate);
        }

        const cleanBigInt = (val: any): bigint | null => {
            if (val === null || val === undefined) return null;
            if (typeof val === 'number') return BigInt(Math.floor(val));
            if (typeof val === 'string') {
                const clean = val.replace(/[^0-9.-]/g, '').split('.')[0]; // Only digits
                return clean ? BigInt(clean) : BigInt(0);
            }
            if (Array.isArray(val) && val.length > 0) return cleanBigInt(val[0]);
            return null;
        };

        // Helper for numeric parsing
        const parseNum = (val: any): number | null => {
            const n = Number(extractString(val));
            return isNaN(n) ? null : n;
        };

        return {
            id: record.record_id,
            employee_id: extractString(findValue(['ID nhân viên', 'ID nhan vien'])) || null,
            name: name,
            tag: extractString(findValue(['TAG'])) || null,
            team: extractString(findValue(['Team'])) || null,
            image_url: imageUrl,
            kpi_day: parseNum(findValue(['KPI Ngày', 'KPI Ngay'])),
            kpi_month: parseNum(findValue(['KPI THÁNG', 'KPI THANG'])),
            kpii_status: extractString(findValue(['KPII'])) || null,
            kpi_day_percent: kpiDayPercent,
            completed_day: parseNum(findValue(['Hoàn thành', 'Hoan thanh'])),
            completed_month: parseNum(findValue(['Hoàn thành Tháng', 'Hoan thanh Thang'])),
            task_new: parseNum(findValue(['Task mới', 'Task moi'])),
            task_new_month: parseNum(findValue(['Task mới tháng', 'Task moi thang'])),
            task_auto: parseNum(findValue(['Số task tự động', 'So task tu dong', 'Task Auto'])),
            task_auto_month: parseNum(findValue(['Task Auto Tháng', 'Task Auto Thang'])),
            task_creative: taskCreative,
            content_win_new: parseNum(findValue(['Content win mới', 'Content win moi'])),
            revenue_month: cleanBigInt(findValue(['Doanh thu tháng', 'Doanh thu thang', 'Doanh thu', 'Revenue'])),
            traffic_month: cleanBigInt(findValue(['Traffic Tháng', 'Traffic Thang', 'Traffic', 'Traffi'])),
            target_revenue_month: extractString(findValue(['Mục tiêu doanh thu tháng', 'Muc tieu doanh thu thang'])) || null,
            target_traffic_month: extractString(findValue(['Mục tiêu Traffic tháng', 'Muc tieu Traffic thang'])) || null,
            kpi_progress_month: parseNum(findValue(['Tiến độ KPI tháng', 'Tien do KPI thang'])),
            employee_status: extractString(findValue(['Tình trạng', 'Tinh trang'])) || null,
            state: extractString(findValue(['Trạng thái', 'Trang thai'])) || null,
            employee_data: findValue(['Nhân viên', 'Nhan vien']) || null,
            report_date: reportDate,
            month: extractString(findValue(['Tháng', 'Thang', 'THÁNG'])) || null,
            link_image: extractString(findValue(['Link ảnh', 'Link anh', 'flddOHyBPa'])) || null,
        };
    }

    // Get all KPI data from DB
    async getKPIData() {
        return this.prisma.larkKPI.findMany({
            orderBy: { report_date: 'desc' }
        });
    }

    async getKPIDoDaData() {
        const isDoDaEditorKpi = this.KPI_DODA_TABLE_ID === 'tblPIc4EQjd2wfAa';
        if (isDoDaEditorKpi) {
            return this.prismaLarkKpiDoDaEditor.findMany({
                orderBy: [{ report_date: 'desc' }, { editor_name: 'asc' }],
            });
        }
        return this.prismaLarkKpiDoDa.findMany({
            orderBy: { report_date: 'desc' },
        });
    }

    // Clear cache immediately after a report submission to prevent stale UI
    invalidateActivityCache() {
        this.cacheService.invalidate('activity:');
    }

    // Get combined user activity reports (LarkReport + LarkKPI)
    async getUserActivityReports(filters?: { date?: string; startDate?: string; endDate?: string; team?: string; requesterEmail?: string; timeType?: string }) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/50a1c944-63a6-4094-af64-9a73a105402a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: 'kpi-team-debug-1', hypothesisId: 'H1', location: 'lark.service.ts:getUserActivityReports:entry', message: 'Entered user activity', data: { date: filters?.date || null, startDate: filters?.startDate || null, endDate: filters?.endDate || null, team: filters?.team || 'All', timeType: filters?.timeType || null }, timestamp: Date.now() }) }).catch(() => { });
        // #endregion
        // ─── PERF: Shared cache key (không include email) ────────────────────────────
        // Trước đây: mỗi user có cache riêng → 70 users = 70 queries nặng song song.
        // Sau: dataset (nặng) được cache CHUNG cho tất cả users cùng filter.
        // Role/team lookup (nhẹ) được cache riêng per-user với TTL dài hơn.
        const sharedCacheKey = `activity:data:${filters?.startDate || filters?.date || ''}:${filters?.endDate || ''}:${filters?.team || 'All'}:${filters?.timeType || ''}`;
        const roleCacheKey = `activity:role:${filters?.requesterEmail || ''}`;
        // ────────────────────────────────────────────────────────────────────────────

        // Step 1: Resolve role/team for this user.
        // Source of truth for leader/admin role is users table.
        let requesterRole = 'member';
        let requesterTeam = null;
        if (filters?.requesterEmail) {
            const roleData = await this.cacheService.get(roleCacheKey, this.activityRoleCacheTtlMs, async () => {
                const sysUser = await this.prisma.user.findFirst({
                    where: { email: { equals: filters.requesterEmail, mode: 'insensitive' } },
                    select: { roles: true, team: true },
                });
                const recentKpis = await this.prisma.larkKPI.findMany({
                    where: { OR: [{ state: { not: 'off' } }, { state: null }] },
                    select: { team: true, employee_data: true, report_date: true },
                    orderBy: { report_date: 'desc' },
                    take: 5000,
                });
                const requesterEmail = filters.requesterEmail.toLowerCase().trim();
                const matched = recentKpis.find((kpi: any) => this.extractEmailFromKpi(kpi) === requesterEmail);
                let role = 'member';
                if (sysUser?.roles && sysUser.roles.length > 0) {
                    if (sysUser.roles.includes(UserRole.ADMIN)) role = 'admin';
                    else if (sysUser.roles.includes(UserRole.MANAGER)) role = 'manager';
                    else if (sysUser.roles.some((r) => r === ('LEADER' as any))) role = 'leader';
                }
                const team = sysUser?.team || matched?.team || null;

                return { role, team };
            });
            requesterRole = roleData.role;
            requesterTeam = roleData.team;
        }

        // Step 2: Fetch shared dataset (configurable TTL to control SQL pressure)
        const sharedData = await this.cacheService.get(sharedCacheKey, this.activitySharedCacheTtlMs, async () => {
            // ─── PERF: Memoized name normalizer ─────────────────────────────────────────
            // normalize('NFD') + replace chain là operation nặng (O(n) string scan).
            // Với 70+ nhân viên × nhiều vòng lặp = hàng chục nghìn lần gọi.
            // Cache kết quả vào Map để mỗi tên chỉ normalize 1 lần duy nhất.
            const _normCache = new Map<string, string>();
            const normName = (raw: string | null | undefined): string => {
                if (!raw) return '';
                const cached = _normCache.get(raw);
                if (cached !== undefined) return cached;
                const result = raw
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .replace(/đ/g, 'd')
                    .trim()
                    .replace(/\s+/g, ' ');
                _normCache.set(raw, result);
                return result;
            };
            // ────────────────────────────────────────────────────────────────────────────
            try {
                const teamFixStats = { total: 0, improved: 0, multiTeam: 0 };
                const teamResolveStats = { byEmail: 0, byName: 0, byEmpId: 0, unresolved: 0 };
                const teamMismatchSamples: any[] = [];
                const resignedDropSamples: any[] = [];
                const teamFilterNormalized = filters?.team ? filters.team.toLowerCase().trim() : null;

                // requesterRole và requesterTeam đã được resolve + cached bên ngoài (10 phút)
                // Không cần fetch lại trong shared dataset cache.

                // --- MODIFIED: Removed team enforcement for Members/Leaders to allow full transparency in rankings ---
                const isInternalAdmin = requesterRole === 'admin' || requesterRole === 'manager';

                // Fetch reports with optional filters
                const getVietnamParts = (dateInput?: string | Date) => {
                    if (typeof dateInput === 'string' && dateInput.length === 10) {
                        const parts = dateInput.split('-');
                        return {
                            y: parseInt(parts[0], 10),
                            m: parseInt(parts[1], 10),
                            d: parseInt(parts[2], 10),
                        };
                    }

                    const dateObj = dateInput instanceof Date ? dateInput : (dateInput ? new Date(dateInput) : new Date());
                    const dtf = new Intl.DateTimeFormat('en-CA', {
                        timeZone: 'Asia/Ho_Chi_Minh',
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                    });
                    const p = dtf.formatToParts(dateObj);
                    const y = Number(p.find(x => x.type === 'year')?.value || '1970');
                    const m = Number(p.find(x => x.type === 'month')?.value || '1');
                    const d = Number(p.find(x => x.type === 'day')?.value || '1');
                    return { y, m, d };
                };

                const getVietnamBounds = (dateInput?: string | Date) => {
                    const parts = getVietnamParts(dateInput);
                    const y = parts.y;
                    const m = parts.m - 1; // 0-index month
                    const d = parts.d;
                    return {
                        start: new Date(Date.UTC(y, m, d - 1, 17, 0, 0, 0)),
                        end: new Date(Date.UTC(y, m, d, 16, 59, 59, 999))
                    };
                };

                const toVietnamDateString = (dateInput?: string | Date) => {
                    const p = getVietnamParts(dateInput);
                    return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
                };

                const getPreviousVietnamDateString = (dateInput: string) => {
                    const p = getVietnamParts(dateInput);
                    const anchor = new Date(Date.UTC(p.y, p.m - 1, p.d, 5, 0, 0, 0)); // 12:00 VN
                    const prev = new Date(anchor.getTime() - 24 * 60 * 60 * 1000);
                    return toVietnamDateString(prev);
                };

                /** Checklist/traffic/lark_report_kpi: ngày lưu DB thường = UI hiệu suất D + 1. Bitable `lark_kpi.report_date` = D. */
                const getNextVietnamDateString = (dateInput: string) => {
                    const p = getVietnamParts(dateInput);
                    const anchor = new Date(Date.UTC(p.y, p.m - 1, p.d, 5, 0, 0, 0));
                    const next = new Date(anchor.getTime() + 24 * 60 * 60 * 1000);
                    return toVietnamDateString(next);
                };

                const getVietnamMonthBounds = (year: number, monthNum: number) => ({
                    start: new Date(Date.UTC(year, monthNum - 1, 0, 17, 0, 0, 0)),
                    end: new Date(Date.UTC(year, monthNum, 0, 16, 59, 59, 999)),
                });

                const whereClause: any = {};

                const singleDayFromRange =
                    filters?.startDate &&
                        filters?.endDate &&
                        filters.startDate === filters.endDate
                        ? filters.startDate
                        : null;
                const selectedSingleDay = filters?.date || singleDayFromRange;

                let uiDayStartStr: string;
                let uiDayEndStr: string;
                if (filters?.startDate && filters?.endDate) {
                    uiDayStartStr = filters.startDate;
                    uiDayEndStr = filters.endDate;
                } else if (filters?.date) {
                    uiDayStartStr = filters.date;
                    uiDayEndStr = filters.date;
                } else {
                    const todayStr = toVietnamDateString(new Date());
                    uiDayStartStr = todayStr;
                    uiDayEndStr = todayStr;
                }

                const dataDayStartStr = getNextVietnamDateString(uiDayStartStr);
                const dataDayEndStr = getNextVietnamDateString(uiDayEndStr);

                const larkKpiStartOfDay = getVietnamBounds(uiDayStartStr).start;
                const larkKpiEndOfDay = getVietnamBounds(uiDayEndStr).end;
                const memberReportStart = getVietnamBounds(dataDayStartStr).start;
                const memberReportEnd = getVietnamBounds(dataDayEndStr).end;

                const tsInRange = (d: any, start: Date, end: Date): boolean => {
                    if (!d) return false;
                    const t = new Date(d).getTime();
                    return t >= start.getTime() && t <= end.getTime();
                };
                /** Bitable `lark_kpi`: `kpi_day` / `completed_day` theo đúng ngày chọn trên UI (ngày hiệu suất D). Không dùng cửa sổ checklist (D+1). */
                const isBitableKpiRowForSelection = (d: any) => tsInRange(d, larkKpiStartOfDay, larkKpiEndOfDay);

                this.logger.debug(
                    `[KPI-DateMap] uiPerformance=${uiDayStartStr}..${uiDayEndStr} -> lark_kpi.report_date VN [${larkKpiStartOfDay.toISOString()}..${larkKpiEndOfDay.toISOString()}]; checklist/traffic/report_kpi VN [${memberReportStart.toISOString()}..${memberReportEnd.toISOString()}] (day ${dataDayStartStr}..${dataDayEndStr})`,
                );
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/50a1c944-63a6-4094-af64-9a73a105402a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: 'kpi-team-debug-1', hypothesisId: 'H2', location: 'lark.service.ts:getUserActivityReports:kpiDateMap', message: 'Bitable KPI = perf day only; checklist = D+1 window', data: { uiDate: selectedSingleDay || null, dataDayStart: dataDayStartStr, dataDayEnd: dataDayEndStr, larkKpiStart: larkKpiStartOfDay.toISOString(), larkKpiEnd: larkKpiEndOfDay.toISOString(), memberStart: memberReportStart.toISOString(), memberEnd: memberReportEnd.toISOString() }, timestamp: Date.now() }) }).catch(() => { });
                // #endregion

                whereClause.date = {
                    gte: memberReportStart,
                    lte: memberReportEnd,
                };

                let kpiMonthFallback = false;

                // If a specific requester is provided, we don't need to fetch ALL their historical reports here.
                // If we want to ensure they always see their today card, the current date filter already covers it.
                // If they didn't report today, their card will still appear if they have a KPI record for this month.

                // 1. Identify all month/year pairs in the selected range
                const monthsInRange: { monthNum: number; year: number; formats: string[] }[] = [];
                {
                    const startParts = getVietnamParts(larkKpiStartOfDay);
                    const endParts = getVietnamParts(larkKpiEndOfDay);

                    let currMonth = startParts.m;
                    let currYear = startParts.y;
                    const endMonth = endParts.m;
                    const endYear = endParts.y;

                    while (currYear < endYear || (currYear === endYear && currMonth <= endMonth)) {
                        const m = currMonth;
                        const y = currYear;
                        monthsInRange.push({
                            monthNum: m,
                            year: y,
                            formats: [
                                `T${m}`, `T${m < 10 ? '0' + m : m}`,
                                `Tháng ${m}`, `tháng ${m}`,
                                `Thang ${m}`, `thang ${m}`,
                                `${m}`, m < 10 ? `0${m}` : `${m}`,
                                ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m],
                                ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m]
                            ].filter(Boolean)
                        });
                        currMonth += 1;
                        if (currMonth > 12) {
                            currMonth = 1;
                            currYear += 1;
                        }
                    }
                }

                // --- OPTIMIZATION: Push team filters to DB for all users, not just restricted ones ---
                const isRangeFilter = filters?.team === 'All Global' || filters?.team === 'All VN';
                const dbTeamFilter = filters?.team && filters.team !== 'All' && !isRangeFilter ? filters.team : null;
                // DB string matching is accent-sensitive in many setups.
                // For non-ASCII team labels (e.g. "Đài Loan"), avoid hard DB filter and filter in JS with normalized keys.
                const useDbTeamFilter = !!(dbTeamFilter && /^[\x00-\x7F]*$/.test(dbTeamFilter));
                const normalizeTeamKey = (val: string | null | undefined) =>
                    (val || '')
                        .toLowerCase()
                        .normalize('NFD')
                        .replace(/[\u0300-\u036f]/g, '')
                        .replace(/đ/g, 'd')
                        .trim()
                        .replace(/[\s-]+/g, '');
                const compactNameKey = (val: string | null | undefined) => normName(val || '').replace(/\s+/g, '');
                const looseNameKey = (val: string | null | undefined) => normName(val || '').replace(/[^a-z0-9]/g, '');
                const isDoDaTeamFilter = normalizeTeamKey(dbTeamFilter) === normalizeTeamKey('Đồ Da');

                // users.team → checklist (lark_reports). lark_kpi.team → hiệu suất (performance).
                // Role: from users table.
                const allUsersForTeam = await this.prisma.user.findMany({
                    where: { is_active: true },
                    select: { email: true, full_name: true, team: true, image_url: true, roles: true, employee_id: true, employee_data: true }
                });
                const userTeamByEmail = new Map<string, string>();
                const userTeamByName = new Map<string, string>();
                const userAvatarByEmail = new Map<string, string>();
                const userAvatarByName = new Map<string, string>();
                const userAvatarByNameCompact = new Map<string, string>();
                const userAvatarByNameLoose = new Map<string, string>();
                const userEmailByName = new Map<string, string>();
                const userEmailByNameCompact = new Map<string, string>();
                for (const u of allUsersForTeam) {
                    if (u.email && u.full_name) {
                        const nk = normName(u.full_name);
                        if (nk) userEmailByName.set(nk, u.email.toLowerCase().trim());
                        const ck = compactNameKey(u.full_name);
                        if (ck) userEmailByNameCompact.set(ck, u.email.toLowerCase().trim());
                    }
                    if (u.image_url && u.email) userAvatarByEmail.set(u.email.toLowerCase().trim(), u.image_url);
                    if (u.image_url && u.full_name) {
                        const nk = normName(u.full_name);
                        if (nk) userAvatarByName.set(nk, u.image_url);
                        const ck = compactNameKey(u.full_name);
                        if (ck) userAvatarByNameCompact.set(ck, u.image_url);
                        const lk = looseNameKey(u.full_name);
                        if (lk) userAvatarByNameLoose.set(lk, u.image_url);
                    }
                    const t = (u.team || '').trim();
                    if (!t) continue;
                    if (u.email) userTeamByEmail.set(u.email.toLowerCase().trim(), t);
                    if (u.full_name) { const nk = normName(u.full_name); if (nk) userTeamByName.set(nk, t); }
                }

                // Build employee snapshot from Users table (Authoritative for Identity: Team, Role)
                const employeesMap = new Map<string, any>();
                for (const u of allUsersForTeam) {
                    const email = String(u.email || '').toLowerCase().trim();
                    const name = u.full_name || '';
                    const nameKey = normName(name);
                    const key = email || nameKey;
                    if (!key) continue;

                    if (!employeesMap.has(key)) {
                        // Resolve role directly from users.roles field (authoritative source)
                        const userRoles = (u as any).roles as string[] || [];
                        let resolvedRole = 'member';
                        if (userRoles.includes('ADMIN')) resolvedRole = 'admin';
                        else if (userRoles.includes('MANAGER')) resolvedRole = 'manager';
                        else if (userRoles.includes('LEADER')) resolvedRole = 'leader';

                        employeesMap.set(key, {
                            employee_id: u.employee_id || null,
                            full_name: name,
                            email: email || null,
                            team: u.team || null,
                            image_url: (u as any).image_url || null,
                            employee_status: 'ON',
                            status: 'on',
                            roles: userRoles,
                            role: resolvedRole,
                            employee_position: null,
                            employee_data: u.employee_data || null,
                        });
                    }
                }

                const leaderUsers = await this.prisma.user.findMany({
                    where: {
                        OR: [
                            { roles: { has: 'LEADER' } as any },
                            { roles: { has: 'MANAGER' } as any },
                            { roles: { has: 'ADMIN' } as any },
                        ],
                    },
                    select: { email: true, full_name: true, team: true, roles: true },
                });

                const leaderRoleByEmail = new Map<string, { role: string; team: string | null }>();
                const leaderRoleByName = new Map<string, { role: string; team: string | null }>();
                for (const u of leaderUsers as any[]) {
                    const roles = (u.roles || []) as string[];
                    let role = 'member';
                    if (roles.includes('ADMIN')) role = 'admin';
                    else if (roles.includes('MANAGER')) role = 'manager';
                    else if (roles.includes('LEADER')) role = 'leader';
                    const payload = { role, team: u.team || null };
                    const emailKey = String(u.email || '').toLowerCase().trim();
                    const nameKey = normName(u.full_name);
                    if (emailKey) leaderRoleByEmail.set(emailKey, payload);
                    if (nameKey) leaderRoleByName.set(nameKey, payload);
                }

                for (const emp of employeesMap.values()) {
                    const eKey = String(emp.email || '').toLowerCase().trim();
                    const nKey = normName(emp.full_name);
                    const fromUsers = leaderRoleByEmail.get(eKey) || leaderRoleByName.get(nKey);
                    if (fromUsers) emp.role = fromUsers.role;
                }
                const employees = Array.from(employeesMap.values());
                const emailKeyMatchMap = new Map<string, any>();
                const nameKeyMatchMap = new Map<string, any>();
                employees.forEach(emp => {
                    if (emp.email) emailKeyMatchMap.set(emp.email.toLowerCase().trim(), emp);
                    if (emp.full_name) nameKeyMatchMap.set(normName(emp.full_name), emp);
                    
                    // Also index by all names in employee_data (Lark aliases)
                    const larkData = (emp as any).employee_data || [];
                    if (Array.isArray(larkData)) {
                        larkData.forEach((d: any) => {
                            if (d.name) {
                                nameKeyMatchMap.set(normName(d.name), emp);
                                nameKeyMatchMap.set(compactNameKey(d.name), emp);
                            }
                            if (d.en_name) {
                                nameKeyMatchMap.set(normName(d.en_name), emp);
                                nameKeyMatchMap.set(compactNameKey(d.en_name), emp);
                            }
                            // Some people swap First/Last names in Lark
                            const parts = String(d.name || '').split(' ');
                            if (parts.length === 2) {
                                const swapped = `${parts[1]} ${parts[0]}`;
                                nameKeyMatchMap.set(normName(swapped), emp);
                                nameKeyMatchMap.set(compactNameKey(swapped), emp);
                            }
                        });
                    }
                });

                const teamFilterWhere = (dbTeamFilter && useDbTeamFilter) ? {
                    OR: [
                        { team: { equals: dbTeamFilter, mode: 'insensitive' as any } },
                        { team: { startsWith: `${dbTeamFilter},`, mode: 'insensitive' as any } },
                        { team: { endsWith: `, ${dbTeamFilter}`, mode: 'insensitive' as any } },
                        { team: { contains: `, ${dbTeamFilter},`, mode: 'insensitive' as any } },
                    ],
                } : {};

                // Sequential fetch: Only use 1 connection at a time for stability
                const reports = await this.prisma.larkReport.findMany({ where: { ...whereClause }, orderBy: { date: 'desc' } });

                const standardKpis = await this.prisma.larkKPI.findMany({
                    where: {
                        OR: [
                            { month: { in: monthsInRange.flatMap(m => m.formats) } },
                            {
                                month: null,
                                report_date: {
                                    gte: monthsInRange[0] ? getVietnamMonthBounds(monthsInRange[0].year, monthsInRange[0].monthNum).start : larkKpiStartOfDay,
                                    lte: monthsInRange.length > 0 ? getVietnamMonthBounds(monthsInRange[monthsInRange.length - 1].year, monthsInRange[monthsInRange.length - 1].monthNum).end : larkKpiEndOfDay,
                                }
                            },
                        ],
                        report_date: { gte: new Date('2026-03-01T00:00:00Z') },
                        // Safely omitted state: 'off' DB filter to include nullable rows (downstream in-memory isResigned handles filtering)
                    }
                });

                const dodaKpisRaw = await this.prismaLarkKpiDoDaEditor.findMany({
                    where: {
                        report_date: {
                            gte: monthsInRange[0] ? getVietnamMonthBounds(monthsInRange[0].year, monthsInRange[0].monthNum).start : larkKpiStartOfDay,
                            lte: monthsInRange.length > 0 ? getVietnamMonthBounds(monthsInRange[monthsInRange.length - 1].year, monthsInRange[monthsInRange.length - 1].monthNum).end : larkKpiEndOfDay,
                        },
                    },
                });

                const dodaKpis = (dodaKpisRaw as any[]).map((r: any) => {
                    const normEditorName = normName(r.editor_name || '');
                    const authUser = nameKeyMatchMap.get(normEditorName);

                    // If user is not in the official Users table OR is marked OFF, skip or mark as OFF
                    const status = authUser?.employee_status || 'off';
                    if (status.toLowerCase().trim() === 'off' || !authUser) {
                        return null;
                    }

                    return {
                        id: r.id,
                        name: r.editor_name,
                        team: r.team || 'Đồ Da',
                        month: r.month || null,
                        report_date: r.report_date,
                        kpi_day: r.kpi_day ?? 0,
                        completed_day: r.completed_day ?? 0,
                        kpi_month: r.kpi_month ?? 0,
                        completed_month: r.completed_month ?? 0,
                        kpi_day_percent: r.kpi_day && r.kpi_day > 0
                            ? `${Math.round(((r.completed_day || 0) / r.kpi_day) * 100)}%`
                            : '0%',
                        kpii_status: (r.completed_day || 0) >= (r.kpi_day || 0) ? 'ĐẠT' : 'CHƯA ĐẠT',
                        employee_status: status.toUpperCase(),
                        state: status.toLowerCase(),
                        email: authUser?.email || null,
                        employee_id: authUser?.employee_id || null,
                        image_url: authUser?.image_url || null,
                        link_image: null,
                    };
                }).filter(Boolean);

                const allKpiInDbRaw: any[] = [...standardKpis, ...dodaKpis];



                const allChannelsInDb = await this.prisma.channel.findMany({ where: { status: 'Đang hoạt động' } });
                const permissions: any[] = [];

                // Batch 2: KPIs and auxiliary data - also sequential
                const dailyReportKpis = await (this.prisma as any).larkReportKPI.findMany({
                    where: {
                        report_date: { gte: memberReportStart, lte: memberReportEnd },
                    }
                });

                const monthlyReportKpis = await (this.prisma as any).larkReportKPI.findMany({
                    where: {
                        report_date: {
                            gte: getVietnamMonthBounds(monthsInRange[0].year, monthsInRange[0].monthNum).start,
                            lte: getVietnamMonthBounds(monthsInRange[monthsInRange.length - 1].year, monthsInRange[monthsInRange.length - 1].monthNum).end
                        },
                    }
                });

                const allTrafficInDb = await this.prisma.larkTraffic.findMany({ where: { date: { gte: memberReportStart, lte: memberReportEnd } } });

                const reportOutstandings = await this.prisma.$queryRawUnsafe(`
                    SELECT * FROM "report_outstanding"
                    WHERE "content" NOT ILIKE '%không có%' AND "content" NOT ILIKE '%khong co%' 
                      AND "content" IS NOT NULL AND "content" != '' AND "content" != '-'
                    ORDER BY "date" DESC, "created_at" DESC LIMIT 200
                `);

                const totalKpiCount = await this.prisma.larkKPI.count({ where: { OR: [{ state: { not: 'off' } }, { state: null }], report_date: { gte: new Date('2026-03-01T00:00:00Z') } } });


                const allKpiInDb = allKpiInDbRaw;

                const reportsUnfilteredCount = await this.prisma.larkReport.count({
                    where: whereClause,
                });

                if (isDoDaTeamFilter) {
                    // For DoDa filter, force avatar enrichment from users table.
                    this.logger.debug(
                        `[DoDa Avatar] userAvatar maps: byName=${userAvatarByName.size}, byCompact=${userAvatarByNameCompact.size}, byLoose=${userAvatarByNameLoose.size}`,
                    );
                    for (const kpi of allKpiInDb as any[]) {
                        const kpiEmail = (this.extractEmailFromKpi(kpi) || '').toLowerCase().trim();
                        const kpiName = normName((kpi as any).name || '');
                        const kpiNameCompact = compactNameKey((kpi as any).name || '');
                        const kpiNameLoose = looseNameKey((kpi as any).name || '');
                        const matchedEmail = (kpiEmail ? kpiEmail : null)
                            || (kpiName ? userEmailByName.get(kpiName) : null)
                            || (kpiNameCompact ? userEmailByNameCompact.get(kpiNameCompact) : null)
                            || null;
                        const avatar = (kpiEmail ? userAvatarByEmail.get(kpiEmail) : null)
                            || (kpiName ? userAvatarByName.get(kpiName) : null)
                            || (kpiNameCompact ? userAvatarByNameCompact.get(kpiNameCompact) : null)
                            || (kpiNameLoose ? userAvatarByNameLoose.get(kpiNameLoose) : null);
                        if (matchedEmail) {
                            (kpi as any).email = matchedEmail;
                        }
                        if (avatar) {
                            (kpi as any).image_url = avatar;
                            if (!(kpi as any).link_image) (kpi as any).link_image = avatar;
                        }
                    }
                }

                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/50a1c944-63a6-4094-af64-9a73a105402a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: 'kpi-team-debug-1', hypothesisId: 'H3', location: 'lark.service.ts:getUserActivityReports:afterFetch', message: 'Fetched base datasets', data: { reports: reports.length, kpisRaw: allKpiInDb.length, employees: employees.length, dailyReportKpis: dailyReportKpis.length, monthlyReportKpis: monthlyReportKpis.length, selectedTeam: filters?.team || 'All', useDbTeamFilter }, timestamp: Date.now() }) }).catch(() => { });
                // #endregion
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/50a1c944-63a6-4094-af64-9a73a105402a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: 'kpi-team-debug-1', hypothesisId: 'H8', location: 'lark.service.ts:getUserActivityReports:reportFilterGap', message: 'Compare report counts with/without team DB filter', data: { selectedTeam: filters?.team || 'All', reportsFilteredCount: reports.length, reportsUnfilteredCount, useDbTeamFilter }, timestamp: Date.now() }) }).catch(() => { });
                // #endregion
                const multiTeamUsersDebug = employees
                    .filter((u: any) => String(u?.team || '').includes(','))
                    .slice(0, 8)
                    .map((u: any) => {
                        const em = String(u?.email || '').toLowerCase().trim();
                        const nm = String(u?.full_name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' ');
                        const hasReport = reports.some((r: any) => {
                            const re = String(r?.email || '').toLowerCase().trim();
                            const rn = String(r?.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' ');
                            return (em && re === em) || (nm && rn === nm);
                        });
                        return { email: u.email, name: u.full_name, team: u.team, hasReport };
                    });
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/50a1c944-63a6-4094-af64-9a73a105402a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: 'kpi-team-debug-1', hypothesisId: 'H6', location: 'lark.service.ts:getUserActivityReports:multiTeamReportCoverage', message: 'Multi-team users report coverage in fetched reports', data: { selectedTeam: filters?.team || 'All', multiTeamUsersDebug }, timestamp: Date.now() }) }).catch(() => { });
                // #endregion

                // Filter KPIs that match ANY month in range (Secondary JS filter for safety with complex digits)
                let kpiData = allKpiInDb.filter(k => {
                    const mStr = (k.month || '').trim();

                    // If no month set on record, check report_date
                    if (!mStr) {
                        const rd = k.report_date ? new Date(k.report_date) : null;
                        if (!rd) return false;
                        const vn = getVietnamParts(rd);
                        return monthsInRange.some(m => vn.m === m.monthNum && vn.y === m.year);
                    }

                    // Match against our generated formats for each month in range
                    return monthsInRange.some(monthInfo => {
                        if (monthInfo.formats.includes(mStr)) return true;
                        // Flexible matching
                        const mDigits = mStr.match(/\d+/g);
                        if (mDigits && mDigits.some(d => parseInt(d, 10) === monthInfo.monthNum)) {
                            // If multiple digits, assume one might be the year
                            if (mDigits.length > 1) {
                                return mDigits.some(d => parseInt(d, 10) === monthInfo.year);
                            }
                            return true;
                        }
                        return false;
                    });
                });
                const targetDayKpis = kpiData.filter((k: any) => {
                    if (!k?.report_date) return false;
                    return isBitableKpiRowForSelection(k.report_date);
                });

                /** personKey → team on lark_kpi for the selected performance day */
                const personPerformanceTeamMap = new Map<string, string>();
                for (const kpi of targetDayKpis) {
                    const kTeam = String(kpi.team || '').trim();
                    if (!kTeam) continue;
                    const kName = kpi.name ? normName(kpi.name) : null;
                    const kEmail = (this.extractEmailFromKpi(kpi) || (kpi as any).email || '').toLowerCase().trim();
                    if (kEmail) personPerformanceTeamMap.set(kEmail, kTeam);
                    if (kName) personPerformanceTeamMap.set(kName, kTeam);
                }
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/50a1c944-63a6-4094-af64-9a73a105402a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: 'kpi-date-debug-v1', hypothesisId: 'H-date-window', location: 'lark.service.ts:getUserActivityReports:targetDayKpis', message: 'Computed target-day KPI rows from lark_kpi', data: { selectedSingleDay, uiStart: uiDayStartStr, uiEnd: uiDayEndStr, larkKpiStart: larkKpiStartOfDay.toISOString(), larkKpiEnd: larkKpiEndOfDay.toISOString(), kpiDataCount: kpiData.length, targetDayKpisCount: targetDayKpis.length, teamFilter: filters?.team || 'All' }, timestamp: Date.now() }) }).catch(() => { });
                // #endregion
                const globalIndoOrDaiLoanKpis = kpiData.filter((k: any) => {
                    const t = String(k?.team || '').toLowerCase();
                    return t.includes('global - indo') || t.includes('global-indo') || t.includes('global indo') || t.includes('global - đài') || t.includes('global - dai') || t.includes('global đài') || t.includes('global dai');
                });
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/50a1c944-63a6-4094-af64-9a73a105402a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: 'kpi-team-debug-1', hypothesisId: 'H4', location: 'lark.service.ts:getUserActivityReports:kpiFilterResult', message: 'Filtered KPI dataset', data: { kpiDataCount: kpiData.length, targetDayKpis: targetDayKpis.length, globalIndoOrDaiLoanKpis: globalIndoOrDaiLoanKpis.length, sampleTargetKpiDate: targetDayKpis[0]?.report_date || null }, timestamp: Date.now() }) }).catch(() => { });
                // #endregion

                this.logger.debug(`[Optimization] Parallel fetch completed. Reports: ${reports.length}, KPIs: ${kpiData.length}`);

                // Restore Map helpers and region logic
                const employeeMap = new Map<string, any>();
                const fullStatusMap = new Map<string, string>();
                const nameCountsAll = new Map<string, number>();
                employees.forEach((emp: any) => {
                    const nKey = normName(emp.full_name);
                    if (!nKey) return;
                    nameCountsAll.set(nKey, (nameCountsAll.get(nKey) || 0) + 1);
                });

                // Build status map for ALL users (active or not) to enable definitive status checks
                employees.forEach((emp: any) => {
                    const st = (emp.employee_status || emp.status || '').toLowerCase().trim();
                    const nKey = normName(emp.full_name);
                    const eKey = emp.email?.toLowerCase().trim();
                    // Name-based status is unsafe for duplicate names (can wrongly override ON with OFF).
                    // Only store status by name when that name is unique in users table.
                    if (nKey && (nameCountsAll.get(nKey) || 0) === 1) fullStatusMap.set(nKey, st);
                    if (eKey) fullStatusMap.set(eKey, st);
                    if (emp.employee_id) fullStatusMap.set(String(emp.employee_id).trim(), st);
                });

                // FILTER: Loại bỏ những người đã "Nghỉ việc" / "OFF" khỏi team list active
                const activeEmployees = employees.filter((emp: any) => {
                    const st = (emp.employee_status || emp.status || '').toLowerCase().trim();
                    return !st.includes('nghỉ') && !st.includes('off') && !st.includes('khóa');
                });
                const duplicateNameCounts = new Map<string, number>();
                activeEmployees.forEach((emp: any) => {
                    const nk = normName(emp.full_name);
                    if (!nk) return;
                    duplicateNameCounts.set(nk, (duplicateNameCounts.get(nk) || 0) + 1);
                });

                activeEmployees.forEach((emp: any) => {
                    const empRoles = (emp.roles || []) as string[];
                    // Ưu tiên role đã được enrich từ users table (leader/admin/manager),
                    // fallback về roles[] nếu có.
                    let empRole = String(emp.role || 'member').toLowerCase();
                    if (empRoles.includes('ADMIN')) empRole = 'admin';
                    else if (empRoles.includes('MANAGER')) empRole = 'manager';
                    else if (empRoles.includes('LEADER')) empRole = 'leader';

                    const row = {
                        employee_id: emp.employee_id,
                        name: emp.full_name,
                        email: emp.email,
                        team: emp.team,
                        image_url: emp.image_url,
                        status: emp.employee_status || emp.status,
                        role: empRole,
                        position: emp.employee_position || (empRole === 'leader' ? 'Leader' : empRole === 'manager' ? 'Manager' : 'Member'),
                    };
                    if (row.employee_id) employeeMap.set(String(row.employee_id).trim(), row);
                    if (emp.email) employeeMap.set(emp.email.toLowerCase().trim(), row);
                    if (row.name) {
                        // Dùng normName() closure đã memoize thay vì gọi chain trực tiếp
                        const nameKey = normName(row.name);
                        if (!employeeMap.has(nameKey)) employeeMap.set(nameKey, row);
                    }
                });

                const getRegionInternal = (teamName: string) => {
                    const t = (teamName || '').toLowerCase();
                    if (t.includes('global') || t.includes('thái lan') || t.includes('đài loan') || t.includes('indo') || t.includes('jp')) return 'global';
                    return 'vn';
                };

                const splitTeamList = (teamStr: string | null | undefined) =>
                    (teamStr || '').split(',').map((t) => t.trim()).filter(Boolean);

                const matchesTeamFilter = (teams: string[], filter: string | null) => {
                    if (!filter) return true;
                    if (filter === 'all global') {
                        return teams.some((t) => getRegionInternal(t.toLowerCase()) === 'global');
                    }
                    if (filter === 'all vn') {
                        return teams.some((t) => getRegionInternal(t.toLowerCase()) === 'vn');
                    }
                    const normFilter = normalizeTeamKey(filter);
                    return teams.some(
                        (t) =>
                            normalizeTeamKey(t.toLowerCase()) === normFilter ||
                            t.toLowerCase().trim() === filter,
                    );
                };

                /** Số kênh theo owner đã chuẩn hóa giống nameKey KPI — dùng để biết ai thật sự có kênh để báo traffic */
                const channelCountByNormOwner = new Map<string, number>();
                const channelCountByEmail = new Map<string, number>();
                const regionalChannelCounts = { vn: 0, global: 0 };
                let totalChannelsMatchingFilter = 0;
                const currentTeamFilter = filters?.team && filters.team !== 'All' ? filters.team.toLowerCase().trim() : null;

                allChannelsInDb.forEach(h => {
                    if (h.owner) {
                        const normalizedOwner = h.owner.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' ');
                        channelCountByNormOwner.set(
                            normalizedOwner,
                            (channelCountByNormOwner.get(normalizedOwner) || 0) + 1,
                        );

                        // Channel records don't have email; infer email from users table by owner name
                        const perm = employeeMap.get(normalizedOwner);
                        const inferredEmail = perm?.email ? String(perm.email).toLowerCase().trim() : null;
                        if (inferredEmail) {
                            channelCountByEmail.set(
                                inferredEmail,
                                (channelCountByEmail.get(inferredEmail) || 0) + 1,
                            );
                        }
                    }
                    const teamNorm = (h.team_traffic || '').toLowerCase().trim();
                    let isMatch = false;
                    if (!currentTeamFilter) isMatch = true;
                    else if (currentTeamFilter === 'all global') isMatch = getRegionInternal(teamNorm) === 'global';
                    else if (currentTeamFilter === 'all vn') isMatch = getRegionInternal(teamNorm) === 'vn';
                    else {
                        const normCurrent = normalizeTeamKey(currentTeamFilter);
                        const normTeam = normalizeTeamKey(teamNorm);
                        isMatch = normTeam === normCurrent || normTeam.includes(normCurrent) || normCurrent.includes(normTeam);
                    }

                    if (isMatch) {
                        const region = getRegionInternal(h.team_traffic || '');
                        regionalChannelCounts[region]++;
                        totalChannelsMatchingFilter++;
                    }
                });

                // Help track who reported traffic today
                const trafficMapByEmail = new Map();
                const trafficMapByName = new Map();
                allTrafficInDb.forEach(t => {
                    const nameKey = t.name ? t.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' ') : null;
                    if (!nameKey) return;

                    const perm = employeeMap.get(nameKey);
                    const inferredEmail = (t.email ? String(t.email).toLowerCase().trim() : null) || (perm?.email ? String(perm.email).toLowerCase().trim() : null);

                    const mergeTraffic = (existing: any, current: any) => {
                        const res = { ...existing };
                        if (!res.details) res.details = [];
                        const platforms = ['fb', 'ig', 'tiktok', 'yt', 'thread', 'lemon8', 'zalo', 'twitter'];
                        res.total_traffic = (res.total_traffic || BigInt(0)) + (current.total_traffic || BigInt(0));
                        platforms.forEach(p => {
                            const tk = `traffic_${p}`, ck = `channel_${p}`, ek = `evidence_${p}`;
                            const val = Number(current[tk] || 0);
                            res[tk] = (res[tk] || BigInt(0)) + (current[tk] || BigInt(0));
                            if (current[ck]) res[ck] = res[ck] ? `${res[ck]}, ${current[ck]}` : current[ck];
                            if (val > 0) {
                                let ev = [];
                                try { if (current[ek]) ev = JSON.parse(current[ek]); } catch (e) { }
                                res.details.push({ platform: p, channel: current[ck] || '', value: val, evidences: (Array.isArray(ev) ? ev : []).filter(e => e) });
                            }
                        });
                        return res;
                    };

                    const merged = trafficMapByName.has(nameKey) ? mergeTraffic(trafficMapByName.get(nameKey), t) : mergeTraffic({ total_traffic: BigInt(0) }, t);
                    trafficMapByName.set(nameKey, merged);

                    if (inferredEmail) {
                        const mergedMail = trafficMapByEmail.has(inferredEmail) ? mergeTraffic(trafficMapByEmail.get(inferredEmail), t) : mergeTraffic({ total_traffic: BigInt(0) }, t);
                        trafficMapByEmail.set(inferredEmail, mergedMail);
                    }
                });

                // Build helper map for team resolution (same as DashboardAnalytics)
                const nameToTeamMapLocal = new Map<string, string>();
                allKpiInDb.forEach(k => {
                    const rawName = k.name;
                    if (!rawName) return;
                    const nameKey = rawName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' ');
                    if (k.team && !k.team.startsWith('opt')) {
                        nameToTeamMapLocal.set(nameKey, k.team);
                    }
                });

                // Video completions are now sourced from KPI reports instead of ListTask to honor user request
                const taskVideosByGroup = { global: 0, vn: 0 };

                const reportKpiMapByEmail = new Map();
                const reportKpiMapByName = new Map();
                const monthlyKpiMapByEmail = new Map();
                const monthlyKpiMapByName = new Map();

                // Daily map (for report status on specific day) - Modified to AGGREGATE completed_day values
                // lark_report_kpi: cùng ngày lưu checklist (thường D+1 so với ngày hiệu suất trên UI).
                const isReportKpiOnAuxDay = (d: any) => tsInRange(d, memberReportStart, memberReportEnd);

                dailyReportKpis.forEach(rk => {
                    const date = new Date(rk.report_date || (rk as any).date);
                    const vn = getVietnamParts(date);
                    const timeKey = `${vn.m}_${vn.y}`;
                    const emailKey = rk.email?.toLowerCase().trim();
                    const nameKey = rk.name ? rk.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' ') : null;

                    const mergeUpdate = (existing: any, current: any) => {
                        const res = { ...existing };

                        // Use range comparison to avoid timezone mismatch from toDateString()
                        const currentIsTarget = isReportKpiOnAuxDay(current.report_date);
                        const existingIsTarget = isReportKpiOnAuxDay(existing.report_date);

                        if (currentIsTarget) {
                            res.completed_day = Number(current.completed_day) || 0;
                            res.report_date = current.report_date;
                        } else if (!existingIsTarget) {
                            res.completed_day = Math.max(Number(res.completed_day) || 0, Number(current.completed_day) || 0);
                            if (!existing.report_date || (current.report_date && new Date(current.report_date) > new Date(existing.report_date))) {
                                res.report_date = current.report_date;
                            }
                        }

                        res.kpi_day = Math.max(Number(res.kpi_day) || 0, Number(current.kpi_day) || 0);
                        res.task_auto = (Number(res.task_auto) || 0) + (Number(current.task_auto) || 0);
                        res.task_new = (Number(res.task_new) || 0) + (Number(current.task_new) || 0);

                        if (currentIsTarget || !res.kpi_status || res.kpi_status === 'N/A') {
                            res.kpi_status = current.kpi_status;
                            res.team = current.team || existing.team;
                        }

                        return res;
                    };

                    if (emailKey) {
                        const key = `${emailKey}_${timeKey}`;
                        reportKpiMapByEmail.set(key, reportKpiMapByEmail.has(key) ? mergeUpdate(reportKpiMapByEmail.get(key), rk) : { ...rk });
                    }
                    if (nameKey) {
                        const key = `${nameKey}_${timeKey}`;
                        reportKpiMapByName.set(key, reportKpiMapByName.has(key) ? mergeUpdate(reportKpiMapByName.get(key), rk) : { ...rk });
                    }
                });

                // Monthly map (latest in month for Summary)
                monthlyReportKpis.forEach(rk => {
                    const date = new Date(rk.report_date || (rk as any).date);
                    const vn = getVietnamParts(date);
                    const timeKey = `${vn.m}_${vn.y}`;
                    const emailKey = rk.email?.toLowerCase().trim();
                    const nameKey = rk.name ? rk.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' ') : null;

                    if (emailKey) {
                        const key = `${emailKey}_${timeKey}`;
                        const existing = monthlyKpiMapByEmail.get(key);
                        if (!existing || new Date(rk.report_date) > new Date(existing.report_date)) {
                            monthlyKpiMapByEmail.set(key, rk);
                        }
                    }
                    if (nameKey) {
                        const key = `${nameKey}_${timeKey}`;
                        const existing = monthlyKpiMapByName.get(key);
                        if (!existing || new Date(rk.report_date) > new Date(existing.report_date)) {
                            monthlyKpiMapByName.set(key, rk);
                        }
                    }
                });

                // Build helper map for target day resolution
                const nameToPersonKey = new Map();

                /** Same key as kpiData.forEach — used to align single-day KPI with targetDayKpis only */
                const getUnifiedPmk = (kpi: any, teamNorm: string, mInfo: any): string => {
                    const nameKey = kpi.name ? normName(kpi.name) : null;
                    const emailKey = kpi.email?.toLowerCase().trim();
                    const authUser = (emailKey ? emailKeyMatchMap.get(emailKey) : null) || (nameKey ? nameKeyMatchMap.get(nameKey) : null);

                    const pKey = authUser
                        ? (authUser.email?.toLowerCase().trim() || normName(authUser.full_name))
                        : (emailKey || nameKey || `unknown_k_${kpi.id}`);

                    return selectedSingleDay
                        ? `${pKey}_T${mInfo.monthNum}_${mInfo.year}`
                        : `${pKey}_${teamNorm}_T${mInfo.monthNum}_${mInfo.year}`;
                };

                const getAggKey = (pKey: string, teamNorm: string, mInfo: { monthNum: number; year: number }) =>
                    selectedSingleDay
                        ? `${pKey}_T${mInfo.monthNum}_${mInfo.year}`
                        : `${pKey}_${teamNorm}_T${mInfo.monthNum}_${mInfo.year}`;

                // --- 1. Checklist roster: seed from users.team (full team list for lark_reports) ---
                const kpisForAggregation = new Map<string, any>();
                if (selectedSingleDay) {
                    const monthInfo = monthsInRange[0];
                    employees.forEach((emp) => {
                        const empEmail = emp.email?.toLowerCase().trim();
                        const empNameKey = normName(emp.full_name);
                        const checklistTeams = splitTeamList(emp.team);

                        if (!matchesTeamFilter(checklistTeams, teamFilterNormalized)) return;

                        const pKey = empEmail || empNameKey;
                        if (!pKey) return;

                        const perfTeam =
                            (empEmail ? personPerformanceTeamMap.get(empEmail) : null) ||
                            (empNameKey ? personPerformanceTeamMap.get(empNameKey) : null) ||
                            '';
                        const pmk = getAggKey(pKey, normalizeTeamKey(checklistTeams[0] || 'khac'), monthInfo);

                        kpisForAggregation.set(pmk, {
                            employee_id: emp.employee_id,
                            name: emp.full_name,
                            email: emp.email,
                            team: perfTeam || null,
                            checklist_source_team: emp.team || null,
                            role: emp.role || 'member',
                            image_url: emp.image_url,
                            status: emp.status || 'on',
                            kpi_day: 0,
                            kpi_month: 0,
                            completed_day: 0,
                            completed_month: 0,
                            traffic_month: 0,
                            revenue_month: 0,
                            isAuthorizedForReport: true,
                        });
                    });

                    // --- 2. Hiệu suất roster: seed from lark_kpi.team on the selected day ---
                    for (const kpi of targetDayKpis) {
                        const kTeam = String(kpi.team || '').trim();
                        if (!kTeam) continue;
                        if (!matchesTeamFilter([kTeam], teamFilterNormalized)) continue;

                        const kName = kpi.name ? normName(kpi.name) : null;
                        const kEmail = (this.extractEmailFromKpi(kpi) || (kpi as any).email || '').toLowerCase().trim();
                        const authUser =
                            (kEmail ? emailKeyMatchMap.get(kEmail) : null) ||
                            (kName ? nameKeyMatchMap.get(kName) : null);
                        const pKey = authUser
                            ? (authUser.email?.toLowerCase().trim() || normName(authUser.full_name))
                            : (kEmail || kName || `unknown_k_${kpi.id}`);
                        if (!pKey) continue;

                        const pmk = getAggKey(pKey, normalizeTeamKey(kTeam), monthInfo);
                        const checklistTeam =
                            authUser?.team ||
                            (kEmail ? userTeamByEmail.get(kEmail) : null) ||
                            (kName ? userTeamByName.get(kName) : null) ||
                            null;

                        if (!kpisForAggregation.has(pmk)) {
                            kpisForAggregation.set(pmk, {
                                ...kpi,
                                name: authUser?.full_name || kpi.name,
                                email: authUser?.email || kpi.email,
                                team: kTeam,
                                checklist_source_team: checklistTeam,
                                role: authUser?.role || 'member',
                                image_url: authUser?.image_url || kpi.image_url,
                                status: authUser?.status || 'on',
                                kpi_day: 0,
                                kpi_month: 0,
                                completed_day: 0,
                                completed_month: 0,
                                traffic_month: 0,
                                revenue_month: 0,
                                isPerformanceSeeded: true,
                            });
                        } else {
                            const existing = kpisForAggregation.get(pmk);
                            existing.team = kTeam;
                            existing.isPerformanceSeeded = true;
                            existing.kpi_day = Number(kpi.kpi_day) > 0 ? Number(kpi.kpi_day) : Number(existing.kpi_day || 0);
                            existing.completed_day = Number(kpi.completed_day) || Number(existing.completed_day || 0);
                            existing.report_date = kpi.report_date || existing.report_date;
                            (existing as any).hasExactDayKpi = true;
                            if (!existing.checklist_source_team && checklistTeam) {
                                existing.checklist_source_team = checklistTeam;
                            }
                        }
                    }
                }

                const larkUserIdMatchMap = new Map<string, any>();
                employees.forEach(emp => {
                    if (emp.employee_id) {
                        larkUserIdMatchMap.set(String(emp.employee_id).trim(), emp);
                    }
                });

                /** Canonical person key — luôn ưu tiên email từ users (tránh lệch email vs name key). */
                const resolvePersonKey = (opts: {
                    email?: string | null;
                    name?: string | null;
                    employeeId?: string | null;
                    fallbackId?: string | null;
                }): string | null => {
                    const emailKey = String(opts.email || '').toLowerCase().trim();
                    if (emailKey) {
                        const byEmail = emailKeyMatchMap.get(emailKey);
                        if (byEmail?.email) return String(byEmail.email).toLowerCase().trim();
                        return emailKey;
                    }
                    const empId = String(opts.employeeId || '').trim();
                    if (empId) {
                        const byId = larkUserIdMatchMap.get(empId) || employeeMap.get(empId);
                        if (byId?.email) return String(byId.email).toLowerCase().trim();
                        const byIdName = byId?.full_name || byId?.name;
                        if (byIdName) return normName(byIdName);
                    }
                    const nameKey = opts.name ? normName(opts.name) : '';
                    if (nameKey) {
                        const byName = nameKeyMatchMap.get(nameKey);
                        if (byName?.email) return String(byName.email).toLowerCase().trim();
                        return nameKey;
                    }
                    return opts.fallbackId ? String(opts.fallbackId) : null;
                };

                const applyTargetDayKpiToAggregation = () => {
                    const targetByPerson = new Map<string, any>();
                    for (const kpi of targetDayKpis) {
                        const pk = resolvePersonKey({
                            email: this.extractEmailFromKpi(kpi),
                            name: kpi.name,
                            employeeId: kpi.employee_id,
                            fallbackId: kpi.id,
                        });
                        if (!pk) continue;
                        const prev = targetByPerson.get(pk);
                        if (!prev || new Date(kpi.report_date || 0).getTime() >= new Date(prev.report_date || 0).getTime()) {
                            targetByPerson.set(pk, kpi);
                        }
                    }
                    kpisForAggregation.forEach((agg) => {
                        const pk = resolvePersonKey({
                            email: agg.email,
                            name: agg.name,
                            employeeId: agg.employee_id,
                        });
                        const td = pk ? targetByPerson.get(pk) : null;
                        if (!td) return;
                        agg.kpi_day = Number(td.kpi_day) > 0 ? Number(td.kpi_day) : Number(agg.kpi_day || 0);
                        agg.completed_day = Number(td.completed_day) || 0;
                        agg.team = td.team || agg.team;
                        agg.report_date = td.report_date;
                        (agg as any).hasExactDayKpi = true;
                    });
                };

                kpiData.forEach(kpi => {
                    const nameKey = kpi.name ? normName(kpi.name) : null;
                    const emailKey = kpi.email?.toLowerCase().trim();

                    const kpiEmpId = kpi.employee_id ? String(kpi.employee_id).trim() : null;
                    const authUser = (emailKey ? emailKeyMatchMap.get(emailKey) : null) ||
                                     (kpiEmpId ? larkUserIdMatchMap.get(kpiEmpId) : null) ||
                                     (nameKey ? nameKeyMatchMap.get(nameKey) : null);

                    const pKey = resolvePersonKey({
                        email: emailKey || this.extractEmailFromKpi(kpi),
                        name: kpi.name,
                        employeeId: kpiEmpId,
                        fallbackId: `unknown_k_${kpi.id}`,
                    }) || `unknown_k_${kpi.id}`;

                    if (!pKey) return;

                    // Match month
                    const mStr = (kpi.month || '').trim();
                    const matchedMonth = monthsInRange.find(mInfo => {
                        if (mInfo.formats.includes(mStr)) return true;
                        const mDigits = mStr.match(/\d+/g);
                        return mDigits && mDigits.some(d => parseInt(d, 10) === mInfo.monthNum);
                    }) || monthsInRange[0];

                    const teamNorm = normalizeTeamKey(kpi.team || 'Khác');
                    const pmk = getAggKey(pKey, teamNorm, matchedMonth);

                    if (!kpisForAggregation.has(pmk)) {
                        kpisForAggregation.set(pmk, {
                            ...kpi,
                            name: authUser?.full_name || kpi.name,
                            email: authUser?.email || kpi.email,
                            team: kpi.team || null,
                            checklist_source_team:
                                authUser?.team ||
                                (emailKey ? userTeamByEmail.get(emailKey) : null) ||
                                (nameKey ? userTeamByName.get(nameKey) : null) ||
                                null,
                            role: authUser?.role || 'member',
                            image_url: authUser?.image_url || kpi.image_url,
                            status: authUser?.status || 'on',
                            kpi_day: 0,
                            kpi_month: 0,
                            completed_day: 0,
                            completed_month: 0,
                            traffic_month: 0,
                            revenue_month: 0
                        });
                    }

                    const existing = kpisForAggregation.get(pmk);
                    const currentIsTarget = isBitableKpiRowForSelection(kpi.report_date);
                    const existingIsTarget = isBitableKpiRowForSelection(existing.report_date);

                    if (currentIsTarget) {
                        existing.completed_day = Number(kpi.completed_day) || 0;
                        existing.report_date = kpi.report_date;
                        existing.kpi_day = (Number(kpi.kpi_day) > 0) ? Number(kpi.kpi_day) : existing.kpi_day;
                        if (kpi.team) existing.team = kpi.team;
                        (existing as any).hasExactDayKpi = true;
                    } else if (!existingIsTarget && !(existing as any).hasExactDayKpi) {
                        existing.completed_day = Math.max(Number(existing.completed_day) || 0, Number(kpi.completed_day) || 0);
                        existing.kpi_day = Math.max(Number(existing.kpi_day) || 0, Number(kpi.kpi_day) || 0);
                    }

                    existing.kpi_month = Math.max(Number(existing.kpi_month) || 0, Number(kpi.kpi_month) || 0);
                    existing.completed_month = Math.max(Number(existing.completed_month) || 0, Number(kpi.completed_month) || 0);

                    const cTraffic = BigInt(kpi.traffic_month || 0);
                    const eTraffic = BigInt(existing.traffic_month || 0);
                    if (cTraffic > eTraffic) existing.traffic_month = kpi.traffic_month;
                });

                // Single-day filter: gán KPI ngày từ lark_kpi theo person key thống nhất
                if (selectedSingleDay) {
                    applyTargetDayKpiToAggregation();
                }

                // Reports are processed next to enrich the kpisForAggregation set initialize above.

                // --- OPTIMIZATION: Process Daily Reports and Map to Authoritative Users ---
                reports.forEach(r => {
                    const nameKey = r.name ? normName(r.name) : null;
                    const emailKey = r.email?.toLowerCase().trim();
                    let authoritativeUser = (emailKey ? emailKeyMatchMap.get(emailKey) : null) || (nameKey ? nameKeyMatchMap.get(nameKey) : null);

                    // --- EXPLICIT OVERRIDE: Merge "Chung Đỗ" into "Đỗ Đăng Chung" ---
                    if (!authoritativeUser && (nameKey === 'chung do' || emailKey === 'dochung2741@gmail.com')) {
                        authoritativeUser = nameKeyMatchMap.get('do dang chung') || emailKeyMatchMap.get('dochung2741@gmail.com');
                    }

                    const pKey = authoritativeUser
                        ? (authoritativeUser.email?.toLowerCase().trim() || normName(authoritativeUser.full_name))
                        : (emailKey || nameKey || `unknown_r_${r.id}`);

                    // Checklist: users.team (supports multi-team). Fallback to report.team if user not found.
                    const checklistTeamStr =
                        authoritativeUser?.team ||
                        (emailKey ? userTeamByEmail.get(emailKey) : null) ||
                        (nameKey ? userTeamByName.get(nameKey) : null) ||
                        (r.team || '').trim() ||
                        '';
                    const checklistTeams = splitTeamList(checklistTeamStr);
                    const teams = checklistTeams.length
                        ? checklistTeams
                        : [(r.team || '').trim() || 'Khác'];

                    const vn = getVietnamParts(r.date ? new Date(r.date) : new Date());

                    teams.forEach(team => {
                        const teamNorm = normalizeTeamKey(team);
                        const personMonthKey = getAggKey(pKey, teamNorm, { monthNum: vn.m, year: vn.y });

                        if (!kpisForAggregation.has(personMonthKey)) {
                            kpisForAggregation.set(personMonthKey, {
                                id: `report_${r.id}_${teamNorm}`,
                                employee_id: authoritativeUser?.employee_id || null,
                                name: authoritativeUser?.full_name || r.name || r.email,
                                email: authoritativeUser?.email || r.email,
                                team: (emailKey ? personPerformanceTeamMap.get(emailKey) : null)
                                    || (nameKey ? personPerformanceTeamMap.get(nameKey) : null)
                                    || null,
                                checklist_source_team: checklistTeamStr || team,
                                kpi_day: 0,
                                kpi_month: 0,
                                completed_day: 0,
                                completed_month: 0,
                                traffic_month: 0,
                                revenue_month: 0,
                                kpi_progress_month: 0,
                                role: authoritativeUser?.role || 'member',
                                status: authoritativeUser?.status || 'on'
                            });
                        } else {
                            // Update existing card with authoritative info if available
                            const existing = kpisForAggregation.get(personMonthKey);
                            if (authoritativeUser?.full_name) existing.name = authoritativeUser.full_name;
                            if (authoritativeUser?.role) existing.role = authoritativeUser.role;
                            if (authoritativeUser?.email) existing.email = authoritativeUser.email;
                            if (!existing.checklist_source_team && checklistTeamStr) {
                                existing.checklist_source_team = checklistTeamStr;
                            }
                        }
                    });
                });

                if (selectedSingleDay) {
                    applyTargetDayKpiToAggregation();
                }

                const reportsByTeamMap = new Map<string, any>();
                reports.forEach(r => {
                    const rEmail = r.email?.toLowerCase().trim();
                    const rName = r.name ? normName(r.name) : null;
                    let authUser = (rEmail ? emailKeyMatchMap.get(rEmail) : null) || (rName ? nameKeyMatchMap.get(rName) : null);
                    
                    if (!authUser && (rName === 'chung do' || rEmail === 'dochung2741@gmail.com')) {
                        authUser = nameKeyMatchMap.get('do dang chung') || emailKeyMatchMap.get('dochung2741@gmail.com');
                    }
                    
                    // Checklist: index reports by users.team (supports multi-team members)
                    const checklistTeamStr =
                        authUser?.team ||
                        (rEmail ? userTeamByEmail.get(rEmail) : null) ||
                        (rName ? userTeamByName.get(rName) : null) ||
                        (r.team || '').trim() ||
                        '';
                    const rTeams = splitTeamList(checklistTeamStr);
                    if (rTeams.length === 0) {
                        const fallback = (r.team || '').trim() || 'Khác';
                        if (fallback) rTeams.push(fallback);
                    }
                    
                    rTeams.forEach(t => {
                        const rTeamNorm = normalizeTeamKey(t);
                        if (rEmail) reportsByTeamMap.set(`${rEmail}_${rTeamNorm}`, r);
                        if (rName) reportsByTeamMap.set(`${rName}_${rTeamNorm}`, r);
                        // Also index by auth user's email/name if different
                        if (authUser?.email) reportsByTeamMap.set(`${authUser.email.toLowerCase().trim()}_${rTeamNorm}`, r);
                        if (authUser?.full_name) reportsByTeamMap.set(`${normName(authUser.full_name)}_${rTeamNorm}`, r);
                    });
                });

                const allResults = Array.from(kpisForAggregation.values()).map(kpi => {
                    const nameKey = kpi.name?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' ') || '';

                    if (!nameKey || nameKey === 'unknown') return null;

                    const emailKey = kpi.email?.toLowerCase().trim();
                    const personEmp = employeeMap.get(nameKey) || (emailKey ? employeeMap.get(emailKey) : null);
                    const permEmailKey = personEmp?.email ? personEmp.email.toLowerCase().trim() : null;
                    const emailLookupKey = emailKey || permEmailKey;

                    // Pre-resolve checklist teams from users (before report lookup)
                    const preliminaryChecklistTeamStr =
                        personEmp?.team ||
                        kpi.checklist_source_team ||
                        (emailLookupKey ? userTeamByEmail.get(emailLookupKey) : null) ||
                        (nameKey ? userTeamByName.get(nameKey) : null) ||
                        '';
                    const preliminaryChecklistTeams = splitTeamList(preliminaryChecklistTeamStr);
                    const performanceTeam =
                        String(kpi.team || '').trim() ||
                        (emailLookupKey ? personPerformanceTeamMap.get(emailLookupKey) : null) ||
                        (nameKey ? personPerformanceTeamMap.get(nameKey) : null) ||
                        '';

                    // Match lark_report by checklist team (users), not lark_kpi team
                    let report: any = null;
                    const reportTeamCandidates = preliminaryChecklistTeams.length
                        ? preliminaryChecklistTeams
                        : splitTeamList(preliminaryChecklistTeamStr || performanceTeam || 'Khác');
                    for (const ct of reportTeamCandidates) {
                        const ctNorm = normalizeTeamKey(ct);
                        report =
                            (emailLookupKey ? reportsByTeamMap.get(`${emailLookupKey}_${ctNorm}`) : null) ||
                            (nameKey ? reportsByTeamMap.get(`${nameKey}_${ctNorm}`) : null);
                        if (report) break;
                    }

                    // AUTHORITATIVE USER RESOLUTION
                    const trimmedEmpId = kpi.employee_id?.trim();
                    const reportEmailLookupKey = report?.email ? String(report.email).toLowerCase().trim() : null;
                    const trustedEmailKey = emailLookupKey || reportEmailLookupKey;

                    const empByEmpId = trimmedEmpId ? employeeMap.get(trimmedEmpId) : null;
                    const empIdNameKey = empByEmpId ? normName(empByEmpId.name || '') : null;
                    const employee =
                        (trustedEmailKey ? employeeMap.get(trustedEmailKey) : null) ||
                        employeeMap.get(nameKey) ||
                        (empByEmpId && empIdNameKey === nameKey ? empByEmpId : null);

                    const resolvedByEmail = !!(trustedEmailKey && employeeMap.get(trustedEmailKey));
                    const resolvedByName = !resolvedByEmail && !!employeeMap.get(nameKey);
                    const resolvedByEmpId = !resolvedByEmail && !resolvedByName && !!(empByEmpId && empIdNameKey === nameKey);
                    if (resolvedByEmail) teamResolveStats.byEmail++;
                    else if (resolvedByName) teamResolveStats.byName++;
                    else if (resolvedByEmpId) teamResolveStats.byEmpId++;
                    else teamResolveStats.unresolved++;

                    // RESIGNED FILTERING
                    const employeeStatusDirect = String(employee?.status || '').toLowerCase().trim();
                    const currentStatus = employeeStatusDirect ||
                        fullStatusMap.get(emailLookupKey || '') ||
                        (!employee ? fullStatusMap.get(trimmedEmpId || '') : '') ||
                        fullStatusMap.get(nameKey) ||
                        '';
                    const kpiEmpStatus = (kpi.employee_status || '').toLowerCase().trim();
                    const kpiState = (kpi.state || '').toLowerCase().trim();

                    const isResigned = employeeStatusDirect.includes('nghỉ') || employeeStatusDirect.includes('off') || employeeStatusDirect.includes('khóa') ||
                        currentStatus.includes('nghỉ') || currentStatus.includes('off') || currentStatus.includes('khóa') ||
                        kpiEmpStatus.includes('nghỉ') || kpiEmpStatus.includes('off') || kpiState === 'off';

                    if (isResigned) return null;

                    const checklistTeamStr =
                        employee?.team ||
                        preliminaryChecklistTeamStr ||
                        report?.team ||
                        '';
                    const checklistTeams = splitTeamList(checklistTeamStr);

                    // Hiệu suất: lark_kpi.team | Checklist: users.team
                    const effectiveTeam = performanceTeam || checklistTeams[0] || 'Khác';
                    const checklistSourceTeam = checklistTeamStr || checklistTeams.join(', ') || effectiveTeam;

                    // Performance filter — lark_kpi team only
                    let isMatchForRanking = false;
                    const perfPool = performanceTeam ? [performanceTeam] : [];

                    if (!teamFilterNormalized) {
                        isMatchForRanking = perfPool.length > 0;
                    } else if (teamFilterNormalized === 'all global') {
                        isMatchForRanking = perfPool.some((t) => getRegionInternal(t.toLowerCase()) === 'global');
                    } else if (teamFilterNormalized === 'all vn') {
                        isMatchForRanking = perfPool.some((t) => getRegionInternal(t.toLowerCase()) === 'vn');
                    } else {
                        isMatchForRanking = matchesTeamFilter(perfPool, teamFilterNormalized);
                    }

                    const isChecklistTeamMatch = matchesTeamFilter(
                        checklistTeams.length ? checklistTeams : splitTeamList(checklistSourceTeam),
                        teamFilterNormalized,
                    );

                    const personEmailForSelf = report?.email || personEmp?.email || kpi.email;
                    const isSelf = filters?.requesterEmail && personEmailForSelf &&
                        personEmailForSelf.toLowerCase().trim() === filters.requesterEmail.toLowerCase().trim();

                    const hasExplicitTeamFilter = !!teamFilterNormalized;
                    // Checklist roster: users.team. Performance roster: lark_kpi.team (isMatchForRanking).
                    const isAuthorized = selectedSingleDay
                        ? (kpi.isAuthorizedForReport || isChecklistTeamMatch)
                        : (hasExplicitTeamFilter ? isChecklistTeamMatch : (isChecklistTeamMatch || isSelf));

                    if (!isAuthorized) return null;

                    // CHECKLIST PARSING
                    let checklist = { fb: false, ig: false, caption: false, tiktok: false, youtube: false, lark: false };
                    let answersData = report?.answers;
                    if (typeof answersData === 'string') { try { answersData = JSON.parse(answersData); } catch (e) { } }
                    if (answersData && typeof answersData === 'object') {
                        checklist.fb = answersData['Bạn đã đăng video lên FB chưa?'] === true || answersData['Báo cáo Lark - Bạn đã đăng video lên FB chưa?'] === true || false;
                        checklist.ig = answersData['Bạn đã đăng video lên IG chưa?'] === true || answersData['Báo cáo Lark - Bạn đã đăng video lên IG chưa?'] === true || false;
                        checklist.tiktok = answersData['Bạn đã đăng video lên Tiktok chưa?'] === true || answersData['Báo cáo Lark - Bạn đã đăng video lên Tiktok chưa?'] === true || false;
                        checklist.youtube = answersData['Bạn đã đăng video lên Youtube chưa?'] === true || answersData['Báo cáo Lark - Bạn đã đăng video lên Youtube chưa?'] === true || false;
                        checklist.lark = answersData['Bạn đã báo cáo đầy đủ thông tin công việc trên lark chưa?'] === true || answersData['Báo cáo Lark - Bạn đã báo cáo đầy đủ thông tin công việc trên lark chưa?'] === true || false;
                        checklist.caption = answersData['Bạn đã check lại caption và hagtag video chưa?'] === true || answersData['Báo cáo Lark - Bạn đã check lại caption và hagtag video chưa?'] === true;
                    }

                    // FINAL OBJECT ASSEMBLY
                    let kpiMonthForFinal = 0;
                    let kpiYearForFinal = 0;
                    const mStrFinal = (kpi.month || '').trim();
                    const matchedMonthFinal = monthsInRange.find(m => m.formats.includes(mStrFinal)) || monthsInRange[0];
                    kpiMonthForFinal = matchedMonthFinal.monthNum;
                    kpiYearForFinal = matchedMonthFinal.year;

                    const timeKey = `${kpiMonthForFinal}_${kpiYearForFinal}`;
                    const emailKeyFinal = kpi.email?.toLowerCase().trim();
                    const nkFinal = kpi.name ? normName(kpi.name) : null;
                    const rKpi = (emailKeyFinal ? reportKpiMapByEmail.get(`${emailKeyFinal}_${timeKey}`) : null) ||
                        (nkFinal ? reportKpiMapByName.get(`${nkFinal}_${timeKey}`) : null);

                    // Get the specific month key for this KPI record to lookup reportKpi
                    let kpiMonth = 0;
                    let kpiYear = 0;
                    const mStr = (kpi.month || '').trim();
                    const matchedMonth = monthsInRange.find(mInfo => {
                        if (mInfo.formats.includes(mStr)) return true;
                        const mDigits = mStr.match(/\d+/g);
                        return mDigits && mDigits.some(d => parseInt(d, 10) === mInfo.monthNum);
                    }) || monthsInRange[0];
                    kpiMonth = matchedMonth.monthNum;
                    kpiYear = matchedMonth.year;
                    // Use the timeKey calculated during FINAL OBJECT ASSEMBLY
                    // const timeKey = `${kpiMonth}_${kpiYear}`;

                    // Get high-fidelity KPI report data for this specific person and month
                    const rKpiEmailKey = report?.email ? `${report.email.toLowerCase().trim()}_${timeKey}` : null;
                    const rKpiNameKey = `${nameKey}_${timeKey}`;

                    const reportKpi = (rKpiEmailKey ? reportKpiMapByEmail.get(rKpiEmailKey) : null) ||
                        reportKpiMapByName.get(rKpiNameKey);

                    // --- FIX: Lookup monthly stable KPI for Summary Cards ---
                    const monthlyReportKpi = (rKpiEmailKey ? monthlyKpiMapByEmail.get(rKpiEmailKey) : null) ||
                        monthlyKpiMapByName.get(rKpiNameKey);

                    const nowVn = getVietnamParts();
                    const isCurrentMonth = matchedMonth.monthNum === nowVn.m && matchedMonth.year === nowVn.y;
                    const incrementalTraffic = isCurrentMonth && answersData ? Number(answersData['Bạn đã đạt bao nhiêu traffic cho video mới?']) || 0 : 0;
                    const incrementalRevenue = isCurrentMonth && answersData ? Number(answersData['Bạn đã đạt doanh thu của bao nhiêu video?']) || 0 : 0;
                    const isRange = filters?.timeType && !['today', 'yesterday'].includes(filters.timeType);
                    // "today" is the only case where we must show 0 when no daily report exists yet.
                    // For "yesterday" and all range filters (week/month/custom), the larkKPI table's
                    // completed_day is the recorded value and IS valid as a fallback.
                    const isViewingToday = !filters?.timeType || filters.timeType === 'today';

                    const personEmail = report?.email || reportKpi?.email || personEmp?.email;
                    const normalizedEmail = personEmail?.toLowerCase().trim();
                    const channelsOwnedCount = Math.max(
                        channelCountByNormOwner.get(nameKey) || 0,
                        normalizedEmail ? channelCountByEmail.get(normalizedEmail) || 0 : 0,
                    );
                    const needsTraffic = channelsOwnedCount > 0;
                    const trafficObj = (normalizedEmail ? trafficMapByEmail.get(normalizedEmail) : null) || trafficMapByName.get(nameKey);
                    const hasTraffic = !!trafficObj;

                    let effectiveStatus = 'CHƯA BÁO CÁO';
                    const baseReported = !!(report || reportKpi);

                    if (baseReported) {
                        if (needsTraffic) {
                            effectiveStatus = hasTraffic ? 'ĐÃ BÁO CÁO ĐỦ' : 'CHƯA BÁO CÁO TRAFFIC';
                        } else {
                            effectiveStatus = 'ĐÃ BÁO CÁO ĐỦ';
                        }
                    } else if (hasTraffic) {
                        effectiveStatus = 'CHƯA BÁO CÁO MEMBER';
                    } else {
                        effectiveStatus = 'CHƯA BÁO CÁO';
                    }

                    let effectiveDate = report?.created_at || report?.date || reportKpi?.created_at || reportKpi?.report_date || null;
                    if (hasTraffic && trafficObj) {
                        effectiveDate = trafficObj.created_at || trafficObj.date || effectiveDate;
                    }

                    // Lookup daily traffic for this person
                    const personTraffic = (normalizedEmail ? trafficMapByEmail.get(normalizedEmail) : null) || trafficMapByName.get(nameKey) || null;

                    const resolvedAvatar =
                        this.convertDriveUrl(employee?.image_url) ||
                        this.convertDriveUrl(
                            (emailLookupKey ? userAvatarByEmail.get(emailLookupKey) : null) ||
                            (nameKey ? userAvatarByName.get(nameKey) : null) ||
                            (compactNameKey(kpi.name || '') ? userAvatarByNameCompact.get(compactNameKey(kpi.name || '')) : null) ||
                            (looseNameKey(kpi.name || '') ? userAvatarByNameLoose.get(looseNameKey(kpi.name || '')) : null),
                        ) ||
                        this.convertDriveUrl(this.rkReportAvatar(reportKpi)) ||
                        this.convertDriveUrl(kpi.link_image) ||
                        this.convertDriveUrl(kpi.image_url) ||
                        null;

                    return {
                        id: kpi.id,
                        employee_id: trimmedEmpId,
                        personKey: emailLookupKey || nameKey,
                        name: kpi.name,
                        position: employee?.position || (employee?.role === 'leader' ? 'Leader' : 'Member'),
                        // Role: ưu tiên lấy từ chính employee (bảng users)
                        // Role: ưu tiên lấy từ chính employee (bảng users)
                        role: employee?.role || personEmp?.role || kpi._empRole || 'member',
                        email: personEmail || null,
                        team: effectiveTeam,
                        checklist_source_team: checklistSourceTeam,
                        avatar: resolvedAvatar,
                        image_url: resolvedAvatar,
                        tag: kpi.tag || kpi.name || null,
                        status: effectiveStatus,
                        employee_status: employee?.status || personEmp?.status || kpi.employee_status || null,
                        date: effectiveDate,
                        checklist,
                        answers: answersData,
                        videoCount: answersData ? Number(answersData[Object.keys(answersData).find(k => k.toLowerCase().includes('50%')) || ''] || 0) : 0,
                        // Use larkKPI (leader-entered Lark data) as source of truth for daily KPI.
                        // Do NOT override with larkReportKPI (completed_day there = 0 for checklist
                        // submissions and would incorrectly mask the leader-entered completion value).
                        dailyGoal: Number(kpi.kpi_day || 0),
                        done: Number(kpi.completed_day || 0),
                        kpi_day: Number(kpi.kpi_day || 0),
                        kpi_month: kpi.kpi_month || monthlyReportKpi?.kpi_month || 0,
                        completed_day: Number(kpi.completed_day || 0),
                        completed_month: (monthlyReportKpi ? Number(monthlyReportKpi.completed_month) : (kpi.completed_month || 0)),
                        // Stable monthly traffic/revenue for the Summary Cards:
                        traffic_range: (monthlyReportKpi ? Number(monthlyReportKpi.traffic_month || 0) : Number(kpi.traffic_month || 0)) + incrementalTraffic,
                        revenue_range: (monthlyReportKpi ? Number(monthlyReportKpi.revenue_month || 0) : Number(kpi.revenue_month || 0)) + incrementalRevenue,
                        task_progress: reportKpi ? {
                            task_auto: reportKpi.task_auto || 0,
                            task_new: reportKpi.task_new || 0,
                            kpi_status: reportKpi.kpi_status || 'N/A'
                        } : {
                            // Only suppress (show 0) when viewing today with no submission yet.
                            // Past dates and range views fall back to larkKPI recorded values.
                            task_auto: isViewingToday ? 0 : (kpi.task_auto || 0),
                            task_new: isViewingToday ? 0 : (kpi.task_new || 0),
                            kpi_status: isViewingToday ? 'N/A' : (kpi.kpii_status || 'N/A')
                        },
                        traffic_month: Math.max(Number(monthlyReportKpi?.traffic_month || 0), Number(kpi.traffic_month || 0)),
                        revenue_month: Math.max(Number(monthlyReportKpi?.revenue_month || 0), Number(kpi.revenue_month || 0)),
                        trafficTarget: parseInt(kpi.target_traffic_month || '0') || 0,
                        revenueTarget: parseInt(kpi.target_revenue_month || '0') || 0,
                        monthlyProgress: kpi.kpi_progress_month !== null ? Math.round(Number(kpi.kpi_progress_month) * 100) : ((kpi.kpi_month || 0) > 0 ? Math.round((kpi.completed_month || 0) / kpi.kpi_month * 100) : 0),
                        channelCount: channelsOwnedCount,
                        isAuthorizedForReport: isAuthorized as boolean,
                        isMatchForRanking,
                        needsTraffic,
                        // Daily traffic per platform
                        trafficToday: personTraffic ? {
                            fb: Number(personTraffic.traffic_fb || 0),
                            ig: Number(personTraffic.traffic_ig || 0),
                            tiktok: Number(personTraffic.traffic_tiktok || 0),
                            yt: Number(personTraffic.traffic_yt || 0),
                            thread: Number(personTraffic.traffic_thread || 0),
                            lemon8: Number(personTraffic.traffic_lemon8 || 0),
                            zalo: Number(personTraffic.traffic_zalo || 0),
                            twitter: Number(personTraffic.traffic_twitter || 0),
                            total: Number(personTraffic.total_traffic || 0),
                            details: personTraffic.details || []
                        } : null,
                    };
                });

                // --- Bổ sung báo cáo của user không có KPI (như test account Google) ---
                reports.forEach(report => {
                    const rEmailKey = report.email ? report.email.toLowerCase().trim() : '';
                    const rNameKey = report.name ? report.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' ') : '';
                    if (!rEmailKey && !rNameKey) return;

                    const isAlreadyIncluded = allResults.some(r => {
                        if (!r) return false;
                        const e = r.email ? r.email.toLowerCase().trim() : '';
                        const n = r.name ? r.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' ') : '';
                        return (rEmailKey && e === rEmailKey) || (rNameKey && n === rNameKey);
                    });

                    if (!isAlreadyIncluded) {
                        let checklist = { fb: false, ig: false, caption: false, tiktok: false, youtube: false, lark: false };
                        let answersData = report.answers;
                        if (typeof answersData === 'string') {
                            try { answersData = JSON.parse(answersData); } catch (e) { }
                        }
                        if (answersData && typeof answersData === 'object') {
                            checklist.fb = answersData['Bạn đã đăng video lên FB chưa?'] === true || answersData['Báo cáo Lark - Bạn đã đăng video lên FB chưa?'] === true || false;
                            checklist.ig = answersData['Bạn đã đăng video lên IG chưa?'] === true || answersData['Báo cáo Lark - Bạn đã đăng video lên IG chưa?'] === true || false;
                            checklist.tiktok = answersData['Bạn đã đăng video lên Tiktok chưa?'] === true || answersData['Báo cáo Lark - Bạn đã đăng video lên Tiktok chưa?'] === true || false;
                            checklist.youtube = answersData['Bạn đã đăng video lên Youtube chưa?'] === true || answersData['Báo cáo Lark - Bạn đã đăng video lên Youtube chưa?'] === true || false;
                            checklist.lark = answersData['Bạn đã báo cáo đầy đủ thông tin công việc trên lark chưa?'] === true || answersData['Báo cáo Lark - Bạn đã báo cáo đầy đủ thông tin công việc trên lark chưa?'] === true || false;
                            checklist.caption = answersData['Bạn đã check lại caption và hagtag video chưa?'] === true || answersData['Báo cáo Lark - Bạn đã check lại caption và hagtag video chưa?'] === true;
                        }

                        // Lookup employee data for perfect role/team match
                        const employee =
                            (rEmailKey ? employeeMap.get(rEmailKey) : null) ||
                            (rNameKey ? employeeMap.get(rNameKey) : null);

                        // Use users.team for checklist; lark_kpi.team for performance ranking
                        const reportOwnTeam = (report.team || '').trim();
                        const employeeChecklistTeam = employee?.team || '';
                        const checklistTeamStr =
                            employeeChecklistTeam ||
                            (rEmailKey ? userTeamByEmail.get(rEmailKey) : null) ||
                            (rNameKey ? userTeamByName.get(rNameKey) : null) ||
                            reportOwnTeam ||
                            '';
                        const checklistTeams = splitTeamList(checklistTeamStr);
                        const performanceTeam =
                            (rEmailKey ? personPerformanceTeamMap.get(rEmailKey) : null) ||
                            (rNameKey ? personPerformanceTeamMap.get(rNameKey) : null) ||
                            '';
                        const userTeamsRep = checklistTeams.length ? checklistTeams : (reportOwnTeam ? [reportOwnTeam] : []);
                        let displayTeamRep: string;
                        if (performanceTeam) {
                            displayTeamRep = performanceTeam;
                        } else if (userTeamsRep.length > 0) {
                            displayTeamRep = userTeamsRep[0];
                        } else if (employee) {
                            displayTeamRep = 'Khác';
                        } else {
                            displayTeamRep = report.team || 'Khác';
                        }

                        let isMatchForRanking = !!performanceTeam;
                        if (performanceTeam && teamFilterNormalized) {
                            isMatchForRanking = matchesTeamFilter([performanceTeam], teamFilterNormalized);
                        } else if (!performanceTeam) {
                            isMatchForRanking = false;
                        }

                        const isChecklistTeamMatch = matchesTeamFilter(
                            userTeamsRep.length ? userTeamsRep : splitTeamList(displayTeamRep),
                            teamFilterNormalized,
                        );
                        const isAuthorized = isChecklistTeamMatch;

                        const repChannelsOwned = Math.max(
                            channelCountByNormOwner.get(rNameKey) || 0,
                            rEmailKey ? channelCountByEmail.get(rEmailKey) || 0 : 0,
                        );
                        const repNeedsTraffic = repChannelsOwned > 0;

                        // Daily traffic per platform for cards (same shape as KPI branch)
                        const personTraffic =
                            (rEmailKey ? trafficMapByEmail.get(rEmailKey) : null) ||
                            (rNameKey ? trafficMapByName.get(rNameKey) : null) ||
                            null;

                        // Strong OFF filter for fallback rows (users/reports without KPI row)
                        const repStatusRaw = String(
                            employee?.status ||
                            (rEmailKey ? fullStatusMap.get(rEmailKey) : '') ||
                            (rNameKey ? fullStatusMap.get(rNameKey) : '') ||
                            '',
                        ).toLowerCase().trim();
                        const repIsResigned =
                            repStatusRaw.includes('nghỉ') ||
                            repStatusRaw.includes('off') ||
                            repStatusRaw.includes('khóa');
                        if (repIsResigned) return;

                        const fallbackAvatar =
                            this.convertDriveUrl(employee?.image_url) ||
                            this.convertDriveUrl(
                                (rEmailKey ? userAvatarByEmail.get(rEmailKey) : null) ||
                                (rNameKey ? userAvatarByName.get(rNameKey) : null) ||
                                (compactNameKey(report.name || '') ? userAvatarByNameCompact.get(compactNameKey(report.name || '')) : null) ||
                                (looseNameKey(report.name || '') ? userAvatarByNameLoose.get(looseNameKey(report.name || '')) : null),
                            ) ||
                            null;
                        allResults.push({
                            id: report.id,
                            employee_id: employee?.employee_id || null, // fallback
                            personKey: rEmailKey || `${rNameKey || 'unknown'}|${displayTeamRep.toLowerCase().trim()}` || report.id,
                            name: report.name,
                            position: employee?.position || report.role || 'Member',
                            role: employee?.role || report.role || 'Member',
                            email: report.email,
                            team: displayTeamRep,
                            checklist_source_team: checklistTeamStr || displayTeamRep,
                            avatar: fallbackAvatar,
                            image_url: fallbackAvatar,
                            tag: report.name,
                            status: 'Đã báo cáo',
                            employee_status: employee?.status || repStatusRaw || null,
                            date: report.date || report.created_at,
                            checklist,
                            answers: answersData,
                            videoCount: answersData ? Number(answersData[Object.keys(answersData).find(k => k.toLowerCase().includes('50%')) || ''] || 0) : 0,
                            dailyGoal: 0,
                            done: 0,
                            kpi_day: 0,
                            kpi_month: 0,
                            completed_day: 0,
                            completed_month: 0,
                            traffic_range: 0,
                            revenue_range: 0,
                            task_progress: { task_auto: 0, task_new: 0, kpi_status: 'N/A' },
                            traffic_month: 0,
                            revenue_month: 0,
                            trafficTarget: 0,
                            revenueTarget: 0,
                            monthlyProgress: 0,
                            channelCount: repChannelsOwned,
                            isAuthorizedForReport: isAuthorized,
                            isMatchForRanking,
                            needsTraffic: repNeedsTraffic,
                            trafficToday: personTraffic
                                ? {
                                    fb: Number(personTraffic.traffic_fb || 0),
                                    ig: Number(personTraffic.traffic_ig || 0),
                                    tiktok: Number(personTraffic.traffic_tiktok || 0),
                                    yt: Number(personTraffic.traffic_yt || 0),
                                    thread: Number(personTraffic.traffic_thread || 0),
                                    lemon8: Number(personTraffic.traffic_lemon8 || 0),
                                    zalo: Number(personTraffic.traffic_zalo || 0),
                                    twitter: Number(personTraffic.traffic_twitter || 0),
                                    total: Number(personTraffic.total_traffic || 0),
                                    details: personTraffic.details || [],
                                }
                                : null,
                        });
                    }
                });

                // #region agent log removed due to corrupted variables
                // #endregion
                const preGroupDupStats = { duplicateKeys: 0, duplicateRows: 0, duplicateRowsWithNonZeroDaily: 0 };
                const preGroupByKey = new Map<string, any[]>();
                allResults.filter(r => r !== null).forEach((r: any) => {
                    const baseKey = r.personKey || r.email?.toLowerCase().trim() || r.name?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' ') || r.employee_id;
                    const rowTeamNorm = normalizeTeamKey(String(r.team || 'khac').toLowerCase());
                    const key = `${baseKey}_${rowTeamNorm}`;
                    const arr = preGroupByKey.get(key) || [];
                    arr.push(r);
                    preGroupByKey.set(key, arr);
                });
                preGroupByKey.forEach((rows) => {
                    if (rows.length <= 1) return;
                    preGroupDupStats.duplicateKeys += 1;
                    preGroupDupStats.duplicateRows += rows.length;
                    if (rows.some((x: any) => Number(x?.kpi_day || 0) > 0 || Number(x?.completed_day || 0) > 0)) {
                        preGroupDupStats.duplicateRowsWithNonZeroDaily += rows.length;
                    }
                });
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/50a1c944-63a6-4094-af64-9a73a105402a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hypothesisId: 'H-kpi-grouping', location: 'lark.service.ts:getUserActivityReports:preGroupDupStats', message: 'Pre-group duplicate person keys and daily KPI risk', data: { teamFilter: filters?.team || 'All', ...preGroupDupStats, totalRows: allResults.filter(r => r !== null).length }, timestamp: Date.now(), runId: 'team-kpi-debug-v1' }) }).catch(() => { });
                // #endregion

                // --- NEW: Group by Person to aggregate stats across months if viewing range ---
                const groupedResults = new Map();
                allResults.filter(r => r !== null).forEach(r => {
                    // Filter out OFF users globally
                    const statusStr = String(r.employee_status || '').toLowerCase().trim();
                    if (statusStr.includes('nghỉ') || statusStr.includes('off') || statusStr.includes('khóa')) {
                        return; // skip this off/inactive member
                    }
                    if (r.name && (r.name.toLowerCase().includes('nghỉ') || r.name.toLowerCase().includes('off'))) {
                        return; // skip off member based on name
                    }
                    // Use a unified identity to prevent duplicate cards for the same person
                    const nameKeyRep = r.name ? normName(r.name) : null;
                    const emailKeyRep = r.email?.toLowerCase().trim();
                    const authoritativeUser = (emailKeyRep ? employeeMap.get(emailKeyRep) : null) || (nameKeyRep ? employeeMap.get(nameKeyRep) : null);

                    // Include team in key to prevent cross-team data summing
                    // (e.g. Hồ Đạt Team K1 completed=3 + Đồ Da completed=4 = 7 bug)
                    const teamKeyPart = normalizeTeamKey(r.team || 'khac');
                    const key = (authoritativeUser
                        ? (authoritativeUser.email?.toLowerCase().trim() || normName(authoritativeUser.full_name))
                        : (r.personKey || emailKeyRep || nameKeyRep || r.employee_id))
                        + '_' + teamKeyPart;

                    if (!groupedResults.has(key)) {
                        const newObj = { ...r };
                        if (authoritativeUser) {
                            // Giữ lark_kpi.team cho hiệu suất; users.team cho checklist
                            newObj.team = r.team || newObj.team;
                            newObj.checklist_source_team = authoritativeUser.team || r.checklist_source_team || newObj.checklist_source_team;
                            newObj.role = authoritativeUser.role || r.role;
                            newObj.avatar = authoritativeUser.image_url || r.avatar;
                            newObj.image_url = authoritativeUser.image_url || r.image_url;
                            newObj.position = authoritativeUser.position || (authoritativeUser.role === 'leader' ? 'Leader' : 'Member');
                        }
                        groupedResults.set(key, newObj);
                    } else {
                        const existing = groupedResults.get(key);
                        if ((r as any).hasExactDayKpi && !(existing as any).hasExactDayKpi) {
                            existing.kpi_day = r.kpi_day;
                            existing.dailyGoal = r.dailyGoal;
                            existing.completed_day = r.completed_day;
                            existing.done = r.done;
                            existing.team = r.team || existing.team;
                            (existing as any).hasExactDayKpi = true;
                        }
                        // Sum numeric RESULTS
                        existing.done += r.done;
                        existing.videoCount += r.videoCount;
                        existing.traffic_range += r.traffic_range;
                        existing.revenue_range += r.revenue_range;
                        existing.completed_day += r.completed_day;
                        existing.completed_month += r.completed_month;
                        existing.traffic_month += r.traffic_month;
                        existing.revenue_month += r.revenue_month;

                        // TARGETS: Use latest or max, DO NOT SUM
                        // If we have an exact day match in one of the records, prioritize its kpi_day
                        if ((r as any).hasExactDayKpi) {
                            existing.kpi_day = r.kpi_day;
                            existing.dailyGoal = r.dailyGoal;
                            (existing as any).hasExactDayKpi = true;
                        } else if (!(existing as any).hasExactDayKpi) {
                            existing.kpi_day = Math.max(existing.kpi_day, r.kpi_day);
                            existing.dailyGoal = (r.dailyGoal > 0) ? r.dailyGoal : existing.dailyGoal;
                        }

                        existing.kpi_month = Math.max(existing.kpi_month, r.kpi_month);
                        existing.trafficTarget = Math.max(existing.trafficTarget, r.trafficTarget);
                        existing.revenueTarget = Math.max(existing.revenueTarget, r.revenueTarget);

                        existing.channelCount = Math.max(existing.channelCount, r.channelCount);
                        if (typeof (r as any).needsTraffic === 'boolean') {
                            (existing as any).needsTraffic = Boolean(
                                (existing as any).needsTraffic || (r as any).needsTraffic,
                            );
                        }
                        // Keep metadata from latest record (assuming allResults is somewhat chronological or month-indexed)
                        if (r.date && (!existing.date || new Date(r.date) > new Date(existing.date))) {
                            existing.date = r.date;
                            existing.status = r.status;
                            existing.avatar = r.avatar || existing.avatar;
                            // Use latest qualitative data
                            existing.checklist = r.checklist;
                            existing.answers = r.answers;
                            if (typeof (r as any).needsTraffic === 'boolean') {
                                (existing as any).needsTraffic = (r as any).needsTraffic;
                            }
                        }
                    }
                });

                const allValidResults = Array.from(groupedResults.values());

                // ── DoDa avatar: lấy thẳng image_url từ bảng users, không qua pipeline KPI ──
                if (isDoDaTeamFilter) {
                    this.logger.log(`[DoDa-Avatar] lastmile: allValidResults=${allValidResults.length}, allUsersForTeam=${allUsersForTeam.length}`);
                    // Build name→avatar map trực tiếp từ users (đã fetch ở trên với image_url)
                    const dodaAvatarByName = new Map<string, string>();
                    const dodaAvatarByEmail = new Map<string, string>();
                    for (const u of allUsersForTeam as any[]) {
                        const raw = String(u?.image_url || '').trim();
                        if (!raw) continue;
                        const nk = normName(String(u?.full_name || ''));
                        if (nk) dodaAvatarByName.set(nk, raw);
                        const ek = String(u?.email || '').toLowerCase().trim();
                        if (ek) dodaAvatarByEmail.set(ek, raw);
                    }
                    // Gán avatar cho từng card — luôn ưu tiên users.image_url, bỏ qua giá trị cũ
                    for (const r of allValidResults as any[]) {
                        const nk = normName(String(r?.name || ''));
                        const ek = String(r?.email || '').toLowerCase().trim();
                        const raw =
                            (ek ? dodaAvatarByEmail.get(ek) : null) ||
                            (nk ? dodaAvatarByName.get(nk) : null) ||
                            null;
                        r.avatar = this.convertDriveUrl(raw) || r.avatar || null;
                        if (r.avatar) (r as any).image_url = r.avatar;
                    }
                }
                const preGroupNonZeroDaily = allResults.filter((r: any) => r !== null && (Number(r?.kpi_day || 0) > 0 || Number(r?.completed_day || 0) > 0)).length;
                const postGroupNonZeroDaily = allValidResults.filter((r: any) => Number(r?.kpi_day || 0) > 0 || Number(r?.completed_day || 0) > 0).length;
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/50a1c944-63a6-4094-af64-9a73a105402a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hypothesisId: 'H-kpi-grouping', location: 'lark.service.ts:getUserActivityReports:postGroupDailyCounts', message: 'Compare non-zero daily KPI rows pre/post grouping', data: { teamFilter: filters?.team || 'All', preGroupNonZeroDaily, postGroupNonZeroDaily, groupedCount: allValidResults.length }, timestamp: Date.now(), runId: 'team-kpi-debug-v1' }) }).catch(() => { });
                // #endregion
                const teamBuckets = allValidResults.reduce((acc: any, r: any) => {
                    const team = String(r?.team || 'Khác');
                    acc[team] = (acc[team] || 0) + 1;
                    return acc;
                }, {});
                const zeroDailyCount = allValidResults.filter((r: any) => Number(r?.kpi_day || 0) === 0 && Number(r?.completed_day || 0) === 0).length;
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/50a1c944-63a6-4094-af64-9a73a105402a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: 'kpi-team-debug-1', hypothesisId: 'H5', location: 'lark.service.ts:getUserActivityReports:finalResults', message: 'Built final results after grouping', data: { allValidResults: allValidResults.length, zeroDailyCount, teamBuckets }, timestamp: Date.now() }) }).catch(() => { });
                // #endregion
                const multiTeamResultDebug = allValidResults
                    .filter((r: any) => String(r?.team || '').includes(','))
                    .slice(0, 8)
                    .map((r: any) => ({
                        name: r.name,
                        email: r.email || null,
                        team: r.team,
                        checklistMarked: !!(r.checklist && Object.values(r.checklist).some(Boolean)),
                        status: r.status,
                    }));
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/50a1c944-63a6-4094-af64-9a73a105402a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: 'kpi-team-debug-1', hypothesisId: 'H7', location: 'lark.service.ts:getUserActivityReports:multiTeamFinalCards', message: 'Final cards for multi-team members', data: { selectedTeam: filters?.team || 'All', multiTeamResultDebug }, timestamp: Date.now() }) }).catch(() => { });
                // #endregion

                // Phân tách dữ liệu Báo cáo và BXH
                const combinedResults = allValidResults.filter(r => r.isAuthorizedForReport);
                const rankingList = allValidResults.filter(r => r.isMatchForRanking);

                // Sort: Leaders first, then by name
                combinedResults.sort((a, b) => {
                    const leaderKeywords = ['leader', 'lead', 'quản lý', 'tp ', 'trưởng'];
                    const posA = (a.position || '').toLowerCase();
                    const posB = (b.position || '').toLowerCase();

                    const isALeader = leaderKeywords.some(key => posA.includes(key));
                    const isBLeader = leaderKeywords.some(key => posB.includes(key));

                    if (isALeader && !isBLeader) return -1;
                    if (!isALeader && isBLeader) return 1;

                    // If both are leaders or both are not, sort by name
                    return (a.name || '').localeCompare(b.name || '');
                });

                // Calculate aggregates
                const aggregates = {
                    totalVideoTarget: 0,
                    totalVideoCompleted: 0,
                    totalTrafficTarget: 0,
                    totalTrafficCompleted: 0,
                    totalRevenueTarget: 0,
                    totalRevenueCompleted: 0,
                    totalChannels: totalChannelsMatchingFilter,
                    totalReports: 0,
                    reportedCount: 0
                };

                // Reset group videos to sum from KPI results
                taskVideosByGroup.global = 0;
                taskVideosByGroup.vn = 0;

                // Calculate summary aggregates using only people matching the team filter (rankingList)
                rankingList.forEach(r => {
                    const employee = employeeMap.get(r.name?.toLowerCase().trim().replace(/\s+/g, ' ') || '') || (r.employee_id ? employeeMap.get(r.employee_id.trim()) : null);
                    const empStatus = (employee?.status || employee?.employee_status || '').toLowerCase().trim();
                    const isResigned = empStatus.includes('nghỉ') || empStatus.includes('off') || empStatus.includes('khóa');

                    if (isResigned) return;
                    if (!r.name || r.name.toLowerCase() === 'unknown') return;

                    const videoDone = Number(r.done || 0);
                    const completedMonth = Number(r.completed_month || 0);
                    const region = getRegionInternal(r.team || '');

                    // Use Monthly stats for the BIG KPI cards to show MTD progress as requested
                    aggregates.totalVideoTarget += Number(r.kpi_month || 0);
                    aggregates.totalVideoCompleted += completedMonth;
                    aggregates.totalTrafficCompleted += Number(r.traffic_range || 0);
                    aggregates.totalRevenueCompleted += Number(r.revenue_range || 0);
                    aggregates.totalTrafficTarget += Number(r.trafficTarget || 0);
                    aggregates.totalRevenueTarget += Number(r.revenueTarget || 0);

                    taskVideosByGroup[region] += completedMonth;
                });

                // Count reports for today separately
                combinedResults.forEach(r => {
                    aggregates.totalReports++;
                    if (r.date) aggregates.reportedCount++;
                });

                // Calculate rankings using rankingList (which honors team filter for everyone)

                const trafficRanking = rankingList
                    .sort((a, b) => Number(b.traffic_range || 0) - Number(a.traffic_range || 0))
                    .slice(0, 10)
                    .map((kpi, index) => {
                        const nameKey = kpi.name?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' ') || '';
                        const trimmedEmpId = kpi.employee_id?.trim();
                        const employee = employeeMap.get(nameKey) || (trimmedEmpId ? employeeMap.get(trimmedEmpId) : null);

                        return {
                            rank: index + 1,
                            name: kpi.name,
                            position: employee?.position || null,
                            avatar:
                                this.convertDriveUrl(employee?.image_url) ||
                                this.convertDriveUrl((kpi.email ? userAvatarByEmail.get(String(kpi.email).toLowerCase().trim()) : null) || (nameKey ? userAvatarByName.get(nameKey) : null)) ||
                                this.convertDriveUrl(kpi.link_image) ||
                                this.convertDriveUrl(kpi.image_url) ||
                                null,
                            value: Number(kpi.traffic_range || 0).toLocaleString('vi-VN')
                        };
                    });

                const revenueRanking = rankingList
                    .sort((a, b) => Number(b.revenue_range || 0) - Number(a.revenue_range || 0))
                    .slice(0, 10)
                    .map((kpi, index) => {
                        const nameKey = kpi.name?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' ') || '';
                        const trimmedEmpId = kpi.employee_id?.trim();
                        const employee = employeeMap.get(nameKey) || (trimmedEmpId ? employeeMap.get(trimmedEmpId) : null);

                        return {
                            rank: index + 1,
                            name: kpi.name,
                            position: employee?.position || null,
                            avatar:
                                this.convertDriveUrl(employee?.image_url) ||
                                this.convertDriveUrl((kpi.email ? userAvatarByEmail.get(String(kpi.email).toLowerCase().trim()) : null) || (nameKey ? userAvatarByName.get(nameKey) : null)) ||
                                this.convertDriveUrl(kpi.link_image) ||
                                this.convertDriveUrl(kpi.image_url) ||
                                null,
                            value: Number(kpi.revenue_range || 0).toLocaleString('vi-VN')
                        };
                    });

                // Calculate team-level contribution breakdown (Global Month Context)
                // Use kpiData which is already filtered by current selected month and year
                const allKpiForMonth = kpiData;

                // Map to unique people globally for correct aggregation
                const globalKpis = new Map();
                allKpiForMonth.forEach(k => {
                    const key = k.employee_id?.trim() || k.name?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' ') || '';
                    if (!globalKpis.has(key) || (k.completed_month || 0) > (globalKpis.get(key).completed_month || 0)) {
                        globalKpis.set(key, k);
                    }
                });

                const globalTotals = { videos: 0, traffic: 0, revenue: 0, channels: 0, videoTarget: 0, trafficTarget: 0, revenueTarget: 0 };
                const teamBreakdown = {};

                // Calculate breakdowns based on the people matching the team filter (rankingList)
                rankingList.forEach(r => {
                    const v = Number(r.completed_month || 0);
                    const t = Number(r.traffic_range || 0);
                    const re = Number(r.revenue_range || 0);
                    const c = r.channelCount || 0;

                    globalTotals.videos += v;
                    globalTotals.traffic += t;
                    globalTotals.revenue += re;
                    // globalTotals.channels will be set to aggregates.totalChannels after this loop

                    const rawTeam = r.team || 'Khác';
                    const teams = rawTeam.split(',').map(t => t.trim()).filter(Boolean);

                    teams.forEach(team => {
                        if (!teamBreakdown[team]) {
                            teamBreakdown[team] = { videos: 0, traffic: 0, revenue: 0, channels: 0 };
                        }
                        teamBreakdown[team].videos += v;
                        teamBreakdown[team].traffic += t;
                        teamBreakdown[team].revenue += re;
                        teamBreakdown[team].channels += c;
                    });
                });

                // Ensure global total matches the big summary card
                globalTotals.videos = aggregates.totalVideoCompleted;
                globalTotals.channels = totalChannelsMatchingFilter;

                const teamContributions = Object.entries(teamBreakdown).map(([team, stats]: [string, any]) => ({
                    team,
                    videoPct: globalTotals.videos ? Math.round((stats.videos / globalTotals.videos) * 100) : 0,
                    trafficPct: globalTotals.traffic ? Math.round((stats.traffic / globalTotals.traffic) * 100) : 0,
                    revenuePct: globalTotals.revenue ? Math.round((stats.revenue / globalTotals.revenue) * 100) : 0,
                    channels: stats.channels || 0,
                    channelPct: globalTotals.channels ? Math.round(((stats.channels || 0) / globalTotals.channels) * 100) : 0
                })).sort((a, b) => b.videoPct - a.videoPct);

                // Calculate Group-level contributions (Global vs Việt Nam)
                const groupTotals = {
                    global: { videos: 0, traffic: 0, revenue: 0, channels: regionalChannelCounts.global },
                    vn: { videos: 0, traffic: 0, revenue: 0, channels: regionalChannelCounts.vn }
                };

                const globalTeamNames = ['Global - JP1', 'Global - JP2', 'Global JP3', 'Global JP4', 'Global - Indo', 'Global Thái Lan', 'Global Đài Loan'];
                const vnTeamNames = ['Team K0', 'Team K1', 'Team K2', 'AFF 01', 'Team ADS', 'MEDIA CHUNG'];

                // Use task-based volumes for the group contributions to match the summary cards
                groupTotals.global.videos = taskVideosByGroup.global;
                groupTotals.vn.videos = taskVideosByGroup.vn;

                // Still sum traffic and revenue from individual results
                allValidResults.forEach(r => {
                    const t = Number(r.traffic_range || 0);
                    const re = Number(r.revenue_range || 0);

                    const team = r.team || 'Khác';
                    const region = getRegionInternal(team);

                    if (region === 'global') {
                        groupTotals.global.traffic += t;
                        groupTotals.global.revenue += re;
                    } else {
                        groupTotals.vn.traffic += t;
                        groupTotals.vn.revenue += re;
                    }
                });

                // Update globalTotals.channels to be consistent with the sum of group channels
                globalTotals.channels = groupTotals.global.channels + groupTotals.vn.channels;

                const groupContributions = {
                    global: {
                        videos: groupTotals.global.videos,
                        traffic: groupTotals.global.traffic,
                        revenue: groupTotals.global.revenue,
                        channels: groupTotals.global.channels,
                        videoPct: globalTotals.videos ? Math.round((groupTotals.global.videos / globalTotals.videos) * 100) : 0,
                        trafficPct: globalTotals.traffic ? Math.round((groupTotals.global.traffic / globalTotals.traffic) * 100) : 0,
                        revenuePct: globalTotals.revenue ? Math.round((groupTotals.global.revenue / globalTotals.revenue) * 100) : 0,
                        channelPct: globalTotals.channels ? Math.round((groupTotals.global.channels / globalTotals.channels) * 100) : 0
                    },
                    vn: {
                        videos: groupTotals.vn.videos,
                        traffic: groupTotals.vn.traffic,
                        revenue: groupTotals.vn.revenue,
                        channels: groupTotals.vn.channels,
                        videoPct: globalTotals.videos ? Math.round((groupTotals.vn.videos / globalTotals.videos) * 100) : 0,
                        trafficPct: globalTotals.traffic ? Math.round((groupTotals.vn.traffic / globalTotals.traffic) * 100) : 0,
                        revenuePct: globalTotals.revenue ? Math.round((groupTotals.vn.revenue / globalTotals.revenue) * 100) : 0,
                        channelPct: globalTotals.channels ? Math.round((groupTotals.vn.channels / globalTotals.channels) * 100) : 0
                    }
                };

                // Syncing is already handled by summing allValidResults directly into aggregates above.
                // Keeping globalTotals synced for groupContributions calculation below.

                // reportOutstandings đã được fetch song song trong Promise.all phía trên
                // (xóa bỏ serial await cũ để tránh redeclare và tiết kiệm 50-200ms thời gian chờ)
                return {
                    reports: combinedResults,
                    summary: aggregates,
                    teamContributions,
                    groupContributions,
                    reportOutstandings,
                    rankings: {
                        traffic: trafficRanking,
                        revenue: revenueRanking
                    },
                    meta: {
                        // Use the GLOBAL count (all months) so the banner only shows when the table
                        // is truly empty, not when viewing a date whose data hasn't been entered yet.
                        kpiTotalInDb: Number(totalKpiCount),
                        kpiFilteredForMonth: kpiData.length,
                        kpiMonthFallback: kpiMonthFallback
                    }
                    // NOTE: userRole/userTeam KHÔNG được lưu trong shared cache
                    // vì mỗi user có role/team khác nhau. Chúng được merge bên ngoài.
                };
            } catch (error) {
                this.logger.error('Failed to get user activity reports', error);
                throw error;
            }
        }); // end sharedData cacheService.get

        // Merge per-user role/team vào shared data trước khi trả về client
        return {
            ...sharedData,
            userRole: requesterRole,
            userTeam: requesterTeam,
        };
    }

    async getUserReportDetails(email: string, dateStr: string) {
        // `dateStr` = ngày hiệu suất trên UI (VN). Checklist/traffic lưu theo ngày hôm sau → query D+1.
        const vnYmdFromDate = (dateObj: Date) => {
            const dtf = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Ho_Chi_Minh',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            });
            const p = dtf.formatToParts(dateObj);
            const yy = p.find((x) => x.type === 'year')?.value || '1970';
            const mm = p.find((x) => x.type === 'month')?.value || '01';
            const dd = p.find((x) => x.type === 'day')?.value || '01';
            return `${yy}-${mm}-${dd}`;
        };
        const uiYmd = dateStr.includes('T')
            ? vnYmdFromDate(new Date(dateStr))
            : dateStr.slice(0, 10);
        const up = uiYmd.split('-').map((x) => parseInt(x, 10));
        const anchor = new Date(Date.UTC(up[0], up[1] - 1, up[2], 5, 0, 0, 0));
        const dataYmd = vnYmdFromDate(new Date(anchor.getTime() + 24 * 60 * 60 * 1000));
        const [y, mo, da] = dataYmd.split('-').map((x) => parseInt(x, 10));
        const m = mo - 1;

        const startOfDay = new Date(Date.UTC(y, m, da - 1, 17, 0, 0, 0));
        const endOfDay = new Date(Date.UTC(y, m, da, 16, 59, 59, 999));

        const normalizedEmail = email.trim().toLowerCase();
        const user = await this.prisma.user.findFirst({
            where: { email: { equals: normalizedEmail, mode: 'insensitive' } }
        });
        const fullName = user?.full_name?.trim();
        const normalizeName = (val?: string | null) => (val || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .trim()
            .replace(/\s+/g, ' ');
        const fullNameNorm = normalizeName(fullName);

        const [reportCandidates, trafficCandidates] = await Promise.all([
            this.prisma.larkReport.findMany({
                where: {
                    date: { gte: startOfDay, lte: endOfDay }
                },
                orderBy: { created_at: 'desc' }
            }),
            this.prisma.larkTraffic.findMany({
                where: {
                    date: { gte: startOfDay, lte: endOfDay }
                },
                orderBy: { created_at: 'asc' }
            }),
        ]);

        const isMatchedPerson = (rowEmail?: string | null, rowName?: string | null): boolean => {
            const rowEmailNorm = (rowEmail || '').trim().toLowerCase();
            if (rowEmailNorm && rowEmailNorm === normalizedEmail) return true;
            if (!fullNameNorm) return false;
            const rowNameNorm = normalizeName(rowName);
            return !!rowNameNorm && rowNameNorm === fullNameNorm;
        };

        const report = reportCandidates.find((r: any) => isMatchedPerson(r.email, r.name)) || null;
        const trafficRecords = trafficCandidates.filter((t: any) => isMatchedPerson(t.email, t.name));

        let traffic: any = null;
        let details: any[] = [];
        const platforms = ['fb', 'ig', 'tiktok', 'yt', 'thread', 'lemon8', 'zalo', 'twitter'];

        if (trafficRecords.length > 0) {
            traffic = { ...trafficRecords[0] };
            traffic.total_traffic = Number(traffic.total_traffic || 0);
            platforms.forEach(p => {
                const tk = `traffic_${p}`;
                traffic[tk] = Number(traffic[tk] || 0);
            });

            const buildDetails = (rec: any) => {
                platforms.forEach(p => {
                    const tk = `traffic_${p}`;
                    const ck = `channel_${p}`;
                    const ek = `evidence_${p}`;
                    const val = Number(rec[tk] || 0);
                    if (val > 0) {
                        let ev = [];
                        try { if (rec[ek]) ev = JSON.parse(rec[ek]); } catch (e) { }
                        details.push({ platform: p, channel: rec[ck] || '', value: val, evidences: (Array.isArray(ev) ? ev : []).filter(e => e) });
                    }
                });
            };

            buildDetails(trafficRecords[0]);

            if (trafficRecords.length > 1) {
                for (let i = 1; i < trafficRecords.length; i++) {
                    const rec = trafficRecords[i];
                    traffic.total_traffic += Number(rec.total_traffic || 0);
                    platforms.forEach(p => {
                        const tk = `traffic_${p}`;
                        const ck = `channel_${p}`;
                        const ek = `evidence_${p}`;
                        traffic[tk] = (traffic[tk] || 0) + Number(rec[tk] || 0);
                        if (rec[ck]) traffic[ck] = traffic[ck] ? `${traffic[ck]}, ${rec[ck]}` : rec[ck];
                        if (rec[ek]) {
                            try {
                                const curr = traffic[ek] ? JSON.parse(traffic[ek]) : [];
                                const newE = JSON.parse(rec[ek]);
                                if (Array.isArray(newE)) traffic[ek] = JSON.stringify([...curr, ...newE]);
                            } catch (e) { }
                        }
                    });

                    if (rec.evidence_files) {
                        try {
                            const currF = traffic.evidence_files ? JSON.parse(traffic.evidence_files) : [];
                            const newF = JSON.parse(rec.evidence_files);
                            if (Array.isArray(newF)) traffic.evidence_files = JSON.stringify([...currF, ...newF]);
                        } catch (e) { }
                    }
                    buildDetails(rec);
                }
            }
            traffic.details = details;
        }

        // Process traffic evidence URLs to use proxy
        if (traffic) {
            const platforms = ['fb', 'ig', 'tiktok', 'yt', 'thread', 'lemon8', 'zalo', 'twitter'];
            platforms.forEach(p => {
                const key = `evidence_${p}`;
                if (traffic[key]) {
                    try {
                        const data = JSON.parse(traffic[key]);
                        if (Array.isArray(data)) {
                            const processed = data.map(item => {
                                if (typeof item === 'string') return this.convertDriveUrl(item);
                                if (item && item.url) {
                                    return { ...item, url: this.convertDriveUrl(item.url) };
                                }
                                return item;
                            });
                            traffic[key] = JSON.stringify(processed);
                        } else {
                            traffic[key] = this.convertDriveUrl(traffic[key]);
                        }
                    } catch (e) {
                        traffic[key] = this.convertDriveUrl(traffic[key]);
                    }
                }
            });
        }

        // Identify which teams have already been reported in traffic records
        const reportedTeams = Array.from(new Set(trafficRecords.map(t => t.team).filter(Boolean)));

        return { report, traffic, trafficRecords, reportedTeams };

    }

    convertDriveUrl(url: string | null | undefined): string | null {
        if (!url) return null;
        const trimmed = url.trim();

        // If it's just a token (no obvious URL chars), treat as Lark mediaId and proxy it.
        if (
            trimmed.length >= 20 &&
            trimmed.length <= 60 &&
            !trimmed.includes('/') &&
            !trimmed.includes('.') &&
            !trimmed.includes(':')
        ) {
            const port = this.configService.get<string>('PORT') || '3000';
            const apiBase = this.configService.get<string>('API_BASE_URL') || `http://localhost:${port}/api`;
            return `${apiBase}/lark/media/${encodeURIComponent(trimmed)}`;
        }

        // Handle Google Drive links (both /d/<id> and ?id=<id> forms)
        if (trimmed.includes('drive.google.com')) {
            const match = trimmed.match(/\/d\/([^/]+)/) || trimmed.match(/id=([^&]+)/);
            if (match && match[1]) {
                return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w400`;
            }
        }

        // Handle Google user content URLs (e.g. lh3.googleusercontent.com from employee profiles)
        // These often have authuser/sz params that cause auth issues or odd sizing.
        if (trimmed.includes('googleusercontent.com')) {
            try {
                const urlObj = new URL(trimmed);
                urlObj.searchParams.delete('authuser');
                urlObj.searchParams.delete('sz');
                return urlObj.toString().replace(/=[sw]\d+(-[sw]\d+)*(?=[?#]|$)/, '=w200');
            } catch {
                return trimmed;
            }
        }

        // Handle Lark / Feishu media (token or URL) via our proxy.
        const parsedMediaRef = this.parseLarkMediaRef(trimmed);
        if (parsedMediaRef) {
            // Prefer explicit API_BASE_URL; else derive from GOOGLE_CALLBACK_URL; else localhost.
            let apiBase = this.configService.get<string>('API_BASE_URL');
            if (!apiBase) {
                const callbackUrl = this.configService.get<string>('GOOGLE_CALLBACK_URL') || '';
                if (callbackUrl) {
                    try {
                        apiBase = `${new URL(callbackUrl).origin}/api`;
                    } catch {
                        // ignore malformed URL
                    }
                }
            }
            if (!apiBase) {
                const port = this.configService.get<string>('PORT') || '3000';
                apiBase = `http://localhost:${port}/api`;
            }

            let proxyUrl = `${apiBase}/lark/media/${encodeURIComponent(parsedMediaRef.mediaId)}`;
            if (parsedMediaRef.extra) {
                proxyUrl += `?extra=${encodeURIComponent(parsedMediaRef.extra)}`;
            }
            return proxyUrl;
        }

        // Lark/Feishu attachment/CDN URLs — return as-is.
        if (
            trimmed.includes('feishucdn.com') ||
            trimmed.includes('feishu.cn') ||
            trimmed.includes('lf-cdn.com') ||
            trimmed.includes('larksuite.com')
        ) {
            return trimmed;
        }

        return trimmed;
    }

    async getMedia(mediaId: string, extra?: string): Promise<{ data: any; contentType: string }> {
        const token = await this.getAccessToken();
        const normalized = this.normalizeMediaRequest(mediaId, extra);
        const candidates = this.buildMediaDownloadCandidates(normalized.mediaId, normalized.extra);

        let lastError: any;
        for (const candidate of candidates) {
            const url = this.buildLarkMediaDownloadUrl(candidate.mediaId, candidate.extra);
            try {
                const response = await firstValueFrom(
                    this.httpService.get(url, {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                        responseType: 'arraybuffer',
                    }),
                );

                return {
                    data: response.data,
                    contentType: String(response.headers['content-type'] || 'image/png'),
                };
            } catch (error) {
                lastError = error;
                const status = error?.response?.status;
                this.logger.warn(
                    `[Lark media] download attempt failed status=${status || 'n/a'} mediaId=${candidate.mediaId} withExtra=${candidate.extra ? 'yes' : 'no'}`,
                );
            }
        }

        this.logger.error(`Failed to fetch media ${mediaId} from Lark`, lastError);
        throw lastError;
    }

    private buildLarkMediaDownloadUrl(mediaId: string, extra?: string): string {
        let url = `https://open.larksuite.com/open-apis/drive/v1/medias/${encodeURIComponent(mediaId)}/download`;
        if (extra) {
            url += `?extra=${encodeURIComponent(extra)}`;
        }
        return url;
    }

    private buildMediaDownloadCandidates(mediaId: string, extra?: string): Array<{ mediaId: string; extra?: string }> {
        const candidates: Array<{ mediaId: string; extra?: string }> = [];
        const addCandidate = (candidateExtra?: string) => {
            const normalizedExtra = this.normalizeExtraCandidate(candidateExtra);
            const exists = candidates.some((item) => item.mediaId === mediaId && (item.extra || '') === (normalizedExtra || ''));
            if (!exists) {
                if (normalizedExtra) candidates.push({ mediaId, extra: normalizedExtra });
                else candidates.push({ mediaId });
            }
        };

        // Preferred request as parsed from original URL.
        addCandidate(extra);

        if (extra) {
            // Fallback for already-encoded query values.
            try {
                const decoded = decodeURIComponent(extra);
                if (decoded && decoded !== extra) addCandidate(decoded);
            } catch {
                // ignore
            }

            // Fallback for stale bitable revision in `extra`.
            const parsedExtra = this.tryParseExtraJson(extra);
            if (parsedExtra?.bitablePerm && typeof parsedExtra.bitablePerm === 'object' && parsedExtra.bitablePerm.rev != null) {
                const withoutRev = {
                    ...parsedExtra,
                    bitablePerm: {
                        ...parsedExtra.bitablePerm,
                    },
                };
                delete withoutRev.bitablePerm.rev;
                addCandidate(JSON.stringify(withoutRev));
            }
        }

        // Last fallback for media that does not require extra.
        addCandidate(undefined);
        return candidates;
    }

    private normalizeExtraCandidate(extra?: string): string | undefined {
        if (!extra || typeof extra !== 'string') return undefined;
        const trimmed = extra.trim();
        if (!trimmed) return undefined;
        return trimmed;
    }

    private tryParseExtraJson(extra?: string): any | null {
        if (!extra) return null;

        const attempts: string[] = [extra];
        try {
            const decoded = decodeURIComponent(extra);
            if (decoded !== extra) attempts.push(decoded);
        } catch {
            // ignore malformed encoding
        }

        for (const candidate of attempts) {
            try {
                return JSON.parse(candidate);
            } catch {
                // try next
            }
        }
        return null;
    }

    private parseLarkMediaRef(rawUrl: string): { mediaId: string; extra?: string } | null {
        if (!rawUrl) return null;
        const trimmed = rawUrl.trim();

        // High confidence: It's a direct Lark token (file_token_..., obj_..., tmp_...)
        if (trimmed.startsWith('file_token_') || trimmed.startsWith('obj_') || trimmed.startsWith('tmp_')) {
            return { mediaId: trimmed };
        }

        const candidates = [trimmed];
        try {
            const decoded = decodeURIComponent(trimmed);
            if (decoded !== trimmed) candidates.push(decoded);
        } catch {
            // Ignore malformed encoded input and keep raw value.
        }

        for (const candidate of candidates) {
            if (!candidate.includes('/open-apis/drive/v1/medias/')) continue;
            try {
                const parsed = new URL(candidate, 'https://open.larksuite.com');
                const marker = '/open-apis/drive/v1/medias/';
                const idx = parsed.pathname.indexOf(marker);
                if (idx < 0) continue;

                const after = parsed.pathname.slice(idx + marker.length);
                const mediaId = after.split('/')[0];
                if (!mediaId) continue;

                const extra = parsed.searchParams.get('extra') || undefined;
                return { mediaId, extra };
            } catch {
                // Try next candidate.
            }
        }

        return null;
    }

    private normalizeMediaRequest(mediaIdRaw: string, extraRaw?: string): { mediaId: string; extra?: string } {
        let mediaId = mediaIdRaw || '';
        let extra = extraRaw;

        try {
            const decoded = decodeURIComponent(mediaId);
            if (decoded) mediaId = decoded;
        } catch {
            // Keep original if decode fails.
        }

        const downloadIdx = mediaId.indexOf('/download');
        if (downloadIdx >= 0) {
            const trailing = mediaId.slice(downloadIdx + '/download'.length);
            mediaId = mediaId.slice(0, downloadIdx);

            if (!extra && trailing.startsWith('?')) {
                try {
                    const params = new URLSearchParams(trailing.slice(1));
                    const parsedExtra = params.get('extra');
                    if (parsedExtra) extra = parsedExtra;
                } catch {
                    // Ignore malformed trailing query.
                }
            }
        }

        if (typeof extra === 'string') {
            extra = extra.trim();
            try {
                const decodedExtra = decodeURIComponent(extra);
                if (decodedExtra) extra = decodedExtra;
            } catch {
                // Keep original if decode fails.
            }
        }

        return { mediaId, extra };
    }

    // --- SYNC PERMISSION DATA ---
    async syncPermissionData() {
        if (!this.PERMISSION_TABLE_ID) {
            this.logger.warn('LARK_PERMISSION_TABLE_ID not configured, skipping sync.');
            return;
        }

        try {
            const records = await this.fetchAllRecords(this.REPORT_BASE_ID, this.PERMISSION_TABLE_ID);
            this.logger.log(`Fetched ${records.length} records from Permission Table. Syncing to database...`);

            let syncedUsers = 0;
            let skippedNoEmail = 0;
            const syncedUserIds: string[] = [];

            if (records.length > 0) {
                this.logger.log(`[DEBUG PERMISSION MAPPING] Keys: ${Object.keys(records[0].fields).join(', ')}`);
                this.logger.log(`[DEBUG PERMISSION MAPPING] Values: ${JSON.stringify(records[0].fields)}`);
            }

            for (const record of records) {
                const fields = record.fields;
                const dateNow = new Date();

                // Field name mapping with fallbacks
                const email = fields['Email'] || null;
                const name = fields['HoTen'] || fields['Họ Tên'] || fields['Name'] || null;
                const maPin = fields['MaPin'] || fields['Mã Pin'] || fields['Mã pin'] || null;
                const employeeRaw = fields['Nhân viên'] || fields['Nhan vien'];
                const employee = employeeRaw ? JSON.stringify(employeeRaw) : null;
                const roleRaw = fields['Role'] || fields['Chức vụ'] || 'Member';

                let team = fields['Team'] || fields['Phòng ban'] || null;
                if (Array.isArray(team) && team.length > 0) {
                    team = team.map(t => String(t).trim()).filter(Boolean).join(', ');
                } else if (team) {
                    team = String(team).trim();
                }

                const statusField = fields['Trạng thái nhân sự'] || fields['Trang Thai'] || fields['Trạng thái'] || fields['Status'] || 'Đang hoạt động';
                let employee_status = 'on';
                const lowStatus = String(statusField).toLowerCase();
                if (lowStatus.includes('nghỉ') || lowStatus.includes('off') || lowStatus.includes('khóa')) {
                    employee_status = 'off';
                }

                // Lấy ảnh. User có thể dán string google drive URL thẳng vào cột 'Anh' / 'Ảnh'.
                let avatarUrl = null;
                let empId = null;
                if (employeeRaw && Array.isArray(employeeRaw) && employeeRaw.length > 0) {
                    avatarUrl = employeeRaw[0].avatar_url || null;
                    empId = employeeRaw[0].id || null;
                }
                const imageField = fields['Anh'] || fields['Ảnh'] || fields['Avatar'] || fields['Image'];
                if (typeof imageField === 'string' && imageField.trim().startsWith('http')) {
                    avatarUrl = imageField.trim();
                } else if (imageField && Array.isArray(imageField) && imageField.length > 0 && imageField[0].url) {
                    avatarUrl = imageField[0].url;
                }

                // ── Sync ĐỘC LẬP vào bảng users (nguồn chính) ─────────────────────────────────
                if (!email && !name) {
                    skippedNoEmail++;
                    continue;
                }

                // Map Role text → UserRole enum
                const roleLower = (roleRaw || '').toLowerCase().trim();
                let userRoles: string[];
                if (roleLower === 'admin') {
                    userRoles = ['ADMIN'];
                } else if (roleLower === 'manager') {
                    userRoles = ['MANAGER'];
                } else if (roleLower === 'leader') {
                    userRoles = ['LEADER'];
                } else {
                    userRoles = ['MEMBER']; // Mặc định là MEMBER
                }

                const fullName = (typeof name === 'string' && name.trim().length > 0 ? name.trim() : null)
                    || (email ? email.split('@')[0] : 'Unknown');

                const finalEmail = email ? email.trim().toLowerCase() : `${fullName.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Date.now()}@noemail.com`;

                // Upsert vào users: update nếu email/name trùng, tạo mới nếu chưa có
                try {
                    let existingUser: { id: string; roles: string[]; email: string; lark_employee_record_id: string | null; team: string | null } | null = null;
                    if (email) {
                        existingUser = await this.prisma.user.findFirst({
                            where: { email: { equals: email.trim(), mode: 'insensitive' } },
                            select: { id: true, roles: true, email: true, lark_employee_record_id: true, team: true }
                        });
                    }
                    if (!existingUser && name) {
                        const byName = await this.prisma.user.findFirst({
                            where: { full_name: { equals: name.trim(), mode: 'insensitive' } },
                            select: { id: true, roles: true, email: true, lark_employee_record_id: true, team: true }
                        });
                        // Only use the name-match if the incoming record has NO email (anonymous entry)
                        // OR the found user has no HR record yet (lark_employee_record_id is null).
                        // This prevents a MEMBER permission entry with a different email from
                        // hijacking an HR-confirmed user who happens to share the same display name.
                        if (byName) {
                            const incomingEmailNorm = email ? email.trim().toLowerCase() : null;
                            const foundEmailNorm = byName.email.toLowerCase();
                            const emailsDiffer = incomingEmailNorm && incomingEmailNorm !== foundEmailNorm;
                            const foundIsHRConfirmed = !!byName.lark_employee_record_id;
                            if (emailsDiffer && foundIsHRConfirmed) {
                                this.logger.warn(
                                    `[PermSync] Name match "${name}" found but emails differ ` +
                                    `(incoming: ${incomingEmailNorm}, existing: ${foundEmailNorm}) ` +
                                    `and existing user is HR-confirmed. Skipping name-based update to avoid data collision.`
                                );
                                // Do NOT set existingUser — let the code below create a new record instead.
                            } else {
                                existingUser = byName;
                            }
                        }
                    }

                    let savedUserIdStr = null;
                    if (existingUser) {
                        // Guard: never downgrade a LEADER / ADMIN / MANAGER to MEMBER via the permission table.
                        // If the person was recently promoted in the HR system but the permission table
                        // still says "Member", we keep the higher role until the permission table is updated.
                        const currentHighRole = ['ADMIN', 'MANAGER', 'LEADER'].find(r =>
                            (existingUser!.roles || []).includes(r)
                        );
                        const isRoleDowngrade = !!currentHighRole && userRoles[0] === 'MEMBER';
                        if (isRoleDowngrade) {
                            this.logger.warn(
                                `[PermSync] Skipping role downgrade for ${finalEmail}: ` +
                                `${currentHighRole} → MEMBER. Permission table may be stale.`
                            );
                        }

                        const updateData: any = {
                            full_name: fullName,
                            roles: isRoleDowngrade ? existingUser.roles : userRoles,
                            team: this.mergeTeamValues(existingUser.team, team),
                            employee_status: employee_status,
                            image_url: avatarUrl || null,
                            ...(empId ? { employee_id: empId } : {}),
                            updated_at: dateNow,
                        };

                        await this.prisma.user.update({
                            where: { id: existingUser.id },
                            data: updateData
                        });
                        savedUserIdStr = existingUser.id;
                    } else {
                        // Tạo user mới từ Lark data
                        const newUser = await this.prisma.user.create({
                            data: {
                                email: finalEmail,
                                full_name: fullName,
                                roles: userRoles as any,
                                team: this.mergeTeamValues(team),
                                employee_status: employee_status,
                                employee_id: empId || null,
                                image_url: avatarUrl || null,
                                password_hash: null,
                                is_active: true,
                            }
                        });
                        savedUserIdStr = newUser.id;
                    }

                    if (savedUserIdStr) {
                        syncedUserIds.push(String(savedUserIdStr));
                    }
                    syncedUsers++;
                } catch (userErr) {
                    this.logger.warn(`[PermSync] Could not upsert user for email/name ${email || name}: ${userErr.message}`);
                }
            }

            // --- BƯỚC OVERWRITE: Đánh dấu tất cả những nhân viên cũ KHÔNG tồn tại trong đợt sync này thành trạng thái "OFF"
            if (syncedUserIds.length > 0) {
                const offUpdateResult = await this.prisma.user.updateMany({
                    where: {
                        NOT: {
                            id: { in: syncedUserIds }
                        }
                    },
                    data: {
                        employee_status: 'OFF'
                    }
                });
                this.logger.log(`Marked ${offUpdateResult.count} unsynced users as 'OFF'.`);
            }

            this.logger.log(`Lark Permission sync completed. records: ${records.length}. users upserted: ${syncedUsers}, skipped (no email or name): ${skippedNoEmail}.`);
        } catch (error) {
            this.logger.error('Failed to sync Lark Permission data', error);
        }
    }


    async getPersonalHistory(requesterEmail: string, targetName?: string) {
        if (!requesterEmail) return { history: [], teamStats: null };

        // Cache 5 phút: dữ liệu lịch sử cá nhân ít thay đổi trong ngày
        // Key include targetName để admin xem người khác không bị nhầm cache
        const cacheKey = `history:${requesterEmail}:${targetName || ''}`;
        return this.cacheService.get(cacheKey, 5 * 60 * 1000, async () => {
            try {
                // ── Lấy thông tin từ bảng users làm NGUỒN DUY NHẤT ──
                const sysUser = await this.prisma.user.findFirst({
                    where: { email: { equals: requesterEmail, mode: 'insensitive' } }
                });

                // Role: lấy từ users.roles → 'member'
                let requesterRole: string = 'member';
                if (sysUser?.roles && (sysUser.roles as any[]).length > 0) {
                    const roles = sysUser.roles as string[];
                    if (roles.includes('ADMIN')) requesterRole = 'admin';
                    else if (roles.includes('MANAGER')) requesterRole = 'manager';
                    else if (roles.includes('LEADER')) requesterRole = 'leader';
                    else requesterRole = roles[0].toLowerCase();
                }

                // Team & Name 
                let requesterTeam = sysUser?.team || null;
                let userName = sysUser?.full_name || requesterEmail.split('@')[0];
                let userTeam = sysUser?.team || null;

                // If Admin/Manager has no team, pick first one from KPI to avoid 0s (for overall view)
                if (!userTeam && (requesterRole === 'admin' || requesterRole === 'manager')) {
                    const firstKpi = await this.prisma.larkKPI.findFirst({
                        where: { team: { not: null } }
                    });
                    if (firstKpi) userTeam = firstKpi.team;
                }

                // Nếu leader/member vẫn chưa có team, tìm thêm từ báo cáo / KPI theo email
                if (!userTeam && (requesterRole === 'leader' || requesterRole === 'member')) {
                    const lastReport = await this.prisma.larkReport.findFirst({
                        where: { email: { equals: requesterEmail, mode: 'insensitive' } },
                        orderBy: { created_at: 'desc' }
                    });
                    if (lastReport?.team) {
                        userTeam = lastReport.team;
                        requesterTeam = lastReport.team;
                        this.logger.debug(`Resolved team for ${userName} (${requesterRole}) from Report: ${userTeam}`);
                    }
                }

                // If a specific name is requested, check authorization
                if (targetName && targetName.trim()) {
                    // Find the target person
                    const targetUser = await this.prisma.user.findFirst({
                        where: { full_name: { contains: targetName.trim(), mode: 'insensitive' } }
                    });

                    if (targetUser) {
                        const empStatus = (targetUser.employee_status || '').toLowerCase().trim();
                        if (empStatus === 'đã nghỉ' || empStatus === 'da nghi' || empStatus.includes('nghỉ')) {
                            this.logger.warn(`Access denied: ${targetName} has resigned.`);
                            return { history: [], teamStats: null };
                        }

                        const isSameTeam = targetUser.team === requesterTeam;
                        const isAdmin = requesterRole === 'admin';
                        const isManager = requesterRole === 'manager';
                        const isLeader = requesterRole === 'leader';

                        // Authorization check: Admin and Manager can see everyone, Leader can see their team
                        if (isAdmin || isManager || (isLeader && isSameTeam)) {
                            userName = targetUser.full_name;
                            userTeam = targetUser.team;
                        } else {
                            this.logger.warn(`Unauthorized: ${requesterEmail} (${requesterRole}) tried to access ${targetName}`);
                            // Fallback to own info or return empty
                        }
                    } else {
                        // If target not found in permissions, might still be in KPI table, but we need team for authorization
                        // For now, if not in permissions, we only allow Admin to see it
                        if (requesterRole === 'admin' || requesterRole === 'manager') {
                            userName = targetName;
                            // userTeam remains unknown or we try to find it from KPI later
                        }
                    }
                }

                const isAdmin = requesterRole === 'admin' || requesterRole === 'manager';
                if (!userName && !isAdmin) return { history: [], teamStats: null };

                // For admins with no name, pick a placeholder or remains null
                if (!userName && isAdmin) {
                    userName = 'Admin';
                }

                // Fetch all KPI history for this user
                const kpis = await this.prisma.larkKPI.findMany({
                    where: {
                        name: { equals: userName.trim(), mode: 'insensitive' }
                    },
                    orderBy: {
                        created_at: 'asc'
                    }
                });

                const monthlyData = new Map<string, any>();
                kpis.forEach(kpi => {
                    const monthStr = kpi.month || kpi.created_at.toISOString().substring(0, 7);
                    monthlyData.set(monthStr, {
                        month: monthStr,
                        video: kpi.completed_month || 0,
                        videoTarget: kpi.kpi_month || 0,
                        traffic: Number(kpi.traffic_month || 0),
                        trafficTarget: parseInt(kpi.target_traffic_month || '0') || 0,
                        revenue: Number(kpi.revenue_month || 0),
                        revenueTarget: parseInt(kpi.target_revenue_month || '0') || 0,
                        date: kpi.created_at
                    });
                });

                const history = Array.from(monthlyData.values()).sort((a, b) => a.date.getTime() - b.date.getTime());

                const today = new Date();
                const startOfToday = new Date(today.setHours(0, 0, 0, 0));
                const endOfToday = new Date(today.setHours(23, 59, 59, 999));

                let targetMonthNum = new Date().getMonth() + 1;

                const getKpisForMonth = async (mNum: number) => {
                    const formats = [`T${mNum}`, `Tháng ${mNum}`, `tháng ${mNum}`, `${mNum}`, mNum < 10 ? `0${mNum}` : `${mNum}`];
                    return await this.prisma.larkKPI.findMany({
                        where: {
                            month: { in: formats },
                            OR: [{ state: { not: 'off' } }, { state: null }]
                        }
                    });
                };

                let allTeamKpis = await getKpisForMonth(targetMonthNum);

                // Fallback: If no KPIs for current month, find most recent month with data
                if (allTeamKpis.length === 0) {
                    const latestKpi = await this.prisma.larkKPI.findFirst({
                        where: { month: { not: null } },
                        orderBy: { created_at: 'desc' }
                    });

                    if (latestKpi && latestKpi.month) {
                        const mDigits = latestKpi.month.match(/\d+/);
                        if (mDigits) {
                            targetMonthNum = parseInt(mDigits[0]);
                            allTeamKpis = await getKpisForMonth(targetMonthNum);
                            this.logger.log(`No data for T${new Date().getMonth() + 1}, falling back to month ${targetMonthNum}`);
                        }
                    }
                }

                const targetMonth = `T${targetMonthNum}`;
                const monthFormats = [`T${targetMonthNum}`, `Tháng ${targetMonthNum}`, `${targetMonthNum}`, targetMonthNum < 10 ? `0${targetMonthNum}` : `${targetMonthNum}`];


                const [todayReport, employeeUser, userChannelCount] = await Promise.all([
                    this.prisma.larkReport.findFirst({
                        where: {
                            name: { equals: userName.trim(), mode: 'insensitive' },
                            date: { gte: startOfToday, lte: endOfToday }
                        }
                    }),
                    this.prisma.user.findFirst({
                        where: {
                            full_name: { equals: userName.trim(), mode: 'insensitive' },
                            lark_employee_record_id: { not: null },
                        },
                    }),
                    this.prisma.channel.count({
                        where: { owner: { equals: userName.trim(), mode: 'insensitive' } }
                    })
                ]);
                const employee = employeeUser
                    ? {
                        image_url: employeeUser.image_url,
                        position: employeeUser.employee_position,
                    }
                    : null;

                const currentMonthKpi = allTeamKpis
                    .filter(k => k.name?.toLowerCase().trim().replace(/\s+/g, ' ') === userName.toLowerCase().trim().replace(/\s+/g, ' '))
                    .sort((a, b) => (b.completed_month || 0) - (a.completed_month || 0))[0] || null;

                // Calculate Company Stats (ALL Teams) for the current month
                let companyStats = null;
                try {
                    // Deduplicate by person (if possible) or by record ID
                    const companyLatestMap = new Map();
                    allTeamKpis.forEach(k => {
                        // Use a unique key: employee_id > name > record_id
                        const key = k.employee_id?.trim() ||
                            (k.name ? k.name.toLowerCase().trim().replace(/\s+/g, ' ') : null) ||
                            k.id;

                        if (!companyLatestMap.has(key) || (k.completed_month || 0) > (companyLatestMap.get(key).completed_month || 0)) {
                            companyLatestMap.set(key, k);
                        }
                    });

                    const compTotals = { video: 0, traffic: 0, revenue: 0 };
                    companyLatestMap.forEach(k => {
                        compTotals.video += k.completed_month || 0;
                        compTotals.traffic += Number(k.traffic_month || 0);
                        compTotals.revenue += Number(k.revenue_month || 0);
                    });

                    const companyChannelsCount = await this.prisma.channel.count().catch(() => 0);

                    companyStats = {
                        totalVideo: compTotals.video,
                        totalTraffic: compTotals.traffic,
                        totalRevenue: compTotals.revenue,
                        totalChannels: companyChannelsCount
                    };

                    this.logger.log(`Calculated Company Stats: ${JSON.stringify(companyStats)} from ${companyLatestMap.size} unique records`);
                } catch (e) {
                    this.logger.error('Failed to calculate company stats', e);
                }

                // Calculate Team Stats for the current month
                let teamStats = null;
                if (userTeam) {
                    const teamKpis = allTeamKpis.filter(k =>
                        k.team?.toLowerCase().trim() === userTeam.toLowerCase().trim()
                    );

                    // Deduplicate team members (take latest for each person)
                    const teamLatestMap = new Map();
                    teamKpis.forEach(k => {
                        const key = k.employee_id?.trim() || k.name?.toLowerCase().trim().replace(/\s+/g, ' ') || '';
                        if (!teamLatestMap.has(key) || (k.completed_month || 0) > (teamLatestMap.get(key).completed_month || 0)) {
                            teamLatestMap.set(key, k);
                        }
                    });

                    const teamTotals = { video: 0, traffic: 0, revenue: 0, channels: 0 };
                    let userRecord = null;

                    teamLatestMap.forEach(k => {
                        teamTotals.video += k.completed_month || 0;
                        teamTotals.traffic += Number(k.traffic_month || 0);
                        teamTotals.revenue += Number(k.revenue_month || 0);

                        const nameKey = k.name?.toLowerCase().trim().replace(/\s+/g, ' ');
                        if (nameKey === userName.toLowerCase().trim().replace(/\s+/g, ' ')) {
                            userRecord = k;
                        }
                    });

                    // Calculate team channels
                    try {
                        const teamMembers = Array.from(teamLatestMap.values()).map(k => k.name?.trim()).filter(Boolean);
                        const teamChannelsCount = await this.prisma.channel.count({
                            where: { owner: { in: teamMembers, mode: 'insensitive' } }
                        });
                        teamTotals.channels = teamChannelsCount;
                    } catch (e) { }

                    if (userRecord) {
                        teamStats = {
                            teamName: userTeam,
                            userVideo: userRecord.completed_month || 0,
                            teamVideo: teamTotals.video,
                            userTraffic: Number(userRecord.traffic_month || 0),
                            teamTraffic: teamTotals.traffic,
                            userRevenue: Number(userRecord.revenue_month || 0),
                            teamRevenue: teamTotals.revenue,
                            teamChannels: teamTotals.channels
                        };
                    } else {
                        // Fallback to individual stats if not found in team KPI (roster mismatch)
                        const individualKpi = currentMonthKpi || (kpis.length > 0 ? kpis[kpis.length - 1] : null);
                        teamStats = {
                            teamName: userTeam || 'Cá nhân',
                            userVideo: individualKpi?.completed_month || 0,
                            teamVideo: teamTotals.video || individualKpi?.completed_month || 0,
                            userTraffic: Number(individualKpi?.traffic_month || 0),
                            teamTraffic: teamTotals.traffic || Number(individualKpi?.traffic_month || 0),
                            userRevenue: Number(individualKpi?.revenue_month || 0),
                            teamRevenue: teamTotals.revenue || Number(individualKpi?.revenue_month || 0),
                            teamChannels: teamTotals.channels || userChannelCount
                        };
                    }
                }

                // Calculate checklist from latest report
                let checklistStr = '0/6';
                if (todayReport?.answers) {
                    let ans = todayReport.answers;
                    if (typeof ans === 'string') try { ans = JSON.parse(ans); } catch (e) { }
                    if (ans && typeof ans === 'object') {
                        const checks = [
                            ans['Bạn đã đăng video lên FB chưa?'] === true || ans['Báo cáo Lark - Bạn đã đăng video lên FB chưa?'] === true,
                            ans['Bạn đã đăng video lên IG chưa?'] === true || ans['Báo cáo Lark - Bạn đã đăng video lên IG chưa?'] === true,
                            ans['Bạn đã đăng video lên Tiktok chưa?'] === true || ans['Báo cáo Lark - Bạn đã đăng video lên Tiktok chưa?'] === true,
                            ans['Bạn đã đăng video lên Youtube chưa?'] === true || ans['Báo cáo Lark - Bạn đã đăng video lên Youtube chưa?'] === true,
                            ans['Báo cáo Lark - Bạn đã báo cáo đầy đủ thông tin công việc trên lark chưa?'] === true || ans['Bạn đã báo cáo đầy đủ thông tin công việc trên lark chưa?'] === true,
                            ans['Bạn đã check lại caption và hagtag video chưa?'] === true || ans['Báo cáo Lark - Bạn đã check lại caption và hagtag video chưa?'] === true
                        ];
                        const count = checks.filter(Boolean).length;
                        checklistStr = `${count}/6`;
                    }
                }

                const userActivity = {
                    name: userName,
                    position: employee?.position || null,
                    team: userTeam || 'Khác',
                    avatar: this.convertDriveUrl(employee?.image_url) || this.convertDriveUrl(currentMonthKpi?.link_image) || this.convertDriveUrl(currentMonthKpi?.image_url) || null,
                    time: todayReport ? new Date(todayReport.date).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : 'Chưa báo cáo',
                    dailyGoal: currentMonthKpi?.kpi_day || 0,
                    done: currentMonthKpi?.completed_day || 0,
                    traffic: Number(currentMonthKpi?.traffic_month || 0).toLocaleString('vi-VN'),
                    revenue: Number(currentMonthKpi?.revenue_month || 0).toLocaleString('vi-VN'),
                    reportStatus: todayReport ? 'ĐÚNG HẠN' : 'CHƯA BÁO CÁO',
                    monthlyProgress: (currentMonthKpi && currentMonthKpi.kpi_progress_month !== null) ? Math.round(Number(currentMonthKpi.kpi_progress_month) * 100) : ((currentMonthKpi?.kpi_month || 0) > 0 ? Math.round((currentMonthKpi?.completed_month || 0) / currentMonthKpi.kpi_month * 100) : 0),
                    channels: userChannelCount,
                    checklist: checklistStr
                };

                // Fetch members for the performance table based on role
                let membersList = [];
                try {
                    let membersWhere: any = { month: targetMonth };

                    if (isAdmin) {
                        // Admin/Manager sees everyone
                    } else if (requesterTeam) {
                        // Leader and Member see their whole team
                        membersWhere.team = requesterTeam;
                    } else if (userName) {
                        // Fallback to only themselves if no team info
                        membersWhere.name = userName;
                    }

                    // If user is admin but has no name, we filter by team to show something or everyone
                    if (isAdmin && userName === 'Admin') {
                        delete membersWhere.name;
                    }

                    const allKpis = await this.prisma.larkKPI.findMany({
                        where: {
                            ...membersWhere,
                            month: { in: monthFormats }
                        },
                        orderBy: { revenue_month: 'desc' }
                    });

                    // Fetch Huyk data and Reports for context
                    // Use queryRaw for HuykChannel in case client is not yet updated with new model
                    const [huykChannels, recentReports] = await Promise.all([
                        this.prisma.$queryRawUnsafe<any[]>('SELECT * FROM "huyk_channels"').catch(() => []),
                        this.prisma.larkReport.findMany({
                            where: {
                                name: { in: allKpis.map(k => k.name).filter(Boolean) as string[] }
                            },
                            orderBy: { date: 'desc' }
                        })
                    ]);

                    const huykCounts = new Map();
                    huykChannels.forEach(h => {
                        if (h.owner) {
                            const ownerKey = h.owner.toLowerCase().trim().replace(/\s+/g, ' ');
                            huykCounts.set(ownerKey, (huykCounts.get(ownerKey) || 0) + 1);
                        }
                    });

                    const reportMap = new Map();
                    recentReports.forEach(r => {
                        const nameKey = r.name?.toLowerCase().trim().replace(/\s+/g, ' ');
                        if (!reportMap.has(nameKey)) reportMap.set(nameKey, r);
                    });

                    // Filter out state='off' records (resigned/inactive employees)
                    const activeKpis = allKpis.filter(k => k.state?.toLowerCase().trim() !== 'off');

                    // Get team totals for contribution calculation
                    const totalVideo = activeKpis.reduce((sum, k) => sum + (k.completed_month || 0), 0);

                    // Deduplicate and format
                    const latestMembers = new Map();
                    activeKpis.forEach(k => {
                        const nameKey = k.name?.toLowerCase().trim().replace(/\s+/g, ' ') || '';
                        const key = k.name?.trim() || k.id;
                        if (!latestMembers.has(key)) {
                            const contribution = totalVideo > 0 ? Math.round(((k.completed_month || 0) / totalVideo) * 100) : 0;

                            // Get Huyk channels count
                            const channelCount = huykCounts.get(nameKey) || 0;

                            // Calculate checklist from latest report
                            const report = reportMap.get(nameKey);
                            let checklistStr = '0/6';
                            if (report?.answers) {
                                let ans = report.answers;
                                if (typeof ans === 'string') try { ans = JSON.parse(ans); } catch (e) { }
                                if (ans && typeof ans === 'object') {
                                    const checks = [
                                        ans['Bạn đã đăng video lên FB chưa?'] === true || ans['Báo cáo Lark - Bạn đã đăng video lên FB chưa?'] === true,
                                        ans['Bạn đã đăng video lên IG chưa?'] === true || ans['Báo cáo Lark - Bạn đã đăng video lên IG chưa?'] === true,
                                        ans['Bạn đã đăng video lên Tiktok chưa?'] === true || ans['Báo cáo Lark - Bạn đã đăng video lên Tiktok chưa?'] === true,
                                        ans['Bạn đã đăng video lên Youtube chưa?'] === true || ans['Báo cáo Lark - Bạn đã đăng video lên Youtube chưa?'] === true,
                                        ans['Báo cáo Lark - Bạn đã báo cáo đầy đủ thông tin công việc trên lark chưa?'] === true || ans['Bạn đã báo cáo đầy đủ thông tin công việc trên lark chưa?'] === true,
                                        ans['Bạn đã check lại caption và hagtag video chưa?'] === true || ans['Báo cáo Lark - Bạn đã check lại caption và hagtag video chưa?'] === true
                                    ];
                                    const count = checks.filter(Boolean).length;
                                    checklistStr = `${count}/6`;
                                }
                            }

                            latestMembers.set(key, {
                                name: k.name,
                                team: k.team || null,
                                video: `${k.completed_month || 0} (${contribution}% đóng góp)`,
                                traffic: Number(k.traffic_month || 0).toLocaleString('vi-VN'),
                                revenue: Number(k.revenue_month || 0).toLocaleString('vi-VN'),
                                channels: channelCount,
                                checklist: checklistStr,
                                isLeader: k.tag?.toLowerCase().includes('leader') || false
                            });
                        }
                    });
                    membersList = Array.from(latestMembers.values());
                } catch (e) {
                    this.logger.error('Failed to fetch members list', e);
                }

                return { history, teamStats, companyStats, userActivity, members: membersList };
            } catch (error) {
                this.logger.error(`Error in getPersonalHistory for ${requesterEmail}: ${error.message}`, error.stack);
                throw error;
            }
        }); // end cacheService.get
    }


    private async fetchAllRecords(baseId: string, tableId: string) {
        const token = await this.getAccessToken();
        let allRecords = [];
        let hasMore = true;
        let pageToken = '';

        while (hasMore) {
            const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/records`;
            const response = await this.withRetry(() => firstValueFrom(
                this.httpService.get(url, {
                    headers: { Authorization: `Bearer ${token}` },
                    params: {
                        text_field_as_key: true,
                        page_size: 100,
                        page_token: pageToken || undefined
                    },
                }),
            ), 3, `fetchAllRecords(${tableId})`);

            if (response.data.code !== 0) {
                throw new Error(`Lark API Error: ${response.data.msg}`);
            }

            const data = response.data.data;
            if (data.items) {
                allRecords = allRecords.concat(data.items);
            }
            hasMore = data.has_more;
            pageToken = data.page_token;
        }
        return allRecords;
    }
    private fieldMaps: Map<string, any> = new Map();

    private async getTableFields(baseId: string, tableId: string) {
        const token = await this.getAccessToken();
        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/fields`;

        try {
            const response = await firstValueFrom(
                this.httpService.get(url, {
                    headers: { Authorization: `Bearer ${token}` },
                })
            );
            return response.data.data?.items || [];
        } catch (error) {
            this.logger.error(`Failed to fetch fields for table ${tableId}`, error);
            return [];
        }
    }

    private async getOutstandingFieldMap() {
        const cacheKey = `${this.REPORT_BASE_ID}_${this.OUTSTANDING_TABLE_ID}`;
        if (this.fieldMaps.has(cacheKey)) {
            return this.fieldMaps.get(cacheKey);
        }

        const fields = await this.getTableFields(this.REPORT_BASE_ID, this.OUTSTANDING_TABLE_ID);
        const map = {
            approval_status: 'Duyệt',
            status: 'Trạng thái',
            approved_by: 'Người duyệt'
        };

        // Try to find exact matches in the table structure (handling normalization/alt spellings)
        const normalize = (s: string) => s.normalize('NFD').toLowerCase().replace(/[^\x00-\x7F]/g, "");

        const findField = (labels: string[]) => {
            for (const label of labels) {
                const found = fields.find(f =>
                    f.field_name === label ||
                    normalize(f.field_name) === normalize(label)
                );
                if (found) return found.field_name;
            }
            return labels[0];
        };

        const result = {
            approval_status: findField(['Duyệt', 'Duyệt', 'Duyet']),
            status: findField(['Trang Thai', 'Trạng thái', 'Trạng Thái']),
            approved_by: findField(['Người duyệt', 'Người duyệt', 'Nguoi duyet'])
        };

        this.fieldMaps.set(cacheKey, result);
        this.logger.log(`Field mapping for Outstanding table: ${JSON.stringify(result)}`);
        return result;
    }

    /**
     * Search records in a Lark bitable table by a filter string (Lark formula syntax)
     * Returns array of { record_id, fields }
     */
    private async searchLarkRecords(baseId: string, tableId: string, filter: string): Promise<{ record_id: string; fields: any }[]> {
        const token = await this.getAccessToken();
        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/records`;
        const allRecords: any[] = [];
        let pageToken = '';
        let hasMore = true;

        while (hasMore) {
            const response = await this.withRetry(() => firstValueFrom(
                this.httpService.get(url, {
                    headers: { Authorization: `Bearer ${token}` },
                    params: {
                        text_field_as_key: true,
                        page_size: 100,
                        filter,
                        ...(pageToken ? { page_token: pageToken } : {}),
                    },
                })
            ), 3, `searchLarkRecords(${tableId})`);
            if (response.data.code !== 0) break;
            const data = response.data.data;
            allRecords.push(...(data.items || []));
            hasMore = data.has_more;
            pageToken = data.page_token;
        }
        return allRecords;
    }

    /**
     * Retry utility: thử lại tối đa `maxRetries` lần với exponential backoff.
     * Lần 1 thất bại → chờ 1s → lần 2, thất bại → chờ 2s → lần 3...
     */
    async withRetry<T>(
        fn: () => Promise<T>,
        maxRetries = 3,
        label = 'operation',
    ): Promise<T> {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (err) {
                this.logger.warn(
                    `[Retry] ${label} — lần ${attempt}/${maxRetries} thất bại: ${err.message}`,
                );
                if (attempt === maxRetries) {
                    this.logger.error(
                        `[Retry] ${label} — đã thử ${maxRetries} lần, bỏ cuộc.`,
                    );
                    throw err;
                }
                const waitMs = 1000 * attempt; // 1s, 2s, 3s...
                this.logger.log(`[Retry] Chờ ${waitMs}ms trước khi thử lại...`);
                await new Promise(r => setTimeout(r, waitMs));
            }
        }
    }

    /**
     * Push user info changes (name, team, email) to all synced Lark bitable tables.
     * Called fire-and-forget after DB local is already updated.
     */
    async pushUserChangesToLark(params: {
        oldName: string;
        oldEmail: string;
        newName?: string;
        newTeam?: string;
        newEmail?: string;
    }) {
        const { oldName, oldEmail, newName, newTeam, newEmail } = params;
        const nameChanged = newName && newName !== oldName;
        const teamChanged = newTeam !== undefined;
        const emailChanged = newEmail && newEmail !== oldEmail;

        if (!nameChanged && !teamChanged && !emailChanged) return;

        this.logger.log(`[LarkSync] Pushing user changes to Lark Suite for: ${oldEmail || oldName}`);

        // Helper: build batch_update records from search results
        const buildBatchPayload = (records: any[], fieldUpdates: Record<string, string>) => {
            return records.map(r => ({ record_id: r.record_id, fields: fieldUpdates }));
        };

        // Helper: batch update to a table
        const batchUpdate = async (baseId: string, tableId: string, records: any[]) => {
            if (!records.length) return;
            const token = await this.getAccessToken();
            const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/records/batch_update`;
            // Lark allows max 500 records per batch
            const chunks = [];
            for (let i = 0; i < records.length; i += 200) chunks.push(records.slice(i, i + 200));
            for (const chunk of chunks) {
                await this.withRetry(
                    () => firstValueFrom(
                        this.httpService.post(url, { records: chunk }, {
                            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                        })
                    ),
                    3,
                    `batchUpdate(${tableId})`,
                );
            }
        };

        // Sections 1 & 2 (lark_reports, report_outstanding) decoupled from Lark Suite

        // ── 3. lark_kpi (KPI_BASE_ID / KPI_TABLE_ID) ────────────────────────────
        try {
            const records = await this.searchLarkRecords(this.KPI_BASE_ID, this.KPI_TABLE_ID,
                `CurrentValue.[Họ và Tên] = "${oldName}"`);
            const updates: Record<string, string> = {};
            if (nameChanged) updates['Họ và Tên'] = newName;
            if (teamChanged) updates['Team'] = newTeam;
            await batchUpdate(this.KPI_BASE_ID, this.KPI_TABLE_ID, buildBatchPayload(records, updates));
            this.logger.log(`[LarkSync] lark_kpi: updated ${records.length} records`);
        } catch (e) { this.logger.warn(`[LarkSync] lark_kpi sync failed: ${e.message}`); }

        // ── 4. lark_employees (KPI_BASE_ID / EMPLOYEE_TABLE_ID) ─────────────────
        try {
            const records = await this.searchLarkRecords(this.KPI_BASE_ID, this.EMPLOYEE_TABLE_ID,
                `CurrentValue.[Họ và Tên] = "${oldName}"`);
            const updates: Record<string, string> = {};
            if (nameChanged) updates['Họ và Tên'] = newName;
            if (teamChanged) updates['Team'] = newTeam;
            await batchUpdate(this.KPI_BASE_ID, this.EMPLOYEE_TABLE_ID, buildBatchPayload(records, updates));
            this.logger.log(`[LarkSync] lark_employees: updated ${records.length} records`);
        } catch (e) { this.logger.warn(`[LarkSync] lark_employees sync failed: ${e.message}`); }

        // ── 5. lark_list_tasks (KPI_BASE_ID / LIST_TASK_TABLE_ID) ───────────────
        try {
            const filter = oldEmail
                ? `CurrentValue.[Email] = "${oldEmail}"`
                : `CurrentValue.[Họ và Tên] = "${oldName}"`;
            const records = await this.searchLarkRecords(this.KPI_BASE_ID, this.LIST_TASK_TABLE_ID, filter);
            const updates: Record<string, string> = {};
            if (nameChanged) updates['Họ và Tên'] = newName;
            if (teamChanged) updates['Team'] = newTeam;
            if (emailChanged) updates['Email'] = newEmail;
            await batchUpdate(this.KPI_BASE_ID, this.LIST_TASK_TABLE_ID, buildBatchPayload(records, updates));
            this.logger.log(`[LarkSync] lark_list_tasks: updated ${records.length} records`);
        } catch (e) { this.logger.warn(`[LarkSync] lark_list_tasks sync failed: ${e.message}`); }

        this.logger.log(`[LarkSync] Done pushing user changes to Lark Suite`);
    }

    private async updateBitableRecord(baseId: string, tableId: string, recordId: string, fields: any) {
        const token = await this.getAccessToken();
        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/records/${recordId}`;

        // Use batch_update internally if single PATCH fails or just always use it?
        // Let's try to make single PATCH work first with correct field names
        try {
            const response = await firstValueFrom(
                this.httpService.patch(url, { fields }, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                })
            );
            return response.data;
        } catch (error) {
            this.logger.error(`Failed to update Bitable record ${recordId} at ${url}`, error.response?.data || error.message);
            // Fallback to batch_update if 404/FieldNameNotFound
            if (error.response?.status === 404) {
                const batchUrl = `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/records/batch_update`;
                try {
                    const batchRes = await firstValueFrom(
                        this.httpService.post(batchUrl, {
                            records: [{ record_id: recordId, fields }]
                        }, {
                            headers: {
                                Authorization: `Bearer ${token}`,
                                'Content-Type': 'application/json',
                            },
                        })
                    );
                    return batchRes.data;
                } catch (batchErr) {
                    this.logger.error(`Batch update also failed for ${recordId}`, batchErr.response?.data || batchErr.message);
                    throw batchErr;
                }
            }
            throw error;
        }
    }

    async updateOutstandingStatus(id: string, status: string, approvedBy?: string) {
        try {
            // Update local database
            // We update both status and approval_status for compatibility
            if (approvedBy) {
                await this.prisma.$executeRawUnsafe(
                    `UPDATE "report_outstanding" SET "status" = $1, "approval_status" = $1, "approved_by" = $2, "updated_at" = NOW() WHERE "id" = $3`,
                    status, approvedBy, id
                );
            } else {
                await this.prisma.$executeRawUnsafe(
                    `UPDATE "report_outstanding" SET "status" = $1, "approval_status" = $1, "updated_at" = NOW() WHERE "id" = $2`,
                    status, id
                );
            }

            // Sync to Lark Suite disabled as per user request
            /*
            if (id && !id.startsWith('out_')) {
                const larkFields: any = {
                    'Duyệt': status,
                    'Trạng thái': status,
                };
                if (approvedBy) {
                    larkFields['Người duyệt'] = approvedBy;
                }

                await this.updateBitableRecord(
                    this.REPORT_BASE_ID,
                    this.OUTSTANDING_TABLE_ID,
                    id,
                    larkFields
                );
            }
            */

            return { success: true, message: 'Status updated successfully (Local only)' };
        } catch (error) {
            this.logger.error(`Failed to update outstanding status for id ${id}`, error);
            throw error;
        }
    }

    async pushAllOutstandingData() {
        this.logger.log('[LarkSync] pushAllOutstandingData disabled - this table is now independent.');
        return { success: true, message: 'Pushing to Lark disabled.' };
    }

    async syncHRData() {
        // Run permission sync first, then HR employee sync so team data is always authoritative.
        await this.syncPermissionData();
        return this.syncEmployeeData();
    }

    async getHRDataStatus() {
        return { message: 'HR Data sync status not implemented' };
    }

    // --- HELPER METHODS FOR LarkSyncService ---
    async fetchHRRecords() {
        return this.fetchAllRecords(this.REPORT_BASE_ID, this.PERMISSION_TABLE_ID);
    }

    parseRecord(record: any) {
        const fields = record.fields;
        if (!fields['Email']) return null;

        const trangThai = String(fields['Trang Thai'] || fields['Trạng thái'] || '').toLowerCase();
        const isActive = trangThai !== 'da nghi' && trangThai !== 'đã nghỉ' && trangThai !== 'nghi viec';

        return {
            email: fields['Email'],
            full_name: fields['HoTen'] || fields['Họ Tên'] || 'Unknown',
            role: fields['Role'] || fields['Chức vụ'] || 'MEMBER',
            team: fields['Team'] || fields['Phòng ban'] || 'None',
            position: fields['Chức vụ'] || fields['Position'] || fields['Role'] || '',
            is_active: isActive,
        };
    }

    mapToUserRoles(role: string, team: string, position?: string): string[] {
        const roles: string[] = [];
        const r = (role || '').toUpperCase();
        const p = (position || '').toUpperCase();

        const leaderKeywords = ['LEADER', 'LEAD', 'TRƯỞNG', 'QUẢN LÝ', 'TP '];

        if (r.includes('ADMIN')) {
            roles.push('ADMIN');
        } else if (r.includes('MANAGER')) {
            roles.push('MANAGER');
        } else if (leaderKeywords.some(key => r.includes(key) || p.includes(key))) {
            roles.push('LEADER');
        } else {
            roles.push('MEMBER');
        }

        return Array.from(new Set(roles));
    }

    private rkReportAvatar(rk: any): string | null {
        if (!rk || !rk.image_url) return null;
        if (typeof rk.image_url === 'string') return rk.image_url;
        if (Array.isArray(rk.image_url) && rk.image_url.length > 0) {
            // Lark attachments often have a 'url' or 'attachment_id' or 'file_token'
            return rk.image_url[0].url || rk.image_url[0].file_token || rk.image_url[0].attachment_id || null;
        }
        return null;
    }

    async inspectTableGeneric(baseId: string, tableId: string) {
        try {
            const records = await this.fetchLarkRecordsGeneric(baseId, tableId);
            if (records.length > 0) {
                const allFieldNames = new Set<string>();
                records.forEach(record => {
                    Object.keys(record.fields).forEach(key => allFieldNames.add(key));
                });
                return {
                    totalRecords: records.length,
                    allUniqueFields: Array.from(allFieldNames),
                    sampleRecords: records.slice(0, 3).map(r => r.fields)
                };
            }
            return { message: 'No records found' };
        } catch (error) {
            this.logger.error(`Failed to inspect table ${tableId}`, error);
            throw error;
        }
    }

    // --- ListTask Sync Methods ---

    async fetchListTaskRecords() {
        return this.fetchLarkRecordsGeneric(this.KPI_BASE_ID, this.LIST_TASK_TABLE_ID);
    }

    private mapRecordToListTask(record: any) {
        const fields = record.fields;

        const extractString = (val: any): string | null => {
            if (!val) return null;
            if (typeof val === 'string') return val;
            if (Array.isArray(val) && val.length > 0) {
                const first = val[0];
                return first.name || first.text || (typeof first === 'string' ? first : null);
            }
            if (typeof val === 'object') return val.name || val.text || null;
            return String(val);
        };

        // Special handler for Single Select fields - avoids storing raw Lark option IDs (opt...)
        const extractSingleSelect = (val: any): string | null => {
            if (!val) return null;
            // Lark SingleSelect often returns [{id: 'optXXX', name: 'Team K0', color: ...}]
            if (Array.isArray(val) && val.length > 0) {
                const first = val[0];
                if (first && typeof first === 'object') return first.name || null;
                if (typeof first === 'string' && !first.startsWith('opt')) return first;
                return null;
            }
            if (typeof val === 'object') return val.name || null;
            if (typeof val === 'string' && !val.startsWith('opt')) return val;
            return null;
        };

        const extractLink = (val: any): string | null => {
            if (!val) return null;
            if (typeof val === 'string') return val;
            if (Array.isArray(val) && val.length > 0) return extractLink(val[0]);
            return val.link || val.text || null;
        };

        const extractDate = (val: any) => {
            if (!val) return null;
            return new Date(val);
        };

        // Extraction of specific fields
        const deadlineVal = fields['Deadline'];
        const deadlineText = extractString(deadlineVal);

        const fileContentVal = fields['File content'];
        let fileContentUrl = null;
        let fileContentName = null;
        if (Array.isArray(fileContentVal) && fileContentVal.length > 0) {
            fileContentUrl = fileContentVal[0].link || null;
            fileContentName = fileContentVal[0].text || null;
        }

        const fileVoiceVal = fields['File voice'];
        const fileVoiceToken = Array.isArray(fileVoiceVal) && fileVoiceVal.length > 0 ? fileVoiceVal[0].attachmentToken : null;

        const nhanVien = fields['Nhân Viên'];
        let empEmail = null;
        let empName = null;
        if (nhanVien && nhanVien.users && nhanVien.users.length > 0) {
            empEmail = nhanVien.users[0].email;
            empName = nhanVien.users[0].name;
        }

        return {
            id: record.record_id,
            caption: fields['Caption'] || null,
            deadline: deadlineText,
            file_content_url: fileContentUrl,
            file_content_name: fileContentName,
            file_voice_token: fileVoiceToken,
            employee_id: extractString(fields['ID Nhân viên'] || fields['ID Nhân Viên']),
            employee_name: empName,
            employee_email: empEmail,
            content: extractString(fields['Nội Dung']),
            sku: extractString(fields['SKU']),
            source_huyk: extractLink(fields['Source HuyK']),
            source_outro: extractLink(fields['Source Outro']),
            source_collection: extractLink(fields['Source Sản phẩm sưu tầm']),
            team: extractSingleSelect(fields['Team']),
            tiktok_post: extractString(fields['Tiktok Post']),
            status: fields['Trạng Thái'] || null,
            content_type: extractSingleSelect(fields['Tuyến Nội Dung']) || extractString(fields['Tuyến Nội Dung']),
            product_name: extractString(fields['Tên Sản Phẩm']),
            link_tiktok: fields['Link Tiktok'] || null,
            date: extractDate(fields['Ngày']),
            created_at_lark: extractDate(fields['Ngày tạo']),
        };
    }

    async syncListTaskData() {
        try {
            const records = await this.fetchListTaskRecords();
            this.logger.log(`Fetched ${records.length} ListTask records from Lark. Syncing...`);

            const allData = records.map(r => this.mapRecordToListTask(r));

            // Use an atomic transaction with deleteMany + createMany for maximum speed
            // This replaces 10,000 upsert queries (which take 18 mins) with 3 queries (taking ~100ms)
            const CHUNK = 3000;
            const createQueries = [];
            for (let i = 0; i < allData.length; i += CHUNK) {
                createQueries.push(
                    this.prisma.larkListTask.createMany({
                        data: allData.slice(i, i + CHUNK),
                        skipDuplicates: true
                    })
                );
            }

            await this.prisma.$transaction([
                this.prisma.larkListTask.deleteMany({}),
                ...createQueries
            ]);

            let syncedCount = allData.length;

            this.logger.log(`Successfully synced ${syncedCount} ListTask records.`);
            return { synced: syncedCount, total: records.length };
        } catch (error) {
            this.logger.error('Failed to sync ListTask data', error);
            throw error;
        }
    }

    async getListTaskData() {
        return this.prisma.larkListTask.findMany({
            orderBy: { date: 'desc' },
            take: 500,
        });
    }

    async getDashboardAnalytics(filters?: { startDate?: string; endDate?: string; team?: string }) {
        const cacheKey = `dashboard-analytics:${filters?.startDate || ''}:${filters?.endDate || ''}:${filters?.team || 'All'}`;
        return this.cacheService.get(cacheKey, 3 * 60 * 1000, () => this._buildDashboardAnalytics(filters));
    }

    private async _buildDashboardAnalytics(filters?: { startDate?: string; endDate?: string; team?: string }) {
        const start = filters?.startDate ? new Date(filters.startDate) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const end = filters?.endDate ? new Date(filters.endDate) : new Date();
        const teamFilter = filters?.team === 'All' || !filters?.team ? null : filters?.team.toLowerCase().trim();

        const monthsInRange: { monthNum: number; year: number; formats: string[] }[] = [];
        {
            let curr = new Date(start.getFullYear(), start.getMonth(), 1);
            const endLimit = new Date(end.getFullYear(), end.getMonth(), 1);
            while (curr <= endLimit) {
                const m = curr.getMonth() + 1;
                const y = curr.getFullYear();
                monthsInRange.push({
                    monthNum: m,
                    year: y,
                    formats: [
                        `T${m}`, `T${m < 10 ? '0' + m : m}`,
                        `Tháng ${m}`, `tháng ${m}`,
                        `Thang ${m}`, `thang ${m}`,
                        `${m}`, m < 10 ? `0${m}` : `${m}`
                    ]
                });
                curr.setMonth(curr.getMonth() + 1);
            }
        }

        // Fetch everything
        const [tasks, allKpisInDb, usersWithChannels, allChannels] = await Promise.all([
            this.prisma.larkListTask.findMany({
                where: {
                    date: { gte: start, lte: end },
                    status: { in: ['Done', 'Đã hoàn thành', 'Hoàn thành'] }
                },
                select: { id: true, content_type: true, employee_id: true, employee_name: true, employee_email: true, team: true }
            }),
            this.prisma.larkKPI.findMany({
                where: {
                    OR: [
                        { month: { in: monthsInRange.flatMap(m => m.formats) } },
                        {
                            AND: [
                                { month: null },
                                { report_date: { gte: start, lte: end } }
                            ]
                        }
                    ],
                    // Safely omitted DB state filter to include nullable rows (handled in-memory by downstream filtering)
                },
                orderBy: { report_date: 'desc' },
                select: {
                    id: true, employee_id: true, name: true, tag: true, team: true,
                    month: true, report_date: true, state: true,
                    kpi_day: true, kpi_month: true, completed_day: true, completed_month: true,
                    kpi_progress_month: true, traffic_month: true, revenue_month: true,
                    target_traffic_month: true, target_revenue_month: true,
                    task_auto: true, task_auto_month: true, task_new: true, task_new_month: true,
                },
            }),
            this.prisma.user.findMany({
                select: {
                    id: true,
                    email: true,
                    full_name: true,
                    team: true,
                    roles: true,
                    _count: {
                        select: { tracked_channels: true }
                    }
                }
            }),
            this.prisma.channel.findMany({
                where: {
                    status: 'Đang hoạt động',
                    ...(teamFilter ? { team_traffic: { contains: teamFilter, mode: 'insensitive' } } : {})
                }
            })
        ]);

        // Filter KPIs matching the selected period
        const kpis = allKpisInDb.filter(k => {
            if (k.state?.toLowerCase() === 'off') return false;
            const mStr = (k.month || '').trim();

            if (!mStr) {
                const rd = k.report_date ? new Date(k.report_date) : null;
                return rd && monthsInRange.some(m => rd.getMonth() + 1 === m.monthNum && rd.getFullYear() === m.year);
            }

            return monthsInRange.some(monthInfo => {
                if (monthInfo.formats.includes(mStr)) return true;
                const mDigits = mStr.match(/\d+/g);
                return mDigits && mDigits.some(d => parseInt(d, 10) === monthInfo.monthNum);
            });
        });

        // 1. Map users by email and name for robust lookup
        const employeeMapByEmail = new Map<string, any>();
        const employeeMapByName = new Map<string, any>();
        const activeTeamMembers: any[] = [];

        usersWithChannels.forEach(u => {
            const email = u.email?.toLowerCase().trim();
            if (email) employeeMapByEmail.set(email, u);

            const name = u.full_name?.toLowerCase().trim().replace(/\s+/g, ' ');
            if (name) employeeMapByName.set(name, u);

            // If we have a team filter, collect all matching members
            if (teamFilter && u.team) {
                const userTeams = u.team.split(',').map(t => t.trim().toLowerCase());
                if (userTeams.some(t => t === teamFilter || t.includes(teamFilter))) {
                    activeTeamMembers.push(u);
                }
            }
        });

        // 2. Build name -> team map from KPI data
        const nameToTeamMap = new Map<string, string>();
        allKpisInDb.forEach(k => {
            const nameKey = k.name?.toLowerCase().trim().replace(/\s+/g, ' ');
            if (nameKey && k.team && !k.team.startsWith('opt')) {
                nameToTeamMap.set(nameKey, k.team);
            }
        });

        // 3. Initialize aggregation map with ALL team members if filtered
        const kpisForAggregation = new Map<string, any>();

        if (teamFilter && activeTeamMembers.length > 0) {
            activeTeamMembers.forEach(emp => {
                const personKey = emp.email?.toLowerCase().trim() || emp.full_name?.toLowerCase().trim();
                const vn = monthsInRange[0] || { monthNum: new Date().getMonth() + 1, year: new Date().getFullYear() };
                const stubKey = `${personKey}_${teamFilter}_T${vn.monthNum}_${vn.year}`;

                kpisForAggregation.set(stubKey, {
                    id: `stub_${emp.id}`,
                    name: emp.full_name,
                    email: emp.email,
                    team: emp.team || filters?.team || 'Khác',
                    kpi_day: 0,
                    kpi_month: 0,
                    completed_day: 0,
                    completed_month: 0,
                    traffic_month: 0,
                    revenue_month: 0,
                    kpi_progress_month: 0,
                    is_stub: true
                });
            });
        }

        // Helper to get team from any source (avoid opt... IDs)
        const resolveTeam = (taskTeam: string | null, nameKey: string): string => {
            if (!taskTeam || taskTeam.startsWith('opt')) {
                return nameToTeamMap.get(nameKey) || 'Khác';
            }
            return taskTeam;
        };

        // Maps channels by owner name
        const channelsByOwnerMap = new Map<string, number>();
        allChannels.forEach(c => {
            if (c.owner) {
                const ownerKey = c.owner.toLowerCase().trim().replace(/\s+/g, ' ');
                channelsByOwnerMap.set(ownerKey, (channelsByOwnerMap.get(ownerKey) || 0) + 1);
            }
        });

        const getRegion = (teamName: string) => {
            const t = (teamName || '').toLowerCase();
            if (t.includes('global') || t.includes('thái lan') || t.includes('đài loan') || t.includes('indo') || t.includes('jp')) return 'global';
            return 'vn';
        };

        const regionalChannelCounts = { vn: 0, global: 0 };
        allChannels.forEach(c => {
            const region = getRegion(c.team_traffic || '');
            regionalChannelCounts[region]++;
        });

        // Group Stats Map
        const empStats = new Map<string, {
            name: string,
            email: string,
            empId: string,
            team: string,
            videoCount: number,
            lineCounts: { [line: string]: number },
            traffic: number,
            revenue: number,
            channels: number,
            isLeader: boolean
        }>();

        // 1. First Pass: Base everyone on LarkKPI metadata and "completed_month" as requested
        kpis.forEach(kpi => {
            const nameKey = kpi.name?.toLowerCase().trim().replace(/\s+/g, ' ') || '';
            const email = this.extractEmailFromKpi(kpi);
            const key = email || nameKey;

            if (!key) return;

            const trafficVal = Number(kpi.traffic_month || 0);
            const revenueVal = Number(kpi.revenue_month || 0);
            const videosVal = Number(kpi.completed_month || 0);
            const teamName = kpi.team || 'Khác';

            // Filter by team if requested
            if (teamFilter && !teamName.toLowerCase().includes(teamFilter) && !teamFilter.includes(teamName.toLowerCase())) {
                return;
            }

            // Keep the latest/best record for the range if duplicates exist
            if (empStats.has(key)) {
                const existing = empStats.get(key)!;
                // Use Math.max for all progress fields to avoid 0-overwrites
                existing.videoCount = Math.max(existing.videoCount, videosVal);
                existing.traffic = Math.max(existing.traffic, trafficVal);
                existing.revenue = Math.max(existing.revenue, revenueVal);

                // If the selected range is just one day, we prefer that day's completed_day
                const targetDStr = start.toDateString();
                const kpiDStr = kpi.report_date ? new Date(kpi.report_date).toDateString() : null;
                if (start.getTime() === end.getTime() && kpiDStr === targetDStr) {
                    // Update videoCount to daily count if specifically looking at one day
                    existing.videoCount = Number(kpi.completed_day) || existing.videoCount;
                }
            } else {
                const user = email ? employeeMapByEmail.get(email) : null;
                const targetDStr = start.toDateString();
                const kpiDStr = kpi.report_date ? new Date(kpi.report_date).toDateString() : null;

                // Use completed_day if single day selected, else completed_month
                const effectiveVideoCount = (start.getTime() === end.getTime() && kpiDStr === targetDStr)
                    ? (Number(kpi.completed_day) || 0)
                    : videosVal;

                empStats.set(key, {
                    name: kpi.name || 'Unknown',
                    email: email || '',
                    empId: kpi.employee_id || 'unknown',
                    team: teamName,
                    videoCount: effectiveVideoCount,
                    lineCounts: {},
                    traffic: trafficVal,
                    revenue: revenueVal,
                    channels: channelsByOwnerMap.get(nameKey) || user?._count.tracked_channels || 0,
                    isLeader: user?.roles.includes(UserRole.MANAGER) || user?.roles.includes(UserRole.ADMIN) || false
                });
            }
        });

        // 2. Second Pass: Distribute LarkListTask into Line Breakdown
        tasks.forEach(task => {
            const email = (task.employee_email || '').toLowerCase().trim();
            const nameKey = task.employee_name?.toLowerCase().trim().replace(/\s+/g, ' ') || '';
            const key = email || nameKey;

            if (empStats.has(key)) {
                const stats = empStats.get(key)!;
                const line = task.content_type || 'Khác';
                stats.lineCounts[line] = (stats.lineCounts[line] || 0) + 1;
                // Also fix team if it's currently 'Khác' and we can resolve better
                if (stats.team === 'Khác') {
                    const resolved = resolveTeam(task.team, nameKey);
                    if (resolved !== 'Khác') stats.team = resolved;
                }
            } else {
                // If person not in KPI, we can still show them if they have tasks
                const user = email ? employeeMapByEmail.get(email) : null;
                const resolvedTeam = resolveTeam(task.team, nameKey);

                // Apply team filter for these fallback entries
                if (teamFilter && !resolvedTeam.toLowerCase().includes(teamFilter) && !teamFilter.includes(resolvedTeam.toLowerCase())) {
                    return;
                }

                empStats.set(key, {
                    name: task.employee_name || 'Unknown',
                    email: email,
                    empId: task.employee_id || 'unknown',
                    team: resolvedTeam,
                    videoCount: 1,
                    lineCounts: { [task.content_type || 'Khác']: 1 },
                    traffic: 0,
                    revenue: 0,
                    channels: channelsByOwnerMap.get(nameKey) || user?._count.tracked_channels || 0,
                    isLeader: user?.roles.includes(UserRole.MANAGER) || user?.roles.includes(UserRole.ADMIN) || false
                });
            }
            // For existing ones, if they have tasks, it adds to breakdown but doesn't change their KPI 'videoCount'
        });

        // 3. Merge stub members (users who appear in team but have no Lark data)
        // This ensures ALL active team members are visible on Dashboard even without KPI
        kpisForAggregation.forEach(stub => {
            const key = stub.email?.toLowerCase().trim() || stub.name?.toLowerCase().trim().replace(/\s+/g, ' ');
            if (!key || empStats.has(key)) return; // Skip if already in stats
            const user = stub.email ? employeeMapByEmail.get(stub.email.toLowerCase().trim()) : null;
            empStats.set(key, {
                name: stub.name || 'Unknown',
                email: stub.email || '',
                empId: stub.employee_id || 'unknown',
                team: stub.team || 'Khác',
                videoCount: 0,
                lineCounts: {},
                traffic: 0,
                revenue: 0,
                channels: channelsByOwnerMap.get((stub.name || '').toLowerCase().trim().replace(/\s+/g, ' ')) || user?._count?.tracked_channels || 0,
                isLeader: user?.roles?.includes(UserRole.MANAGER) || user?.roles?.includes(UserRole.ADMIN) || false
            });
        });

        // 4. Chart Data (Aggregate by Line)
        const lineStatsMap: { [line: string]: { videoCount: number, traffic: number } } = {};
        empStats.forEach(stats => {
            const totalTasks = Object.values(stats.lineCounts).reduce((a, b) => a + b, 0) || 1;
            Object.entries(stats.lineCounts).forEach(([line, count]) => {
                if (!lineStatsMap[line]) lineStatsMap[line] = { videoCount: 0, traffic: 0 };
                lineStatsMap[line].videoCount += count;
                // Distributed traffic based on proportion of tasks in this line
                lineStatsMap[line].traffic += stats.traffic * (count / totalTasks);
            });
        });

        const chartData = Object.entries(lineStatsMap).map(([line, data]) => ({
            name: line,
            videoCount: data.videoCount,
            traffic: Math.round(data.traffic)
        })).sort((a, b) => b.videoCount - a.videoCount);

        const regionalStats = {
            vn: { summary: { videos: 0, traffic: 0, revenue: 0, channels: regionalChannelCounts.vn }, teamsBySlug: {} as any },
            global: { summary: { videos: 0, traffic: 0, revenue: 0, channels: regionalChannelCounts.global }, teamsBySlug: {} as any }
        };

        empStats.forEach(stats => {
            const region = getRegion(stats.team);
            const target: any = regionalStats[region];
            const teamSlug = stats.team || 'Khác';

            target.summary.videos += stats.videoCount;
            target.summary.traffic += stats.traffic;
            target.summary.revenue += stats.revenue;
            // regional summary channel count is already set from Channel table direct count

            if (!target.teamsBySlug[teamSlug]) {
                target.teamsBySlug[teamSlug] = { name: teamSlug, members: [], stats: { videos: 0, traffic: 0, revenue: 0, channels: 0 } };
            }
            target.teamsBySlug[teamSlug].members.push(stats);
            target.teamsBySlug[teamSlug].stats.videos += stats.videoCount;
            target.teamsBySlug[teamSlug].stats.traffic += stats.traffic;
            target.teamsBySlug[teamSlug].stats.revenue += stats.revenue;
            target.teamsBySlug[teamSlug].stats.channels += stats.channels;
        });

        const formatRegion = (region: any) => {
            const teams = Object.values(region.teamsBySlug).map((team: any) => ({
                ...team,
                members: team.members.map((m: any) => ({
                    ...m,
                    contribution: region.summary.videos > 0 ? ((m.videoCount / region.summary.videos) * 100).toFixed(1) + '%' : '0%'
                })).sort((a: any, b: any) => (b.isLeader ? 1 : 0) - (a.isLeader ? 1 : 0) || b.videoCount - a.videoCount)
            }));
            return { summary: region.summary, teams };
        };

        // Comparison for Summary Card
        const duration = end.getTime() - start.getTime();
        const prevStart = new Date(start.getTime() - duration - (24 * 60 * 60 * 1000));
        const prevEnd = new Date(start.getTime() - (24 * 60 * 60 * 1000));
        const prevTasksCount = await this.prisma.larkListTask.count({
            where: {
                date: { gte: prevStart, lte: prevEnd },
                ...(teamFilter ? { team: { contains: teamFilter, mode: 'insensitive' } } : {})
            }
        });

        const totalVideosInRange = Array.from(empStats.values()).reduce((a, b) => a + Number(b.videoCount), 0);
        const totalTrafficInRange = Math.round(Array.from(empStats.values()).reduce((a, b) => a + b.traffic, 0));
        const totalRevenueInRange = Math.round(Array.from(empStats.values()).reduce((a, b) => a + b.revenue, 0));

        return {
            chartData,
            summary: {
                totalVideos: totalVideosInRange,
                prevVideos: prevTasksCount, // Note: Previous period comparison still uses tasks for now
                totalTraffic: totalTrafficInRange,
                totalRevenue: totalRevenueInRange
            },
            regionalStats: {
                vn: formatRegion(regionalStats.vn),
                global: formatRegion(regionalStats.global)
            }
        };
    }

    private extractEmailFromKpi(kpi: any): string | null {
        const empData: any = kpi.employee_data;
        if (Array.isArray(empData) && empData.length > 0 && empData[0]?.email) {
            return empData[0].email.toLowerCase();
        } else if (empData && Array.isArray(empData.users) && empData.users[0]?.email) {
            return empData.users[0].email.toLowerCase();
        }
        return null;
    }

    async clearAllListTasks() {
        return this.prisma.larkListTask.deleteMany();
    }
}
