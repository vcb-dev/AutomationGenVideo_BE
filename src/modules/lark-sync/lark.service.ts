
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma, UserRole } from '@prisma/client';
import { CacheService } from '../../common/cache/cache.service';
import { Semaphore } from '../../common/utils/semaphore';

/**
 * Đọc một ô số liệu người dùng nhập trong báo cáo Traffic/Doanh thu.
 *
 * → null  : ô để trống, người dùng KHÔNG báo cáo nền tảng này
 * → số    : người dùng có nhập, kể cả khi nhập 0
 *
 * Ranh giới này là bắt buộc: form ghi rõ "nếu không có hãy nhập số 0", mà trước đây code chỉ
 * lưu khi giá trị > 0 — nên một ngày doanh thu 0 đồng không sinh dòng nào, và vì
 * reportedRevenueTeams được suy ra từ chính các dòng đó, người dùng bị tính là chưa báo cáo
 * dù đã bấm gửi. Dùng chung cho cả 4 nhánh (traffic/doanh thu × breakdown/fallback).
 */
function readReportedValue(raw: unknown): number | null {
    if (raw === null || raw === undefined) return null;
    const digits = String(raw).replace(/\D/g, '');
    if (digits === '') return null;
    const value = Number.parseInt(digits, 10);
    return Number.isFinite(value) ? value : null;
}

@Injectable()
export class LarkService implements OnModuleInit {
    private readonly logger = new Logger(LarkService.name);
    private accessToken: string;
    private tokenExpiresAt: number;
    private readonly activitySharedCacheTtlMs: number;
    private readonly activityRoleCacheTtlMs: number;

    // Giới hạn số lần TÍNH TOÁN dashboard NẶNG (nhiều query song song) chạy đồng thời cho các
    // key/filter KHÁC NHAU → tránh cạn connection pool khi đông người xem cùng lúc. Same-key đã
    // được single-flight trong CacheService. Tune qua env LARK_DASHBOARD_CONCURRENCY (mặc định 3).
    private readonly dashboardReadSemaphore = new Semaphore(
        Math.max(1, parseInt(process.env.LARK_DASHBOARD_CONCURRENCY || '3', 10) || 3),
    );

    // Lark API credentials — vẫn cần để lấy access token cho Lark Drive (upload/xem ảnh bằng chứng)
    private readonly APP_ID: string;
    private readonly APP_SECRET: string;
    // Dùng làm parent_node khi upload ảnh bằng chứng lên Lark Drive
    private readonly KPI_BASE_ID: string;
    /** KPI hiệu suất Đồ Da — phân biệt bảng KPI DoDa-Editor khi tính dashboard */
    private readonly KPI_DODA_TABLE_ID: string;

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
        private readonly prisma: PrismaService,
        private readonly cacheService: CacheService,
    ) {
        // Load credentials from environment
        this.APP_ID = this.configService.get<string>('LARK_APP_ID');
        this.APP_SECRET = this.configService.get<string>('LARK_APP_SECRET');
        this.KPI_BASE_ID = this.configService.get<string>('LARK_QLTASK_BASE_ID');
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

    /**
     * Alias danh tính đã xác nhận thủ công (KHÔNG tự động đoán theo tên/email giống nhau) — dùng khi
     * 1 nhân viên có ≥2 tài khoản `users` (tài khoản cũ chưa dọn) và nộp báo cáo bằng tên/email của
     * tài khoản CŨ, khiến `getUserActivityReports` không khớp được về đúng danh tính "chuẩn" (đang
     * active) qua `emailKeyMatchMap`/`nameKeyMatchMap` — người đó bị tách thành 1 thẻ riêng, số liệu
     * bị chia đôi thay vì cộng dồn đúng người.
     *
     * CHỦ Ý KHÔNG tự động hoá việc phát hiện case này bằng cách so khớp tên gần giống: 2 nhân viên
     * KHÁC NHAU trùng tên là có thật trong DB (xem TR-8 trong BUGS.md — bug ghi đè dữ liệu chéo do
     * khớp nhầm theo tên) — tự động merge theo độ giống tên sẽ tái tạo đúng lớp bug đó nhưng ở tầng
     * hiển thị thay vì tầng ghi dữ liệu. Mỗi case ở đây phải được xác nhận thủ công là CÙNG 1 người
     * thật trước khi thêm vào danh sách.
     */
    private readonly KNOWN_IDENTITY_ALIASES: Array<{
        matchNameKey?: string;
        matchEmailKey?: string;
        canonicalNameKey?: string;
        canonicalEmailKey?: string;
    }> = [
        // "Chung Đỗ" (tài khoản cũ, dochung2741@gmail.com) === "Đỗ Đăng Chung" (tài khoản đang active).
        { matchNameKey: 'chung do', matchEmailKey: 'dochung2741@gmail.com', canonicalNameKey: 'do dang chung', canonicalEmailKey: 'dochung2741@gmail.com' },
    ];

    /** Tra `KNOWN_IDENTITY_ALIASES` — trả về record "chuẩn" (authoritative) nếu tên/email khớp 1 alias đã xác nhận. */
    private resolveKnownIdentityAlias(
        nameKeyMatchMap: Map<string, any>,
        emailKeyMatchMap: Map<string, any>,
        nameKey: string | null,
        emailKey: string | null | undefined,
    ): any {
        for (const alias of this.KNOWN_IDENTITY_ALIASES) {
            const matches =
                (alias.matchNameKey && nameKey === alias.matchNameKey) ||
                (alias.matchEmailKey && emailKey === alias.matchEmailKey);
            if (matches) {
                return (
                    (alias.canonicalNameKey && nameKeyMatchMap.get(alias.canonicalNameKey)) ||
                    (alias.canonicalEmailKey && emailKeyMatchMap.get(alias.canonicalEmailKey))
                );
            }
        }
        return null;
    }

    /**
     * Bảng `kpi_do_da` (model KpiDoDa). Cùng hình delegate với `kpi` trong schema.
     * Dùng unknown + KpiDelegate để tránh lệch kiểu giữa IDE (client cũ/cache) và `npx prisma generate`.
     */
    private get prismaKpiDoDa(): Prisma.KpiDelegate {
        return (this.prisma as unknown as { kpiDoDa: Prisma.KpiDelegate }).kpiDoDa;
    }

    /** Bảng KPI Đồ Da tách riêng theo Người edit + Ngày edit. */
    private get prismaKpiDoDaEditor() {
        return (this.prisma as unknown as { kpiDoDaEditor: any }).kpiDoDaEditor;
    }

    /** Bảng KPI Global Indo. */
    private get prismaKpiGlobalIndo(): Prisma.KpiDelegate {
        return (this.prisma as unknown as { kpiGlobalIndo: Prisma.KpiDelegate }).kpiGlobalIndo;
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
     * Nghiệp vụ: báo cáo (checklist/traffic) nộp sáng ngày S là dữ liệu VỀ ngày S-1
     * (ví dụ nộp sáng 17/7 → dữ liệu của 16/7). Trả về key YYYY-MM-DD của ngày S-1 (VN).
     */
    private previousVietnamDateKey(dateInput?: string | Date): string {
        const base = dateInput ? (typeof dateInput === 'string' ? new Date(dateInput) : dateInput) : new Date();
        const dateKey = this.toVietnamDateKey(base);
        const [y, m, d] = dateKey.split('-').map(Number);
        const anchor = new Date(Date.UTC(y, m - 1, d, 5, 0, 0, 0)); // 12:00 VN của ngày S
        const prev = new Date(anchor.getTime() - 24 * 60 * 60 * 1000);
        return this.toVietnamDateKey(prev);
    }

    /** Dựng instant 12:00 VN (05:00 UTC) từ 1 key YYYY-MM-DD — dùng để lưu cột `date` ổn định theo ngày VN. */
    private vietnamNoonUtcFromKey(dateKey: string): Date {
        const [y, m, d] = dateKey.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d, 5, 0, 0, 0));
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
        // Nghiệp vụ: nộp sáng ngày reportDate là báo cáo VỀ ngày reportDate-1 → lưu `date` = hôm qua,
        // không phải ngày nộp (ví dụ nộp sáng 17/7 → lưu 16/7).
        const targetDateKey = this.previousVietnamDateKey(reportDate || undefined);
        const now = this.vietnamNoonUtcFromKey(targetDateKey);
        const monthString = 'T' + parseInt(targetDateKey.split('-')[1], 10).toString();
        const bounds = getVietnamBounds(targetDateKey);

        // Guard: once a user already submitted traffic for this day, prevent duplicate re-submit.
        // Ưu tiên khớp theo email (định danh ổn định) — CHỈ fallback về khớp theo tên khi thực sự
        // không có email. Trước đây dùng OR (email HOẶC tên) ngay cả khi có email, nên 2 người khác
        // nhau trùng tên (đã xác nhận có thật trong DB, vd 2 người cùng tên "Bảo Việt" khác email,
        // cả 2 đang hoạt động) sẽ đè lẫn "trạng thái đã báo cáo" của nhau.
        const duplicateWhereIdentity: any = normalizedSubmitterEmail
            ? { email: { equals: normalizedSubmitterEmail, mode: 'insensitive' as any } }
            : (name && String(name).trim())
                ? { name: { equals: String(name).trim(), mode: 'insensitive' as any } }
                : null;
        if (duplicateWhereIdentity) {
            const existingTraffic = await this.prisma.trafficReport.findFirst({
                where: {
                    date: { gte: bounds.start, lte: bounds.end },
                    ...duplicateWhereIdentity,
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

        const platformKeys = ['fb', 'ig', 'tiktok', 'yt', 'thread', 'zalo'];
        const recordsToCreate = [];

        // 1. Process breakdown-based submissions
        platformKeys.forEach(pKey => {
            const platformEntries = breakdown[pKey] || [];
            platformEntries.forEach((entry: any) => {
                // Phải nhận cả số 0: form nói rõ "nếu không có hãy nhập số 0", mà bỏ qua val=0
                // thì hôm đó không có dòng nào → hệ thống vẫn coi là CHƯA báo cáo. Chỉ bỏ qua
                // dòng thật sự để trống (readReportedValue trả null).
                const val = readReportedValue(entry.value);
                if (val !== null) {
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
                const val = readReportedValue(traffic[pKey as keyof typeof traffic]);
                if (val !== null) {
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
                await this.prisma.trafficReport.createMany({
                    data: recordsToCreate,
                    skipDuplicates: true,
                });
            }

            this.invalidateActivityCache();

            return {
                message: `Traffic report submitted successfully. Created ${recordsToCreate.length} records.`,
                recordIds: recordsToCreate.map(r => r.id)
            };
        } catch (dbError) {
            this.logger.error('Error saving multi-row traffic report:', dbError);
            throw new Error(`Could not save traffic report: ${dbError.message}`);
        }
    }

    /**
     * Báo cáo doanh thu nhập tay — mirror submitTrafficReport() (cùng cơ chế ngày/team/chặn trùng),
     * nhưng không có ảnh minh chứng và không có nhánh fallback "legacy" (tính năng mới, không có
     * dữ liệu cũ để tương thích ngược).
     */
    async submitRevenueReport(payload: any) {
        const { email, name, revenue, channels, reportDate, team: payloadTeam } = payload;
        const normalizedSubmitterEmail = (email || '').trim().toLowerCase();
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

        const userRec = await this.prisma.user.findFirst({ where: { email: { equals: normalizedSubmitterEmail, mode: 'insensitive' as any } } });
        const roles = userRec?.roles || [];
        const isAdmin = roles.includes('ADMIN') || roles.includes('MANAGER');

        if (!isAdmin) {
            const todayVN = this.toVietnamDateKey(new Date());
            if (reportDate && reportDate > todayVN) {
                throw new Error('Không thể gửi báo cáo cho ngày trong tương lai.');
            }
        }

        const revenueDetails = (payload as any).revenueDetails;
        const breakdown = revenueDetails?.breakdown || {};
        // Nghiệp vụ giống traffic: nộp sáng ngày reportDate là báo cáo VỀ ngày reportDate-1.
        const targetDateKey = this.previousVietnamDateKey(reportDate || undefined);
        const now = this.vietnamNoonUtcFromKey(targetDateKey);
        const monthString = 'T' + parseInt(targetDateKey.split('-')[1], 10).toString();
        const bounds = getVietnamBounds(targetDateKey);

        // Chặn nộp trùng — cùng logic ưu tiên email > tên như traffic.
        const duplicateWhereIdentity: any = normalizedSubmitterEmail
            ? { email: { equals: normalizedSubmitterEmail, mode: 'insensitive' as any } }
            : (name && String(name).trim())
                ? { name: { equals: String(name).trim(), mode: 'insensitive' as any } }
                : null;
        if (duplicateWhereIdentity) {
            const existingRevenue = await this.prisma.revenueReport.findFirst({
                where: {
                    date: { gte: bounds.start, lte: bounds.end },
                    ...duplicateWhereIdentity,
                },
                orderBy: { created_at: 'desc' },
            });
            if (existingRevenue) {
                if (payloadTeam && String(payloadTeam).trim() && existingRevenue.team !== String(payloadTeam).trim()) {
                    // Khác team — cho phép tiếp tục nộp
                } else {
                    return {
                        message: 'Bạn đã báo cáo doanh thu cho ngày này rồi. Hệ thống giữ dữ liệu đã báo cáo.',
                        alreadySubmitted: true,
                        existingRecordDate: existingRevenue.created_at || existingRevenue.date,
                        recordIds: [],
                    };
                }
            }
        }

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

        const platformKeys = ['fb', 'ig', 'tiktok', 'yt', 'thread', 'zalo'];
        const recordsToCreate = [];

        platformKeys.forEach(pKey => {
            const platformEntries = breakdown[pKey] || [];
            platformEntries.forEach((entry: any) => {
                // Nhận cả 0 — xem ghi chú ở submitTrafficReport: bỏ qua 0 thì "báo cáo 0 đồng"
                // không để lại dấu vết nào và bị tính là chưa báo cáo.
                const val = readReportedValue(entry.value);
                if (val !== null) {
                    const data: any = {
                        id: `local_rev_${pKey}_${Math.random().toString(36).slice(2, 7)}_${Date.now()}`,
                        email, name, date: now, employee: name, team, month: monthString,
                        total_revenue: BigInt(val),
                        is_confirmed: 'Pending',
                    };
                    data[`revenue_${pKey}`] = BigInt(val);
                    data[`channel_${pKey}`] = entry.channel || null;
                    recordsToCreate.push(data);
                }
            });
        });

        // Fallback nếu FE gửi object revenue phẳng thay vì breakdown (không có nhiều dòng/kênh).
        if (recordsToCreate.length === 0 && revenue) {
            platformKeys.forEach(pKey => {
                const val = readReportedValue(revenue[pKey as keyof typeof revenue]);
                if (val !== null) {
                    const data: any = {
                        id: `local_rev_${pKey}_${Date.now()}`,
                        email, name, date: now, employee: name, team, month: monthString,
                        total_revenue: BigInt(val),
                        is_confirmed: 'Pending',
                    };
                    data[`revenue_${pKey}`] = BigInt(val);
                    data[`channel_${pKey}`] = (channels as any)?.[pKey] || null;
                    recordsToCreate.push(data);
                }
            });
        }

        try {
            if (recordsToCreate.length > 0) {
                await this.prisma.revenueReport.createMany({
                    data: recordsToCreate,
                    skipDuplicates: true,
                });
            }

            this.invalidateActivityCache();

            return {
                message: `Revenue report submitted successfully. Created ${recordsToCreate.length} records.`,
                recordIds: recordsToCreate.map(r => r.id)
            };
        } catch (dbError) {
            this.logger.error('Error saving multi-row revenue report:', dbError);
            throw new Error(`Could not save revenue report: ${dbError.message}`);
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
        // Nghiệp vụ: nộp sáng ngày reportDate là báo cáo VỀ ngày reportDate-1 (checklist hỏi "hôm qua...")
        // → lưu `date` = hôm qua, không phải ngày nộp (ví dụ nộp sáng 17/7 → lưu 16/7).
        const targetDateKey = this.previousVietnamDateKey(reportDate || undefined);
        const dateObj = this.vietnamNoonUtcFromKey(targetDateKey);

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

        const bounds = getVietnamBounds(targetDateKey);

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

        // Logic chống spam/duplicate: nếu hôm nay đã báo cáo rồi thì update (upsert theo existing.id).
        // Không lọc theo team — cùng 1 người chỉ có 1 checklist/ngày dù team thay đổi.
        // QUAN TRỌNG: ưu tiên khớp theo email (định danh ổn định), CHỈ fallback tên khi thực sự không
        // có email. Trước đây OR (email HOẶC tên) ngay cả khi có email — 2 người khác nhau trùng tên
        // (đã xác nhận có thật trong DB, vd 2 người cùng tên khác email, cả 2 đang hoạt động) sẽ khớp
        // nhầm vào record của người kia, và vì hàm này UPDATE theo existing.id nên báo cáo của người
        // đến sau sẽ GHI ĐÈ luôn answers + email của người đã nộp trước đó — mất dữ liệu thật.
        const existing = await this.prisma.checklistReport.findFirst({
            where: {
                date: { gte: bounds.start, lte: bounds.end },
                ...(normalizedEmail
                    ? { email: { equals: normalizedEmail, mode: 'insensitive' as any } }
                    : { name: { equals: finalName, mode: 'insensitive' as any } }),
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

        await this.prisma.checklistReport.upsert({
            where: { id: reportId },
            create: { ...data, created_at: new Date() },
            update: data
        });

        this.invalidateActivityCache();

        return {
            success: true,
            message: existing ? 'Cập nhật báo cáo thành công' : 'Gửi báo cáo thành công',
            alreadySubmitted: !!existing,
            id: reportId
        };
    }

    // Helper to get all reports from DB (for controller)
    async getReportData() {
        return this.prisma.checklistReport.findMany({
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
        const result = await this.prisma.checklistReport.deleteMany({});
        this.logger.log(`Deleted ${result.count} records from larkReport`);
        return result;
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

    // Get all KPI data from DB with caching and pagination
    async getKPIData(page: number = 1, pageSize: number = 50) {
        // Clamp values to prevent abuse
        const pageNum = Math.max(1, page);
        const size = Math.min(100, Math.max(10, pageSize));
        const skip = (pageNum - 1) * size;

        // Use cache key that includes pagination
        const cacheKey = `kpi:paginated:${pageNum}:${size}`;
        
        // 10 minute TTL for KPI data
        const KPI_CACHE_TTL_MS = 10 * 60 * 1000;

        return this.cacheService.get(cacheKey, KPI_CACHE_TTL_MS, async () => {
            this.logger.log(`[KPI] Fetching from DB - page ${pageNum}, size ${size}`);
            
            // Fetch both data and total count in parallel
            const [data, total] = await Promise.all([
                this.prisma.kpi.findMany({
                    orderBy: { report_date: 'desc' },
                    skip,
                    take: size,
                    select: {
                        id: true,
                        employee_id: true,
                        name: true,
                        team: true,
                        kpi_month: true,
                        completed_month: true,
                        revenue_month: true,
                        traffic_month: true,
                        kpi_progress_month: true,
                        report_date: true,
                        month: true,
                        state: true,
                        tag: true,
                    }
                }),
                this.prisma.kpi.count()
            ]);

            return {
                data,
                pagination: {
                    page: pageNum,
                    pageSize: size,
                    total,
                    totalPages: Math.ceil(total / size),
                    hasMore: pageNum * size < total,
                },
                timestamp: new Date().toISOString(),
            };
        });
    }

    async getKPIDoDaData() {
        const isDoDaEditorKpi = this.KPI_DODA_TABLE_ID === 'tblPIc4EQjd2wfAa';
        if (isDoDaEditorKpi) {
            return this.prismaKpiDoDaEditor.findMany({
                orderBy: [{ report_date: 'desc' }, { editor_name: 'asc' }],
            });
        }
        return this.prismaKpiDoDa.findMany({
            orderBy: { report_date: 'desc' },
        });
    }

    // Clear cache immediately after a report submission to prevent stale UI
    invalidateActivityCache() {
        this.cacheService.invalidate('activity:');
        this.cacheService.invalidate('dashboard-analytics:');
    }

    // Get combined user activity reports (ChecklistReport + Kpi)
    async getUserActivityReports(filters?: { date?: string; startDate?: string; endDate?: string; team?: string; requesterEmail?: string; timeType?: string }) {
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
        let requesterTeam: string | null = null;
        if (filters?.requesterEmail) {
            const roleData = await this.cacheService.get(roleCacheKey, this.activityRoleCacheTtlMs, async () => {
                const sysUser = await this.prisma.user.findFirst({
                    where: { email: { equals: filters.requesterEmail, mode: 'insensitive' } },
                    select: { roles: true, team: true },
                });
                let role = 'member';
                if (sysUser?.roles && sysUser.roles.length > 0) {
                    if (sysUser.roles.includes(UserRole.ADMIN)) role = 'admin';
                    else if (sysUser.roles.includes(UserRole.MANAGER)) role = 'manager';
                    else if (sysUser.roles.some((r) => r === ('LEADER' as any))) role = 'leader';
                }
                let team = sysUser?.team || null;
                if (!team) {
                    const recentKpis = await this.prisma.kpi.findMany({
                        where: { OR: [{ state: { not: 'off' } }, { state: null }] },
                        select: { team: true, employee_data: true },
                        orderBy: { report_date: 'desc' },
                        take: 100,
                    });
                    const requesterEmail = filters.requesterEmail.toLowerCase().trim();
                    const matched = recentKpis.find((kpi: any) => this.extractEmailFromKpi(kpi) === requesterEmail);
                    team = matched?.team || null;
                }

                return { role, team };
            });
            requesterRole = roleData.role;
            requesterTeam = roleData.team;
        }

        // Step 2: Fetch shared dataset (configurable TTL to control SQL pressure)
        const sharedData = await this.cacheService.get(sharedCacheKey, this.activitySharedCacheTtlMs, () => this.dashboardReadSemaphore.run(async () => {
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
                // "All" (không phân biệt hoa/thường) nghĩa là KHÔNG lọc — phải giữ null, nếu không
                // teamFilterNormalized sẽ thành chuỗi "all" và bị so khớp như một tên team thật,
                // khiến matchesTeamFilter loại bỏ toàn bộ record (không ai có team tên "all").
                const teamFilterNormalized =
                    filters?.team && filters.team.toLowerCase().trim() !== 'all'
                        ? filters.team.toLowerCase().trim()
                        : null;

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

                /**
                 * Dùng CHỈ cho `report_kpi` (bảng sync ngoài, lịch sử ghi lệch D+1 ở nguồn — không
                 * liên quan tới submitChecklistReport/submitTrafficReport trong file này).
                 * CHECKLIST và TRAFFIC (form nộp trong app) từ 2026-07-17 đã lưu thẳng `date` = ngày
                 * NGHIỆP VỤ D (submit* đã tự trừ lùi 1 ngày so với ngày nộp) → xem ngày D đọc đúng
                 * cửa sổ D (`larkKpiStartOfDay`/`larkKpiEndOfDay`), KHÔNG cộng thêm D+1 ở đây nữa.
                 */
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
                    `[KPI-DateMap] uiPerformance=${uiDayStartStr}..${uiDayEndStr} -> lark_kpi.report_date/traffic VN [${larkKpiStartOfDay.toISOString()}..${larkKpiEndOfDay.toISOString()}]; checklist + report_kpi (D+1) VN [${memberReportStart.toISOString()}..${memberReportEnd.toISOString()}] (day ${dataDayStartStr}..${dataDayEndStr})`,
                );

                // Checklist: record đã lưu thẳng `date` = ngày nghiệp vụ D (submitChecklistReport tự
                // trừ lùi 1 ngày so với ngày nộp) → đọc đúng cửa sổ D (larkKpiStartOfDay/EndOfDay).
                whereClause.date = {
                    gte: larkKpiStartOfDay,
                    lte: larkKpiEndOfDay,
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

                const isActiveEmployeeStatus = (raw: unknown): boolean => {
                    const st = String(raw || '')
                        .toLowerCase()
                        .normalize('NFD')
                        .replace(/[\u0300-\u036f]/g, '')
                        .replace(/đ/g, 'd')
                        .trim();
                    if (!st) return true;
                    return !st.includes('nghi') && !st.includes('off') && !st.includes('khoa');
                };

                // users.team → checklist (lark_reports). lark_kpi.team → hiệu suất (performance).
                // Role + employee_status: from users table.
                const allUsersForTeam = await this.prisma.user.findMany({
                    where: { is_active: true },
                    select: {
                        id: true,
                        email: true,
                        full_name: true,
                        team: true,
                        image_url: true,
                        roles: true,
                        employee_id: true,
                        employee_data: true,
                        employee_status: true,
                        employee_position: true,
                    },
                });
                // Trùng tên giữa 2 user active KHÁC email (vd VN team và Global team giờ dùng chung
                // roster) không được để map theo tên tự ý chọn 1 người — ai "thắng" phụ thuộc thứ tự
                // trả về không đảm bảo của Postgres (không ORDER BY), có thể đổi giữa các lần chạy.
                // Với tên này, chỉ tin được kết quả tra theo email; loại hẳn khỏi mọi map theo-tên.
                const nameToActiveEmails = new Map<string, Set<string>>();
                for (const u of allUsersForTeam) {
                    const nk = normName(u.full_name || '');
                    const em = String(u.email || '').toLowerCase().trim();
                    if (!nk || !em) continue;
                    if (!nameToActiveEmails.has(nk)) nameToActiveEmails.set(nk, new Set());
                    nameToActiveEmails.get(nk)!.add(em);
                }
                const ambiguousActiveNameKeys = new Set(
                    Array.from(nameToActiveEmails.entries())
                        .filter(([, emails]) => emails.size > 1)
                        .map(([nk]) => nk),
                );

                const userTeamByEmail = new Map<string, string>();
                const userTeamByName = new Map<string, string>();
                const userAvatarByEmail = new Map<string, string>();
                const userAvatarByName = new Map<string, string>();
                const userAvatarByNameCompact = new Map<string, string>();
                const userAvatarByNameLoose = new Map<string, string>();
                const userEmailByName = new Map<string, string>();
                const userEmailByNameCompact = new Map<string, string>();
                for (const u of allUsersForTeam) {
                    const nkRaw = normName(u.full_name || '');
                    const isAmbiguousName = !!nkRaw && ambiguousActiveNameKeys.has(nkRaw);
                    if (u.email && u.full_name && !isAmbiguousName) {
                        const nk = normName(u.full_name);
                        if (nk) userEmailByName.set(nk, u.email.toLowerCase().trim());
                        const ck = compactNameKey(u.full_name);
                        if (ck) userEmailByNameCompact.set(ck, u.email.toLowerCase().trim());
                    }
                    if (u.image_url && u.email) userAvatarByEmail.set(u.email.toLowerCase().trim(), u.image_url);
                    if (u.image_url && u.full_name && !isAmbiguousName) {
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
                    if (u.full_name && !isAmbiguousName) { const nk = normName(u.full_name); if (nk) userTeamByName.set(nk, t); }
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
                            id: (u as any).id || null,
                            employee_id: u.employee_id || null,
                            full_name: name,
                            email: email || null,
                            team: u.team || null,
                            image_url: (u as any).image_url || null,
                            employee_status: u.employee_status || 'ON',
                            status: String(u.employee_status || 'ON').toLowerCase(),
                            roles: userRoles,
                            role: resolvedRole,
                            employee_position: u.employee_position || null,
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
                // Trùng tên khác email (xem ambiguousActiveNameKeys ở trên): không cho map theo tên
                // (kể cả alias Lark bên dưới) trỏ về MỘT trong hai người một cách tuỳ tiện — danh tính
                // của họ chỉ được resolve qua email chính xác.
                const isAmbiguousEmpName = (e: any) => {
                    const nk = normName(e?.full_name || '');
                    return !!nk && ambiguousActiveNameKeys.has(nk);
                };
                employees.forEach(emp => {
                    if (emp.email) emailKeyMatchMap.set(emp.email.toLowerCase().trim(), emp);
                    if (emp.full_name && !isAmbiguousEmpName(emp)) {
                        nameKeyMatchMap.set(normName(emp.full_name), emp);
                        nameKeyMatchMap.set(compactNameKey(emp.full_name), emp);
                        // sorted-word key handles name-order variations (e.g. "Thị Duyên Lê" vs "Lê Thị Duyên")
                        const sk = normName(emp.full_name).split(' ').sort().join(' ');
                        if (!nameKeyMatchMap.has(sk)) nameKeyMatchMap.set(sk, emp);
                    }
                });

                // Second pass: Lark aliases and swapped names (only write if key doesn't conflict with any official user's full name)
                employees.forEach(emp => {
                    if (isAmbiguousEmpName(emp)) return;
                    const larkData = (emp as any).employee_data || [];
                    if (Array.isArray(larkData)) {
                        larkData.forEach((d: any) => {
                            if (d.name) {
                                const k1 = normName(d.name);
                                const k2 = compactNameKey(d.name);
                                if (!nameKeyMatchMap.has(k1)) nameKeyMatchMap.set(k1, emp);
                                if (!nameKeyMatchMap.has(k2)) nameKeyMatchMap.set(k2, emp);
                            }
                            if (d.en_name) {
                                const k1 = normName(d.en_name);
                                const k2 = compactNameKey(d.en_name);
                                if (!nameKeyMatchMap.has(k1)) nameKeyMatchMap.set(k1, emp);
                                if (!nameKeyMatchMap.has(k2)) nameKeyMatchMap.set(k2, emp);
                            }
                            // Some people swap First/Last names in Lark
                            const parts = String(d.name || '').split(' ');
                            if (parts.length === 2) {
                                const swapped = `${parts[1]} ${parts[0]}`;
                                const k1 = normName(swapped);
                                const k2 = compactNameKey(swapped);
                                if (!nameKeyMatchMap.has(k1)) nameKeyMatchMap.set(k1, emp);
                                if (!nameKeyMatchMap.has(k2)) nameKeyMatchMap.set(k2, emp);
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

                // Fetch in 2 sequential batches to cap peak concurrent connections (pool_size=8).
                // Running all 10 queries at once × N concurrent users exhausts PgBouncer pool.
                const [
                    reports,
                    standardKpis,
                    dodaKpisRaw,
                    allChannelsInDb,
                    dailyReportKpis,
                    monthlyReportKpis,
                ] = await Promise.all([
                    this.prisma.checklistReport.findMany({ where: { ...whereClause }, orderBy: { date: 'desc' } }),
                    this.prisma.kpi.findMany({
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
                        },
                        select: {
                            id: true,
                            employee_id: true,
                            name: true,
                            tag: true,
                            team: true,
                            image_url: true,
                            kpi_day: true,
                            kpi_month: true,
                            kpii_status: true,
                            kpi_day_percent: true,
                            completed_day: true,
                            completed_month: true,
                            task_new: true,
                            task_new_month: true,
                            task_auto: true,
                            task_auto_month: true,
                            task_creative: true,
                            content_win_new: true,
                            revenue_month: true,
                            traffic_month: true,
                            target_revenue_month: true,
                            target_traffic_month: true,
                            kpi_progress_month: true,
                            employee_status: true,
                            state: true,
                            employee_data: true,
                            report_date: true,
                            month: true,
                            link_image: true,
                        }
                    }),
                    this.prismaKpiDoDaEditor.findMany({
                        where: {
                            report_date: {
                                gte: monthsInRange[0] ? getVietnamMonthBounds(monthsInRange[0].year, monthsInRange[0].monthNum).start : larkKpiStartOfDay,
                                lte: monthsInRange.length > 0 ? getVietnamMonthBounds(monthsInRange[monthsInRange.length - 1].year, monthsInRange[monthsInRange.length - 1].monthNum).end : larkKpiEndOfDay,
                            },
                        },
                    }),
                    this.prisma.channel.findMany({
                        where: { status: { equals: 'Đang hoạt động', mode: 'insensitive' } },
                        select: { owner: true, team_traffic: true }
                    }),
                    (this.prisma as any).reportKpi.findMany({
                        where: {
                            report_date: { gte: memberReportStart, lte: memberReportEnd },
                        }
                    }),
                    (this.prisma as any).reportKpi.findMany({
                        where: {
                            report_date: {
                                gte: getVietnamMonthBounds(monthsInRange[0].year, monthsInRange[0].monthNum).start,
                                lte: getVietnamMonthBounds(monthsInRange[monthsInRange.length - 1].year, monthsInRange[monthsInRange.length - 1].monthNum).end
                            },
                        }
                    }),
                ]);

                const [
                    allTrafficInDb,
                    allRevenueInDb,
                    reportOutstandings,
                    totalKpiCount,
                    reportsUnfilteredCount,
                    globalIndoKpisRaw,
                ] = await Promise.all([
                    // trafficReport: record đã lưu thẳng `date` = ngày nghiệp vụ D (submitTrafficReport tự
                    // trừ lùi 1 ngày so với ngày nộp) → đọc đúng cửa sổ D (larkKpiStartOfDay/EndOfDay).
                    this.prisma.trafficReport.findMany({ where: { date: { gte: larkKpiStartOfDay, lte: larkKpiEndOfDay } } }),
                    // revenueReport: cùng cơ chế lưu/đọc như trafficReport (submitRevenueReport cũng trừ
                    // lùi 1 ngày). Đây là nguồn doanh thu MỚI (nhập tay theo nền tảng) — thay cho
                    // reportKpi.revenue_day/câu hỏi checklist cũ (2 nguồn đó không liên quan tính năng này).
                    this.prisma.revenueReport.findMany({ where: { date: { gte: larkKpiStartOfDay, lte: larkKpiEndOfDay } } }),
                    this.prisma.$queryRawUnsafe(`
                        SELECT * FROM "report_outstanding"
                        WHERE "content" NOT ILIKE '%không có%' AND "content" NOT ILIKE '%khong co%'
                          AND "content" IS NOT NULL AND "content" != '' AND "content" != '-'
                        ORDER BY "date" DESC, "created_at" DESC LIMIT 200
                    `),
                    this.prisma.kpi.count({ where: { OR: [{ state: { not: 'off' } }, { state: null }], report_date: { gte: new Date('2026-03-01T00:00:00Z') } } }),
                    this.prisma.checklistReport.count({ where: whereClause }),
                    this.prismaKpiGlobalIndo.findMany({
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
                        },
                    }).catch((err: any) => {
                        this.logger.warn(`[Global Indo] lark_kpi_global_indo query failed, fallback []: ${err?.message || err}`);
                        return [];
                    }) as Promise<any[]>,
                ]);

                // ─── MT Tháng / MT Ngày / Đã Xong — nguồn task-auto (EditorKpi + Task), thay cho lark_kpi ───
                // MT Tháng lấy từ EditorKpi.total_target (số video mục tiêu trong tháng) của đúng tháng đang xem.
                // MT Ngày = tổng số task (task-auto) có deadline rơi vào ngày/khoảng đang lọc;
                // task chưa có deadline thì tính theo ngày tạo (created_at) thay thế.
                // Đã Xong = trong số đó, bao nhiêu task đã được duyệt (status = APPROVED).
                const nowVnForGoal = getVietnamParts();
                const goalMonthInfo = monthsInRange[0] || { monthNum: nowVnForGoal.m, year: nowVnForGoal.y };
                const goalMonthStr = `${goalMonthInfo.year}-${String(goalMonthInfo.monthNum).padStart(2, '0')}`;
                const goalMonthBounds = getVietnamMonthBounds(goalMonthInfo.year, goalMonthInfo.monthNum);

                const [editorKpiRows, teamMemberships, taskDayCounts, taskMonthApprovedCounts] = await Promise.all([
                    this.prisma.editorKpi.findMany({
                        where: { month: goalMonthStr },
                        select: { user_id: true, team_id: true, total_target: true },
                    }),
                    this.prisma.teamMember.findMany({
                        select: { user_id: true, team: { select: { id: true, name: true } } },
                    }),
                    this.prisma.task.groupBy({
                        by: ['assignee_id', 'status'],
                        where: {
                            assignee_id: { not: null },
                            status: { not: 'CANCELLED' },
                            OR: [
                                { deadline: { gte: larkKpiStartOfDay, lte: larkKpiEndOfDay } },
                                { deadline: null, created_at: { gte: larkKpiStartOfDay, lte: larkKpiEndOfDay } },
                            ],
                        },
                        _count: { id: true },
                    }),
                    this.prisma.task.groupBy({
                        by: ['assignee_id'],
                        where: {
                            assignee_id: { not: null },
                            status: 'APPROVED',
                            deadline: { gte: goalMonthBounds.start, lte: goalMonthBounds.end },
                        },
                        _count: { id: true },
                    }),
                ]);

                /** `${user_id}_${team_id}` → total_target (EditorKpi) cho đúng tháng đang xem */
                const editorKpiTeamMap = new Map<string, number>();
                for (const ek of editorKpiRows) {
                    if (!ek.team_id) continue;
                    editorKpiTeamMap.set(`${ek.user_id}_${ek.team_id}`, ek.total_target || 0);
                }

                /** user_id → danh sách team (task-auto) đang là thành viên, dùng khi không lọc theo 1 team cụ thể */
                const teamsByUserId = new Map<string, { id: string; name: string }[]>();
                for (const tm of teamMemberships) {
                    if (!tm.team) continue;
                    const list = teamsByUserId.get(tm.user_id) || [];
                    list.push({ id: tm.team.id, name: tm.team.name });
                    teamsByUserId.set(tm.user_id, list);
                }

                const taskGoalByUser = new Map<string, number>();
                const taskDoneByUser = new Map<string, number>();
                for (const row of taskDayCounts as any[]) {
                    if (!row.assignee_id) continue;
                    taskGoalByUser.set(row.assignee_id, (taskGoalByUser.get(row.assignee_id) || 0) + row._count.id);
                    if (row.status === 'APPROVED') {
                        taskDoneByUser.set(row.assignee_id, (taskDoneByUser.get(row.assignee_id) || 0) + row._count.id);
                    }
                }

                const taskApprovedMonthByUser = new Map<string, number>();
                for (const row of taskMonthApprovedCounts as any[]) {
                    if (!row.assignee_id) continue;
                    taskApprovedMonthByUser.set(row.assignee_id, row._count.id);
                }

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

                const allKpiInDb: any[] = [...standardKpis, ...dodaKpis, ...(globalIndoKpisRaw ?? [])];
                const permissions: any[] = [];

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
                const activeEmployees = employees.filter((emp: any) =>
                    isActiveEmployeeStatus(emp.employee_status || emp.status),
                );
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
                        id: emp.id || null,
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
                        // 2 người active status cùng tên khác email: không cho map theo tên trỏ tuỳ
                        // tiện vào 1 trong 2 (first-write-wins không có nghĩa gì khi cả 2 đều hợp lệ) —
                        // bắt buộc phải resolve qua email cho tên này.
                        if (!employeeMap.has(nameKey) && (duplicateNameCounts.get(nameKey) || 0) <= 1) {
                            employeeMap.set(nameKey, row);
                        }
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
                        const platforms = ['fb', 'ig', 'tiktok', 'yt', 'thread', 'zalo'];
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

                // Help track who reported revenue today — mirror trafficMapByEmail/trafficMapByName,
                // hoàn toàn tách biệt khỏi traffic (không gộp 2 nguồn số liệu).
                const revenueMapByEmail = new Map();
                const revenueMapByName = new Map();
                allRevenueInDb.forEach(rv => {
                    const nameKey = rv.name ? rv.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/\s+/g, ' ') : null;
                    if (!nameKey) return;

                    const perm = employeeMap.get(nameKey);
                    const inferredEmail = (rv.email ? String(rv.email).toLowerCase().trim() : null) || (perm?.email ? String(perm.email).toLowerCase().trim() : null);

                    const mergeRevenue = (existing: any, current: any) => {
                        const res = { ...existing };
                        res.total_revenue = (res.total_revenue || BigInt(0)) + (current.total_revenue || BigInt(0));
                        return res;
                    };

                    const mergedName = revenueMapByName.has(nameKey) ? mergeRevenue(revenueMapByName.get(nameKey), rv) : mergeRevenue({ total_revenue: BigInt(0) }, rv);
                    revenueMapByName.set(nameKey, mergedName);

                    if (inferredEmail) {
                        const mergedMail = revenueMapByEmail.has(inferredEmail) ? mergeRevenue(revenueMapByEmail.get(inferredEmail), rv) : mergeRevenue({ total_revenue: BigInt(0) }, rv);
                        revenueMapByEmail.set(inferredEmail, mergedMail);
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
                // report_kpi: bảng lịch sử đóng băng (Lark sync cũ), lệch D+1 so với ngày hiệu suất trên UI.
                // Checklist ở dashboard cũng dùng cửa sổ D+1 (nộp sáng hôm sau về ngày hôm trước); traffic đọc đúng ngày D.
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

                // --- 1. Checklist roster: seed from users.team (chỉ nhân viên ON / đang hoạt động) ---
                const kpisForAggregation = new Map<string, any>();
                if (selectedSingleDay) {
                    const monthInfo = monthsInRange[0];
                    activeEmployees.forEach((emp) => {
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
                            employee_status: emp.employee_status || 'ON',
                            kpi_day: 0,
                            kpi_month: 0,
                            completed_day: 0,
                            completed_month: 0,
                            traffic_month: 0,
                            revenue_month: 0,
                            isAuthorizedForReport: true,
                        });
                    });

                    // --- 2. Hiệu suất: bổ sung từ lark_kpi.team (chỉ khi user còn ON trong bảng users) ---
                    for (const kpi of targetDayKpis) {
                        const kTeam = String(kpi.team || '').trim();
                        if (!kTeam) continue;
                        if (!matchesTeamFilter([kTeam], teamFilterNormalized)) continue;

                        const kName = kpi.name ? normName(kpi.name) : null;
                        const kEmail = (this.extractEmailFromKpi(kpi) || (kpi as any).email || '').toLowerCase().trim();
                        const authUser =
                            (kEmail ? emailKeyMatchMap.get(kEmail) : null) ||
                            (kName ? nameKeyMatchMap.get(kName) : null) ||
                            (kName ? nameKeyMatchMap.get(kName.split(' ').sort().join(' ')) : null);
                        if (!authUser || !isActiveEmployeeStatus(authUser.employee_status || authUser.status)) {
                            continue;
                        }

                        const pKey = authUser.email?.toLowerCase().trim() || normName(authUser.full_name);
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
                        if (byName) return normName(byName.full_name);
                        // sorted-word fallback for name-order variations (e.g. "Thị Duyên Lê" vs "Lê Thị Duyên")
                        const sk = nameKey.split(' ').sort().join(' ');
                        const bySorted = nameKeyMatchMap.get(sk);
                        if (bySorted?.email) return String(bySorted.email).toLowerCase().trim();
                        if (bySorted) return normName(bySorted.full_name);
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
                        // Một người có thể có nhiều dòng KPI cùng ngày (vd. dòng rỗng ở lark_kpi
                        // team "Global - Indo" kpi=0/completed=0 TRÙNG với dòng thật ở lark_kpi_global_indo).
                        // Ưu tiên dòng CÓ dữ liệu (kpi_day + completed_day lớn hơn), rồi mới tới report_date,
                        // để dòng rỗng report_date trễ hơn không ghi đè dòng thật.
                        const kpiScore = (r: any) => (Number(r?.kpi_day) || 0) + (Number(r?.completed_day) || 0);
                        const better = !prev
                            || kpiScore(kpi) > kpiScore(prev)
                            || (kpiScore(kpi) === kpiScore(prev)
                                && new Date(kpi.report_date || 0).getTime() >= new Date(prev.report_date || 0).getTime());
                        if (better) targetByPerson.set(pk, kpi);
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
                        // Không để dòng target rỗng (kpi=0 & completed=0) xóa completed_day thật đã gộp được.
                        const tdCompleted = Number(td.completed_day) || 0;
                        const tdHasData = (Number(td.kpi_day) || 0) > 0 || tdCompleted > 0;
                        agg.completed_day = tdHasData ? tdCompleted : (Number(agg.completed_day) || 0);
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
                                     (nameKey ? nameKeyMatchMap.get(nameKey) : null) ||
                                     (nameKey ? nameKeyMatchMap.get(nameKey.split(' ').sort().join(' ')) : null);

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
                    if (!authoritativeUser) {
                        authoritativeUser = this.resolveKnownIdentityAlias(nameKeyMatchMap, emailKeyMatchMap, nameKey, emailKey);
                    }

                    // Không có authoritativeUser = đã bị xóa cứng khỏi users (hoặc không khớp alias nào)
                    // → không hồi sinh vào roster từ báo cáo cũ; OFF cũng loại như trước.
                    if (!authoritativeUser || !isActiveEmployeeStatus(authoritativeUser.employee_status || authoritativeUser.status)) {
                        return;
                    }

                    const pKey = authoritativeUser.email?.toLowerCase().trim() || normName(authoritativeUser.full_name);
                    if (!pKey) return;

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

                    // r.date là ngày NỘP (D+1); ngày báo cáo VỀ là D = date - 1 ngày → key tháng phải theo D
                    // để khớp với roster/kpi của ngày đang xem (quan trọng khi nộp vào mùng 1 đầu tháng).
                    const vn = getVietnamParts(
                        r.date ? new Date(new Date(r.date).getTime() - 24 * 60 * 60 * 1000) : new Date(),
                    );

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
                    if (!authUser) {
                        authUser = this.resolveKnownIdentityAlias(nameKeyMatchMap, emailKeyMatchMap, rName, rEmail);
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
                    // Member nhiều team (vd "AFF 02,Global - Indo"): khi đang lọc 1 team cụ thể và
                    // người này thuộc team đó, card phải mang team đang lọc — nếu lấy mù quáng
                    // checklistTeams[0] thì FE (matchTeam trên r.team) sẽ ẩn họ khỏi tab hiệu suất
                    // của team thứ hai dù BE đã trả về.
                    const filterMatchedChecklistTeam = teamFilterNormalized
                        ? checklistTeams.find((t) => matchesTeamFilter([t], teamFilterNormalized)) || null
                        : null;
                    const effectiveTeam = performanceTeam || filterMatchedChecklistTeam || checklistTeams[0] || 'Khác';
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
                    // Lookup daily revenue for this person (bảng revenue_reports mới — tách biệt traffic)
                    const personRevenue = (normalizedEmail ? revenueMapByEmail.get(normalizedEmail) : null) || revenueMapByName.get(nameKey) || null;

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

                    // MT Tháng / MT Ngày / Đã Xong — nguồn task-auto (EditorKpi.total_target + Task),
                    // thay cho lark_kpi.kpi_day/kpi_month/completed_day/completed_month.
                    const resolvedUserId: string | null = employee?.id || personEmp?.id || null;
                    let taskAutoTeamId: string | null = null;
                    if (resolvedUserId) {
                        const myTeams = teamsByUserId.get(resolvedUserId) || [];
                        // Có filter team cụ thể trên UI → dùng đúng team đó; không thì dùng team
                        // đang hiển thị trên thẻ của chính người này (effectiveTeam).
                        const wantedTeamNorm = teamFilterNormalized || normalizeTeamKey(effectiveTeam);
                        const matchedTeam = myTeams.find(t => normalizeTeamKey(t.name) === wantedTeamNorm) || myTeams[0] || null;
                        taskAutoTeamId = matchedTeam?.id || null;
                    }
                    const monthlyVideoTarget = (resolvedUserId && taskAutoTeamId)
                        ? (editorKpiTeamMap.get(`${resolvedUserId}_${taskAutoTeamId}`) || 0)
                        : 0;
                    const dailyTaskGoal = resolvedUserId ? (taskGoalByUser.get(resolvedUserId) || 0) : 0;
                    const dailyTaskDone = resolvedUserId ? (taskDoneByUser.get(resolvedUserId) || 0) : 0;
                    const monthlyTaskDone = resolvedUserId ? (taskApprovedMonthByUser.get(resolvedUserId) || 0) : 0;

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
                        // MT Ngày/Đã Xong: đếm task-auto (Task.deadline trong ngày/khoảng đang lọc, status APPROVED = đã xong).
                        // MT Tháng: EditorKpi.total_target (số video mục tiêu) của đúng team + tháng đang xem.
                        dailyGoal: dailyTaskGoal,
                        done: dailyTaskDone,
                        kpi_day: dailyTaskGoal,
                        kpi_month: monthlyVideoTarget,
                        completed_day: dailyTaskDone,
                        completed_month: monthlyTaskDone,
                        // Stable monthly traffic/revenue for the Summary Cards:
                        traffic_range: (monthlyReportKpi ? Number(monthlyReportKpi.traffic_month || 0) : Number(kpi.traffic_month || 0)) + incrementalTraffic,
                        revenue_range: (monthlyReportKpi ? Number(monthlyReportKpi.revenue_month || 0) : Number(kpi.revenue_month || 0)) + incrementalRevenue,
                        // Nguồn MỚI: bảng revenue_reports (nhập tay theo nền tảng, giống trafficToday.total ở
                        // dưới) — không còn dùng reportKpi.revenue_day/câu hỏi checklist (2 nguồn cũ, khác tính năng).
                        revenueToday: personRevenue ? Number(personRevenue.total_revenue || 0) : 0,
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
                        monthlyProgress: monthlyVideoTarget > 0 ? Math.round((monthlyTaskDone / monthlyVideoTarget) * 100) : 0,
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
                            zalo: Number(personTraffic.traffic_zalo || 0),
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

                    // Người nộp phải còn là user active — user đã xóa (mềm/cứng) không được
                    // hồi sinh từ báo cáo cũ (bộ lọc OFF phía dưới không thấy họ nên sẽ cho qua).
                    let reporterUser = (rEmailKey ? emailKeyMatchMap.get(rEmailKey) : null) || (rNameKey ? nameKeyMatchMap.get(rNameKey) : null);
                    if (!reporterUser) {
                        reporterUser = this.resolveKnownIdentityAlias(nameKeyMatchMap, emailKeyMatchMap, rNameKey || null, rEmailKey || null);
                    }
                    if (!reporterUser || !isActiveEmployeeStatus(reporterUser.employee_status || reporterUser.status)) return;

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
                        // Cùng lý do với effectiveTeam ở nhánh KPI: member nhiều team phải mang team
                        // đang lọc (nếu thuộc), không phải team đầu tiên trong chuỗi.
                        const filterMatchedTeamRep = teamFilterNormalized
                            ? userTeamsRep.find((t) => matchesTeamFilter([t], teamFilterNormalized)) || null
                            : null;
                        let displayTeamRep: string;
                        if (performanceTeam) {
                            displayTeamRep = performanceTeam;
                        } else if (filterMatchedTeamRep) {
                            displayTeamRep = filterMatchedTeamRep;
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
                        const personRevenue =
                            (rEmailKey ? revenueMapByEmail.get(rEmailKey) : null) ||
                            (rNameKey ? revenueMapByName.get(rNameKey) : null) ||
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
                            revenueToday: personRevenue ? Number(personRevenue.total_revenue || 0) : 0,
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
                                    zalo: Number(personTraffic.traffic_zalo || 0),
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
                        // revenueToday KHÔNG cộng dồn ở đây — giống hệt trafficToday (không bị đụng trong
                        // merge này), vì cả 2 đều đã là tổng theo người từ personTraffic/personRevenue rồi.

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

                const teamBuckets = allValidResults.reduce((acc: any, r: any) => {
                    const team = String(r?.team || 'Khác');
                    acc[team] = (acc[team] || 0) + 1;
                    return acc;
                }, {});
                const zeroDailyCount = allValidResults.filter((r: any) => Number(r?.kpi_day || 0) === 0 && Number(r?.completed_day || 0) === 0).length;

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

                const globalTeamNames = ['Global - JP1', 'Global - JP2', 'Global JP3', 'Global JP4', 'Global - Indo', 'Global Thái Lan', 'Global- Thái Lan 1', 'Global- Thái Lan 2', 'Global Đài Loan'];
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
        })); // end sharedData cacheService.get

        // Merge per-user role/team vào shared data trước khi trả về client
        return {
            ...sharedData,
            userRole: requesterRole,
            userTeam: requesterTeam,
        };
    }

    async getUserReportDetails(email: string, dateStr: string) {
        // `dateStr` = ngày báo cáo (reportDate) user chọn trên form (VN). Nộp sáng ngày reportDate là
        // báo cáo VỀ ngày reportDate-1 → submitChecklistReport/submitTrafficReport lưu `date` = hôm qua.
        // Đọc lại phải dùng CÙNG ngày đã lưu (reportDate-1), không dùng reportDate thô, nếu không sẽ
        // không thấy record vừa gửi (form hiển thị "chưa báo cáo" ngay sau khi vừa nộp).
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
        const targetYmd = this.previousVietnamDateKey(uiYmd);
        const [y, mo, da] = targetYmd.split('-').map((x) => parseInt(x, 10));
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

        const [reportCandidates, trafficCandidates, revenueCandidates] = await Promise.all([
            this.prisma.checklistReport.findMany({
                where: {
                    date: { gte: startOfDay, lte: endOfDay }
                },
                orderBy: { created_at: 'desc' }
            }),
            this.prisma.trafficReport.findMany({
                where: {
                    date: { gte: startOfDay, lte: endOfDay }
                },
                orderBy: { created_at: 'asc' }
            }),
            this.prisma.revenueReport.findMany({
                where: {
                    date: { gte: startOfDay, lte: endOfDay }
                },
                orderBy: { created_at: 'asc' }
            }),
        ]);

        // QUAN TRỌNG: nếu dòng báo cáo CÓ email thì phải khớp đúng email đó — không được rơi
        // xuống so tên. Trước đây rơi xuống so tên ngay cả khi rowEmail khác normalizedEmail,
        // nên 2 người trùng tên khác email (có thật trong DB, vd 2 tài khoản "Nguyễn Công Toàn")
        // bị lẫn báo cáo của nhau: người chưa nộp mở form vẫn thấy bị khóa + có sẵn câu trả lời
        // của người trùng tên đã nộp. Chỉ so tên khi dòng đó KHÔNG có email ghi nhận.
        const isMatchedPerson = (rowEmail?: string | null, rowName?: string | null): boolean => {
            const rowEmailNorm = (rowEmail || '').trim().toLowerCase();
            if (rowEmailNorm) return rowEmailNorm === normalizedEmail;
            if (!fullNameNorm) return false;
            const rowNameNorm = normalizeName(rowName);
            return !!rowNameNorm && rowNameNorm === fullNameNorm;
        };

        const report = reportCandidates.find((r: any) => isMatchedPerson(r.email, r.name)) || null;
        const trafficRecords = trafficCandidates.filter((t: any) => isMatchedPerson(t.email, t.name));
        const revenueRecords = revenueCandidates.filter((t: any) => isMatchedPerson(t.email, t.name));

        let traffic: any = null;
        let details: any[] = [];
        const platforms = ['fb', 'ig', 'tiktok', 'yt', 'thread', 'zalo'];

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
            const platforms = ['fb', 'ig', 'tiktok', 'yt', 'thread', 'zalo'];
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

        // Build combined `revenue` object — mirror traffic aggregation minus evidence.
        let revenue: any = null;
        let revenueDetails: any[] = [];
        if (revenueRecords.length > 0) {
            revenue = { ...revenueRecords[0] };
            revenue.total_revenue = Number(revenue.total_revenue || 0);
            platforms.forEach(p => {
                const rk = `revenue_${p}`;
                revenue[rk] = Number(revenue[rk] || 0);
            });

            const buildRevenueDetails = (rec: any) => {
                platforms.forEach(p => {
                    const rk = `revenue_${p}`;
                    const ck = `channel_${p}`;
                    const val = Number(rec[rk] || 0);
                    if (val > 0) {
                        revenueDetails.push({ platform: p, channel: rec[ck] || '', value: val });
                    }
                });
            };

            buildRevenueDetails(revenueRecords[0]);

            if (revenueRecords.length > 1) {
                for (let i = 1; i < revenueRecords.length; i++) {
                    const rec = revenueRecords[i];
                    revenue.total_revenue += Number(rec.total_revenue || 0);
                    platforms.forEach(p => {
                        const rk = `revenue_${p}`;
                        const ck = `channel_${p}`;
                        revenue[rk] = (revenue[rk] || 0) + Number(rec[rk] || 0);
                        if (rec[ck]) revenue[ck] = revenue[ck] ? `${revenue[ck]}, ${rec[ck]}` : rec[ck];
                    });
                    buildRevenueDetails(rec);
                }
            }
            revenue.details = revenueDetails;
        }

        // Identify which teams have already been reported in traffic/revenue records
        const reportedTeams = Array.from(new Set(trafficRecords.map(t => t.team).filter(Boolean)));
        const reportedRevenueTeams = Array.from(new Set(revenueRecords.map(t => t.team).filter(Boolean)));

        return { report, traffic, trafficRecords, reportedTeams, revenue, revenueRecords, reportedRevenueTeams };

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
                    const firstKpi = await this.prisma.kpi.findFirst({
                        where: { team: { not: null } }
                    });
                    if (firstKpi) userTeam = firstKpi.team;
                }

                // Nếu leader/member vẫn chưa có team, tìm thêm từ báo cáo / KPI theo email
                if (!userTeam && (requesterRole === 'leader' || requesterRole === 'member')) {
                    const lastReport = await this.prisma.checklistReport.findFirst({
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
                const kpis = await this.prisma.kpi.findMany({
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

                // Nộp báo cáo sáng hôm nay là báo cáo VỀ hôm qua → checklistReport.date lưu ngày hôm qua.
                // "Đã báo cáo hôm nay chưa" phải đọc cửa sổ hôm qua (ngày nghiệp vụ), không phải hôm nay.
                const targetVNKey = this.previousVietnamDateKey(new Date());
                const [todayY, todayM, todayD] = targetVNKey.split('-').map(Number);
                const startOfToday = new Date(Date.UTC(todayY, todayM - 1, todayD - 1, 17, 0, 0, 0));
                const endOfToday = new Date(Date.UTC(todayY, todayM - 1, todayD, 16, 59, 59, 999));

                let targetMonthNum = new Date().getMonth() + 1;

                const getKpisForMonth = async (mNum: number) => {
                    const formats = [`T${mNum}`, `Tháng ${mNum}`, `tháng ${mNum}`, `${mNum}`, mNum < 10 ? `0${mNum}` : `${mNum}`];
                    return await this.prisma.kpi.findMany({
                        where: {
                            month: { in: formats },
                            OR: [{ state: { not: 'off' } }, { state: null }]
                        }
                    });
                };

                let allTeamKpis = await getKpisForMonth(targetMonthNum);

                // Fallback: If no KPIs for current month, find most recent month with data
                if (allTeamKpis.length === 0) {
                    const latestKpi = await this.prisma.kpi.findFirst({
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
                    this.prisma.checklistReport.findFirst({
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

                    const allKpis = await this.prisma.kpi.findMany({
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
                        this.prisma.checklistReport.findMany({
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

            this.invalidateActivityCache();

            return { success: true, message: 'Status updated successfully (Local only)' };
        } catch (error) {
            this.logger.error(`Failed to update outstanding status for id ${id}`, error);
            throw error;
        }
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

    async getListTaskData() {
        return this.prisma.reportedTask.findMany({
            orderBy: { date: 'desc' },
            take: 500,
        });
    }

    async getDashboardAnalytics(filters?: { startDate?: string; endDate?: string; team?: string }) {
        const cacheKey = `dashboard-analytics:${filters?.startDate || ''}:${filters?.endDate || ''}:${filters?.team || 'All'}`;
        return this.cacheService.get(cacheKey, 3 * 60 * 1000, () => this.dashboardReadSemaphore.run(() => this._buildDashboardAnalytics(filters)));
    }

    /**
     * Dashboard "5A" (Admin xem toàn công ty / Leader xem team mình) — gộp KPI thật từ Lark
     * (getDashboardAnalytics) với roster thật từ bảng Team/TeamMember (task-auto), và danh sách
     * kênh thật từ Channel. `team` filter đã được controller khoá cứng theo quyền trước khi gọi vào đây.
     *
     * KHÔNG trả breakdown theo A1-A5 (phễu 5A): hệ thống hiện chưa phân loại video theo tier này ở
     * bất kỳ bảng nào (ContentLine chỉ có 5 dòng tên A1..A5 nhưng gần như không có task nào gắn vào
     * — đã verify trực tiếp trên DB thật). FE phải tự hiển thị "chưa có dữ liệu" cho phần này thay vì
     * suy diễn/áng chừng số liệu.
     */
    async getDashboard5A(filters: { startDate?: string; endDate?: string; team?: string }) {
        const teamFilter = filters.team && filters.team !== 'All' ? filters.team : undefined;

        const [analytics, teams, channels, kpiFreshness] = await Promise.all([
            this.getDashboardAnalytics({ startDate: filters.startDate, endDate: filters.endDate, team: teamFilter }),
            this.prisma.team.findMany({
                where: teamFilter
                    ? { name: { equals: teamFilter, mode: 'insensitive' } }
                    : { is_active: true },
                select: {
                    id: true,
                    name: true,
                    market: true,
                    leader: { select: { id: true, full_name: true } },
                    members: { select: { user_id: true } },
                },
                orderBy: { name: 'asc' },
            }),
            this.prisma.channel.findMany({
                where: teamFilter
                    ? { channel_team: { name: { equals: teamFilter, mode: 'insensitive' } } }
                    : undefined,
                select: {
                    id: true,
                    name: true,
                    platform: true,
                    status: true,
                    channel_team: { select: { name: true } },
                },
                orderBy: [{ platform: 'asc' }, { name: 'asc' }],
            }),
            // Mốc đồng bộ Lark thật gần nhất — KHÔNG lọc theo startDate/endDate (đây là watermark
            // toàn cục, không phải số liệu trong kỳ). Dùng để cảnh báo FE khi job sync KPI đã dừng/trễ
            // (đã từng xảy ra: container video_production_app tắt 2026-07-11 khiến KPI ngừng tự sync).
            this.prisma.kpi.aggregate({
                _max: { report_date: true },
                where: teamFilter ? { team: { equals: teamFilter, mode: 'insensitive' } } : undefined,
            }),
        ]);

        // Team KPI (Lark) đang key theo tên team dạng free-text — khớp với teams.name theo tên (đã
        // verify trên DB thật: "Team K1", "Global - JP1"... trùng nhau giữa 2 bảng).
        const kpiTeamsByName = new Map<string, { stats: { videos: number; traffic: number; revenue: number; kpiTarget: number } }>();
        for (const t of [...analytics.regionalStats.vn.teams, ...analytics.regionalStats.global.teams]) {
            kpiTeamsByName.set((t.name || '').toLowerCase().trim(), t as any);
        }

        const teamRows = teams.map((t) => {
            const kpiTeam = kpiTeamsByName.get(t.name.toLowerCase().trim());
            const videos = kpiTeam?.stats.videos ?? 0;
            const target = kpiTeam?.stats.kpiTarget ?? 0;
            return {
                id: t.id,
                name: t.name,
                market: t.market,
                leaderName: t.leader?.full_name ?? null,
                staffCount: t.members.length,
                videoCount: videos,
                traffic: Math.round(kpiTeam?.stats.traffic ?? 0),
                revenue: Math.round(kpiTeam?.stats.revenue ?? 0),
                kpiTarget: target,
                progressPct: target > 0 ? Math.round((videos / target) * 100) : null,
            };
        });

        return {
            kpi: {
                totalVideos: analytics.summary.totalVideos,
                prevVideos: analytics.summary.prevVideos,
                totalTraffic: analytics.summary.totalTraffic,
                totalRevenue: analytics.summary.totalRevenue,
                totalKpiTarget: analytics.summary.totalKpiTarget,
                progressPct: analytics.summary.progressPct,
                /** Ngày report_date mới nhất có trong lark_kpi (không lọc theo startDate/endDate) —
                 * null nếu chưa từng có dòng nào khớp team filter. FE dùng để cảnh báo dữ liệu cũ. */
                lastSyncedAt: kpiFreshness._max.report_date,
            },
            teams: teamRows,
            channels: channels.map((c) => ({
                id: c.id,
                name: c.name,
                platform: c.platform,
                team: c.channel_team?.name ?? null,
                status: c.status,
            })),
            a5: {
                available: false,
                note: 'Hệ thống chưa phân loại video theo mô hình 5A (A1-A5) — chưa có dữ liệu thật để hiển thị.',
            },
        };
    }

    /**
     * Bản gộp nhiều team cho leader đang lead CÙNG LÚC >1 team (có thật trên DB — vd 1 leader lead cả
     * "Scale Data" + "Team K1" + "MEDIA"). `getDashboardAnalytics()` gốc chỉ nhận 1 team filter dạng
     * string nên KHÔNG sửa trực tiếp hàm đó (rủi ro động vào logic ngày-giờ đã được tune kỹ) — thay vào
     * đó gọi getDashboard5A() riêng cho từng team rồi gộp kết quả ở đây.
     */
    async getDashboard5AForTeams(filters: { startDate?: string; endDate?: string }, teamNames: string[]) {
        if (teamNames.length === 0) {
            // KHÔNG được gọi getDashboard5A({team: undefined}) ở đây — undefined nghĩa là "không lọc,
            // xem hết công ty" (đúng cho admin), nếu lỡ gọi với danh sách team rỗng sẽ vô tình trả về
            // dữ liệu TOÀN CÔNG TY thay vì rỗng — lộ dữ liệu cho người không thuộc team nào.
            return {
                kpi: null,
                teams: [],
                channels: [],
                a5: { available: false as const, note: 'Không có team nào để hiển thị.' },
            };
        }
        if (teamNames.length === 1) {
            return this.getDashboard5A({ ...filters, team: teamNames[0] });
        }

        const results = await Promise.all(
            teamNames.map((name) => this.getDashboard5A({ ...filters, team: name })),
        );

        const totalKpiTarget = results.reduce((s, r) => s + (r.kpi?.totalKpiTarget ?? 0), 0);
        const totalVideos = results.reduce((s, r) => s + (r.kpi?.totalVideos ?? 0), 0);
        const lastSyncedAt = results
            .map((r) => r.kpi?.lastSyncedAt ?? null)
            .filter((d): d is Date => d != null)
            .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

        return {
            kpi: {
                totalVideos,
                prevVideos: results.reduce((s, r) => s + (r.kpi?.prevVideos ?? 0), 0),
                totalTraffic: results.reduce((s, r) => s + (r.kpi?.totalTraffic ?? 0), 0),
                totalRevenue: results.reduce((s, r) => s + (r.kpi?.totalRevenue ?? 0), 0),
                totalKpiTarget,
                progressPct: totalKpiTarget > 0 ? Math.round((totalVideos / totalKpiTarget) * 100) : null,
                lastSyncedAt,
            },
            teams: results.flatMap((r) => r.teams),
            channels: results.flatMap((r) => r.channels),
            a5: results[0].a5,
        };
    }

    private async _buildDashboardAnalytics(filters?: { startDate?: string; endDate?: string; team?: string }) {
        // `kpi.report_date` (và các cột `date`/`report_date` VN-normalized khác trong file này) lưu ở
        // 05:00 UTC (= 12:00 VN), KHÔNG phải UTC midnight. Trước đây `start`/`end` dùng `new Date('YYYY-MM-DD')`
        // (UTC midnight) — khi startDate===endDate (chọn 1 ngày), start===end nên khoảng lọc co về đúng 1
        // instant UTC midnight, loại bỏ mọi bản ghi report_date=05:00 UTC của chính ngày đó (đã verify thực tế:
        // 124 dòng kpi có month=null dựa hoàn toàn vào fallback report_date này). Dùng ranh giới ngày VN chuẩn
        // (mốc 17:00 UTC) như phần còn lại của file thay vì UTC midnight.
        const vnDayBounds = (dateStr: string) => {
            const key = dateStr.length === 10 ? dateStr : this.toVietnamDateKey(new Date(dateStr));
            const [y, m, d] = key.split('-').map(Number);
            return {
                start: new Date(Date.UTC(y, m - 1, d - 1, 17, 0, 0, 0)),
                end: new Date(Date.UTC(y, m - 1, d, 16, 59, 59, 999)),
            };
        };
        const start = filters?.startDate
            ? vnDayBounds(filters.startDate).start
            : vnDayBounds(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`).start;
        const end = filters?.endDate ? vnDayBounds(filters.endDate).end : new Date();
        // Trước đây "chọn đúng 1 ngày" được suy ra từ `start.getTime() === end.getTime()` — điều này chỉ
        // đúng một cách tình cờ khi start/end bị tính bằng UTC midnight thô (bug đã sửa ở trên). Với
        // start/end chuẩn theo ranh giới ngày VN (cách nhau ~1 ngày kể cả khi chọn 1 ngày), phải tính cờ
        // này tường minh từ chuỗi ngày UI gửi lên, không suy ra từ start/end nữa.
        const isSingleDaySelected = !!(filters?.startDate && filters?.endDate && filters.startDate === filters.endDate);
        const singleDayKey = isSingleDaySelected ? filters!.startDate! : null;
        const teamFilter = filters?.team === 'All' || !filters?.team ? null : filters?.team.toLowerCase().trim();

        const monthsInRange: { monthNum: number; year: number; formats: string[] }[] = [];
        {
            // KHÔNG dùng start.getFullYear()/getMonth() (local-time getters): `start` là mốc UTC
            // 17:00 của ngày hôm trước ngày VN đầu tiên trong khoảng chọn (vd startDate="2026-08-01"
            // → start = 2026-07-31T17:00:00Z). Nếu server chạy UTC (mặc định của container, không set
            // TZ), .getMonth() đọc ra tháng 7 thay vì tháng 8 → monthsInRange lùi nhầm 1 tháng, kéo
            // theo dữ liệu KPI tháng trước vào tổng "tháng này" mỗi khi mở dashboard mặc định (không
            // filter) hoặc chọn startDate=mùng 1. Dùng this.toVietnamDateKey() để lấy đúng năm/tháng VN.
            const [startY, startM] = this.toVietnamDateKey(start).split('-').map(Number);
            const [endY, endM] = this.toVietnamDateKey(end).split('-').map(Number);
            let curr = new Date(startY, startM - 1, 1);
            const endLimit = new Date(endY, endM - 1, 1);
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
        const [tasks, allKpisInDb, usersWithChannels, allChannels, trafficReportsInRange, checklistReportsForRevenue] = await Promise.all([
            this.prisma.reportedTask.findMany({
                where: {
                    date: { gte: start, lte: end },
                    status: { in: ['Done', 'Đã hoàn thành', 'Hoàn thành'] }
                },
                select: { id: true, content_type: true, employee_id: true, employee_name: true, employee_email: true, team: true }
            }),
            this.prisma.kpi.findMany({
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
                    status: { equals: 'Đang hoạt động', mode: 'insensitive' },
                    ...(teamFilter ? { team_traffic: { contains: teamFilter, mode: 'insensitive' } } : {})
                }
            }),
            // Traffic/doanh thu tự báo cáo hàng ngày (checklist + traffic report) — nguồn thay thế cho
            // kpi.traffic_month/revenue_month (job sync Lark ngoài, thường trống cho phần lớn team và
            // đã tạm dừng từ 2026-07-11 — xem AdminOverviewFiltersContext.tsx phía FE).
            this.prisma.trafficReport.findMany({
                where: { date: { gte: start, lte: end } },
                select: { email: true, name: true, team: true, total_traffic: true },
            }),
            this.prisma.checklistReport.findMany({
                where: { date: { gte: start, lte: end } },
                select: { email: true, name: true, team: true, answers: true },
            }),
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

        // Traffic/doanh thu tự báo cáo: quy về 1 "canonical key" (ưu tiên email thật từ bảng users,
        // fallback nameKey) để khớp đúng người dù nguồn (kpi/task/trafficReport/checklistReport) có
        // email hay không — kpi.employee_data thường rỗng nên nhiều dòng kpi chỉ định danh được qua tên.
        const resolveCanonicalKey = (rawEmail: string | null | undefined, rawName: string | null | undefined): string | null => {
            const email = (rawEmail || '').toLowerCase().trim();
            if (email) return email;
            const nameKey = rawName ? rawName.toLowerCase().trim().replace(/\s+/g, ' ') : '';
            if (!nameKey) return null;
            const byName = employeeMapByName.get(nameKey);
            return byName?.email?.toLowerCase().trim() || nameKey;
        };

        const REVENUE_ANSWER_KEY = 'Bạn đã đạt doanh thu của bao nhiêu video?';

        const selfReportedTraffic = new Map<string, number>();
        trafficReportsInRange.forEach((tr: any) => {
            const key = resolveCanonicalKey(tr.email, tr.name);
            if (!key) return;
            selfReportedTraffic.set(key, (selfReportedTraffic.get(key) || 0) + Number(tr.total_traffic || 0));
        });

        const selfReportedRevenue = new Map<string, number>();
        checklistReportsForRevenue.forEach((cr: any) => {
            const key = resolveCanonicalKey(cr.email, cr.name);
            if (!key) return;
            let answers: any = cr.answers;
            if (typeof answers === 'string') {
                try { answers = JSON.parse(answers); } catch { answers = null; }
            }
            const val = answers && typeof answers === 'object' ? Number(answers[REVENUE_ANSWER_KEY]) || 0 : 0;
            if (val > 0) selfReportedRevenue.set(key, (selfReportedRevenue.get(key) || 0) + val);
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
            /** Tổng chỉ tiêu kpi_month (Lark) — dùng tính progress% thật, KHÔNG liên quan phễu A1-A5 */
            kpiTarget: number,
            lineCounts: { [line: string]: number },
            traffic: number,
            revenue: number,
            channels: number,
            isLeader: boolean
        }>();

        // 1. First Pass: Base everyone on Kpi metadata and "completed_month" as requested
        kpis.forEach(kpi => {
            const nameKey = kpi.name?.toLowerCase().trim().replace(/\s+/g, ' ') || '';
            const email = this.extractEmailFromKpi(kpi);
            const key = email || nameKey;

            if (!key) return;

            const trafficVal = Number(kpi.traffic_month || 0);
            const revenueVal = Number(kpi.revenue_month || 0);
            const videosVal = Number(kpi.completed_month || 0);
            const kpiTargetVal = Number(kpi.kpi_month || 0);
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
                existing.kpiTarget = Math.max(existing.kpiTarget, kpiTargetVal);

                // If the selected range is just one day, we prefer that day's completed_day.
                // So sánh theo ngày lịch VN (không dùng .toDateString() — chạy giờ local server,
                // và start/end giờ là ranh giới ngày VN chứ không còn là UTC midnight của ngày chọn).
                const kpiDStr = kpi.report_date ? this.toVietnamDateKey(new Date(kpi.report_date)) : null;
                if (isSingleDaySelected && kpiDStr === singleDayKey) {
                    // Update videoCount to daily count if specifically looking at one day
                    existing.videoCount = Number(kpi.completed_day) || existing.videoCount;
                }
            } else {
                const user = email ? employeeMapByEmail.get(email) : null;
                const kpiDStr = kpi.report_date ? this.toVietnamDateKey(new Date(kpi.report_date)) : null;

                // Use completed_day if single day selected, else completed_month
                const effectiveVideoCount = (isSingleDaySelected && kpiDStr === singleDayKey)
                    ? (Number(kpi.completed_day) || 0)
                    : videosVal;

                empStats.set(key, {
                    name: kpi.name || 'Unknown',
                    email: email || '',
                    empId: kpi.employee_id || 'unknown',
                    team: teamName,
                    videoCount: effectiveVideoCount,
                    kpiTarget: kpiTargetVal,
                    lineCounts: {},
                    traffic: trafficVal,
                    revenue: revenueVal,
                    channels: channelsByOwnerMap.get(nameKey) || user?._count.tracked_channels || 0,
                    isLeader: user?.roles.includes(UserRole.MANAGER) || user?.roles.includes(UserRole.ADMIN) || false
                });
            }
        });

        // 2. Second Pass: Distribute ReportedTask into Line Breakdown
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
                    kpiTarget: 0,
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
                kpiTarget: 0,
                lineCounts: {},
                traffic: 0,
                revenue: 0,
                channels: channelsByOwnerMap.get((stub.name || '').toLowerCase().trim().replace(/\s+/g, ' ')) || user?._count?.tracked_channels || 0,
                isLeader: user?.roles?.includes(UserRole.MANAGER) || user?.roles?.includes(UserRole.ADMIN) || false
            });
        });

        // 3b. Traffic/doanh thu: thay nguồn kpi.traffic_month/revenue_month bằng tổng tự báo cáo hàng
        // ngày (traffic report + đáp án doanh thu trong checklist). Ghi đè mọi entry đã có (kể cả người
        // có dòng kpi/task nhưng traffic/revenue Lark trống), và thêm entry cho người CHỈ có tự báo cáo
        // mà chưa từng có dòng kpi/task nào trong kỳ — phổ biến từ khi job sync Lark dừng 2026-07-11.
        const selfReportedKeys = new Set<string>([...selfReportedTraffic.keys(), ...selfReportedRevenue.keys()]);
        const existingCanonicalKeys = new Set(
            Array.from(empStats.values()).map((s) => resolveCanonicalKey(s.email, s.name)),
        );

        selfReportedKeys.forEach((canonicalKey) => {
            if (existingCanonicalKeys.has(canonicalKey)) return; // đã có entry, ghi đè traffic/revenue ở vòng dưới
            const user = employeeMapByEmail.get(canonicalKey) || employeeMapByName.get(canonicalKey);
            const resolvedTeam = user?.team || 'Khác';
            if (teamFilter && !resolvedTeam.toLowerCase().includes(teamFilter) && !teamFilter.includes(resolvedTeam.toLowerCase())) {
                return;
            }
            empStats.set(canonicalKey, {
                name: user?.full_name || canonicalKey,
                email: user?.email || (canonicalKey.includes('@') ? canonicalKey : ''),
                empId: 'unknown',
                team: resolvedTeam,
                videoCount: 0,
                kpiTarget: 0,
                lineCounts: {},
                traffic: 0,
                revenue: 0,
                channels: user?._count?.tracked_channels || 0,
                isLeader: user?.roles?.includes(UserRole.MANAGER) || user?.roles?.includes(UserRole.ADMIN) || false,
            });
        });

        empStats.forEach((stats) => {
            const canonicalKey = resolveCanonicalKey(stats.email, stats.name);
            stats.traffic = (canonicalKey && selfReportedTraffic.get(canonicalKey)) || 0;
            stats.revenue = (canonicalKey && selfReportedRevenue.get(canonicalKey)) || 0;
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
                target.teamsBySlug[teamSlug] = { name: teamSlug, members: [], stats: { videos: 0, traffic: 0, revenue: 0, channels: 0, kpiTarget: 0 } };
            }
            target.teamsBySlug[teamSlug].members.push(stats);
            target.teamsBySlug[teamSlug].stats.videos += stats.videoCount;
            target.teamsBySlug[teamSlug].stats.traffic += stats.traffic;
            target.teamsBySlug[teamSlug].stats.revenue += stats.revenue;
            target.teamsBySlug[teamSlug].stats.channels += stats.channels;
            target.teamsBySlug[teamSlug].stats.kpiTarget += stats.kpiTarget;
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

        // Comparison for Summary Card — cửa sổ trước đó có CÙNG độ dài (`duration`), kết thúc ngay
        // trước khi cửa sổ hiện tại bắt đầu. Không dùng "start - đúng 1 ngày" cố định nữa: từ khi
        // start/end chuẩn theo ranh giới ngày VN, chọn 1 ngày cũng cho duration ~1 ngày (trước đây do
        // bug start===end nên duration=0, công thức cũ tình cờ đúng cho riêng trường hợp 1 ngày).
        const duration = end.getTime() - start.getTime();
        const prevEnd = new Date(start.getTime() - 1);
        const prevStart = new Date(prevEnd.getTime() - duration);
        const prevTasksCount = await this.prisma.reportedTask.count({
            where: {
                date: { gte: prevStart, lte: prevEnd },
                ...(teamFilter ? { team: { contains: teamFilter, mode: 'insensitive' } } : {})
            }
        });

        const totalVideosInRange = Array.from(empStats.values()).reduce((a, b) => a + Number(b.videoCount), 0);
        const totalTrafficInRange = Math.round(Array.from(empStats.values()).reduce((a, b) => a + b.traffic, 0));
        const totalRevenueInRange = Math.round(Array.from(empStats.values()).reduce((a, b) => a + b.revenue, 0));
        const totalKpiTargetInRange = Array.from(empStats.values()).reduce((a, b) => a + Number(b.kpiTarget), 0);

        return {
            chartData,
            summary: {
                totalVideos: totalVideosInRange,
                prevVideos: prevTasksCount, // Note: Previous period comparison still uses tasks for now
                totalTraffic: totalTrafficInRange,
                totalRevenue: totalRevenueInRange,
                totalKpiTarget: totalKpiTargetInRange,
                progressPct: totalKpiTargetInRange > 0 ? Math.round((totalVideosInRange / totalKpiTargetInRange) * 100) : null
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
        return this.prisma.reportedTask.deleteMany();
    }
}
