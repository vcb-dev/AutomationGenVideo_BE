
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class LarkService {
    private readonly logger = new Logger(LarkService.name);
    private accessToken: string;
    private tokenExpiresAt: number;

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
    private readonly REPORT_KPI_TABLE_ID: string;

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
        private readonly prisma: PrismaService,
    ) {
        // Load credentials from environment
        this.APP_ID = this.configService.get<string>('LARK_APP_ID');
        this.APP_SECRET = this.configService.get<string>('LARK_APP_SECRET');

        // Load Bitable IDs from environment
        this.REPORT_BASE_ID = this.configService.get<string>('LARK_REPORT_BASE_ID');
        this.REPORT_TABLE_ID = this.configService.get<string>('LARK_REPORT_TABLE_ID');
        this.KPI_BASE_ID = this.configService.get<string>('LARK_KPI_BASE_ID');
        this.KPI_TABLE_ID = this.configService.get<string>('LARK_KPI_TABLE_ID');
        this.EMPLOYEE_TABLE_ID = this.configService.get<string>('LARK_EMPLOYEE_TABLE_ID');
        this.PERMISSION_TABLE_ID = this.configService.get<string>('LARK_PERMISSION_TABLE_ID');
        this.REPORT_KPI_TABLE_ID = this.configService.get<string>('LARK_REPORT_KPI_TABLE_ID');
    }

    async getAccessToken(): Promise<string> {
        if (!this.APP_ID || !this.APP_SECRET) {
            throw new Error('LARK_APP_ID and LARK_APP_SECRET must be configured in .env file');
        }

        if (this.accessToken && Date.now() < this.tokenExpiresAt) {
            return this.accessToken;
        }

        try {
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
        } catch (error) {
            this.logger.error('Failed to get access token', error);
            throw error;
        }
    }

    @Cron(CronExpression.EVERY_30_MINUTES)
    async handleCron() {
        this.logger.log('Starting scheduled Lark data sync (Reports, KPI, Employees)...');
        try {
            await Promise.all([
                this.syncReportData(),
                this.syncKPIData(),
                this.syncEmployeeData(),
                this.syncPermissionData(),
                this.syncHuykChannelData(),
                this.syncReportKPIData(),
            ]);
            this.logger.log('Scheduled Lark data sync completed successfully.');
        } catch (error) {
            this.logger.error('Scheduled Lark data sync failed', error);
        }
    }

    // Cron job runs at 12:00 AM every night to clean up invalid data
    @Cron('0 0 * * *', { name: 'lark-data-cleanup', timeZone: 'Asia/Ho_Chi_Minh' })
    async handleCleanup() {
        this.logger.log('Starting midnight data cleanup for Lark tables...');
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

            // Cleanup Logic for LarkEmployee
            const employeeResult = await this.prisma.larkEmployee.deleteMany({
                where: {
                    OR: [
                        { name: { equals: 'Unknown' } },
                        { name: { equals: '' } },
                        { name: { equals: ' ' } }
                    ]
                }
            });

            this.logger.log(`Cleanup completed: 
                - Removed ${kpiResult.count} invalid KPI records.
                - Removed ${reportResult.count} invalid Report records.
                - Removed ${employeeResult.count} invalid Employee records.`);
        } catch (error) {
            this.logger.error('Failed to run data cleanup', error);
        }
    }

    async syncReportData() {
        try {
            const records = await this.fetchLarkRecords();
            this.logger.log(`Fetched ${records.length} records from Lark. Syncing to database...`);

            // Migration: Update old labels
            await this.prisma.$executeRawUnsafe(`UPDATE "report_outstanding" SET "content" = 'SẢN PHẨM WIN' WHERE "content" = 'VIDEO SẢN PHẨM WIN'`);

            if (records.length > 0) {
                this.logger.debug('First record fields keys:', Object.keys(records[0].fields));
                this.logger.debug('First record fields:', JSON.stringify(records[0].fields, null, 2));
            }

            let syncedCount = 0;
            for (const record of records) {
                const reportData = this.mapRecordToReport(record);

                // Skip garbage
                if (!reportData.name || reportData.name === 'Unknown') {
                    this.logger.debug(`Skipping garbage report record: ${record.record_id}`);
                    continue;
                }

                await this.prisma.larkReport.upsert({
                    where: { id: reportData.id },
                    update: {
                        email: reportData.email,
                        name: reportData.name,
                        employee: reportData.employee,
                        role: reportData.role,
                        team: reportData.team,
                        date: reportData.date,
                        answers: reportData.answers,
                    },
                    create: {
                        id: reportData.id,
                        email: reportData.email,
                        name: reportData.name,
                        employee: reportData.employee,
                        role: reportData.role,
                        team: reportData.team,
                        date: reportData.date,
                        answers: reportData.answers,
                    },
                });

                // Extract and sync outstandings
                await this.extractAndSyncOutstandings(reportData);

                syncedCount++;
            }

            this.logger.log(`Successfully synced ${syncedCount} records.`);
        } catch (error) {
            this.logger.error('Failed to sync report data', error);
        }
    }

    private async extractAndSyncOutstandings(reportData: any) {
        let answers = reportData.answers;
        if (typeof answers === 'string') {
            try { answers = JSON.parse(answers); } catch (e) { return; }
        }
        if (!answers || typeof answers !== 'object') return;

        const date = reportData.date || new Date();
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const dateStr = startOfDay.toISOString().split('T')[0];

        const findAnswer = (keywords: string[]) => {
            for (const key of Object.keys(answers)) {
                if (keywords.some(kw => key.toLowerCase().includes(kw.toLowerCase()))) {
                    const val = answers[key];
                    if (val && !['không', 'không có', 'chưa', 'none', ''].includes(val.toString().toLowerCase().trim())) {
                        return val;
                    }
                }
            }
            return null;
        };

        const rules = [
            {
                content: 'Ý KIẾN ĐÓNG GÓP CẢI TIẾN MỚI',
                answer: findAnswer(['4. ban co dong gop', '4. ban co bat ky y tuong', '4. ban co dang ki'])
                    || findAnswer(['dong gop y tuong hay de xuat'])
            },
            {
                content: 'KHÓ KHĂN CẦN HỖ TRỢ',
                answer: findAnswer(['3. ban co gap kho khan', '3. ban co gap tro ngai'])
                    || findAnswer(['co gap kho khan nao can ho tro'])
            },
            {
                content: 'SẢN PHẨM WIN',
                answer: findAnswer(['5. ban co san pham', '5. ban co clip win'])
                    || findAnswer(['co san pham (a4 - a5) nao win moi khong'])
            },
            {
                content: 'VIDEO WIN',
                answer: findAnswer(['thanh vien nao co video win nhat', 'video win nhat'])
            }
        ];

        for (const rule of rules) {
            if (rule.answer) {
                // Use a stable ID to prevent duplicates: [name]_[date]_[type]
                const stableId = Buffer.from(`${reportData.name}_${dateStr}_${rule.content}`).toString('base64').substring(0, 50);

                await this.prisma.$executeRawUnsafe(`
                    INSERT INTO "report_outstanding" ("id", "name", "date", "team", "content", "idea_content", "email", "created_at", "updated_at")
                    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
                    ON CONFLICT ("id") DO UPDATE SET
                    "team" = EXCLUDED."team",
                    "content" = EXCLUDED."content",
                    "idea_content" = EXCLUDED."idea_content",
                    "email" = EXCLUDED."email",
                    "updated_at" = NOW()
                `, stableId, reportData.name, startOfDay, reportData.team, rule.content, String(rule.answer), reportData.email);
            }
        }
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
            orderBy: { created_at: 'desc' }
        });
    }

    async getPermissionData() {
        return this.prisma.$queryRawUnsafe('SELECT * FROM "lark_permissions" ORDER BY "created_at" DESC');
    }

    async getPermissionByEmail(email: string) {
        if (!email) return null;
        const results = await this.prisma.$queryRawUnsafe<any[]>(
            'SELECT * FROM "lark_permissions" WHERE "email" ILIKE $1 LIMIT 1',
            email
        );
        return results.length > 0 ? results[0] : null;
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

    async syncHuykChannelData() {
        try {
            // This table tbljWdSiFVVWVqfp belongs to the REPORT_BASE_ID
            const baseId = this.configService.get<string>('LARK_REPORT_BASE_ID') || 'Q5Fmby8DVaKOyusfR8glgRB6gbf';
            const tableId = 'tbljWdSiFVVWVqfp';

            this.logger.log(`Syncing Huyk Channel table: ${tableId} from base: ${baseId}`);
            const records = await this.fetchLarkRecordsGeneric(baseId, tableId);
            this.logger.log(`Fetched ${records.length} records from Huyk Channel table. Syncing to HuykChannel model...`);

            const extractString = (val: any): string | null => {
                if (!val) return null;
                if (typeof val === 'string') return val;
                if (Array.isArray(val) && val.length > 0) {
                    const first = val[0];
                    return first.name || first.text || (typeof first === 'string' ? first : null);
                }
                if (typeof val === 'object') return val.link || val.text || val.name || null;
                return String(val);
            };

            for (const record of records) {
                const fields = record.fields;

                // Mapping based on new table structure
                const data = {
                    id: record.record_id,
                    name: extractString(fields['Tên kênh hiện tại']) || 'N/A',
                    platform: extractString(fields['Nền tảng']) || '',
                    channel_id: extractString(fields['ID kênh hiện tại']) || '',
                    link_channel: extractString(fields['Link kênh']) || '',
                    status: extractString(fields['Trạng thái hoạt động']) || '',
                    team_traffic: extractString(fields['Team Traffic']) || '',
                    owner: extractString(fields['NV traffic xây kênh']) || '',
                };

                await this.prisma.huykChannel.upsert({
                    where: { id: data.id },
                    update: data,
                    create: data,
                });
            }
            this.logger.log(`Successfully synced ${records.length} records to HuykChannel.`);
        } catch (error) {
            this.logger.error('Failed to sync Huyk Channel data', error);
        }
    }

    async getHuykChannelData() {
        return this.prisma.huykChannel.findMany({
            orderBy: { created_at: 'desc' }
        });
    }

    async clearHuykChannels() {
        return this.prisma.huykChannel.deleteMany({});
    }

    async fetchLarkRecordsGeneric(baseId: string, tableId: string) {
        const token = await this.getAccessToken();
        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/records`;

        let allRecords = [];
        let pageToken = '';
        let hasMore = true;

        try {
            while (hasMore) {
                const response = await firstValueFrom(
                    this.httpService.get(url, {
                        headers: { Authorization: `Bearer ${token}` },
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


    private mapRecordToReport(record: any) {
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
            email: fields['Email'] || null,
            name: name || 'Unknown',
            employee: fields['Nhân viên'] || null,
            role: fields['Role'] || null,
            team: fields['Team'] || null,
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

                await this.prisma.larkEmployee.upsert({
                    where: { id: employeeData.id },
                    update: {
                        employee_id: employeeData.employee_id,
                        name: employeeData.name,
                        image_url: employeeData.image_url,
                        employee_data: employeeData.employee_data,
                        tag_code: employeeData.tag_code,
                        position: employeeData.position,
                        team: employeeData.team,
                        status: employeeData.status,
                        date: employeeData.date,
                    },
                    create: {
                        id: employeeData.id,
                        employee_id: employeeData.employee_id,
                        name: employeeData.name,
                        image_url: employeeData.image_url,
                        employee_data: employeeData.employee_data,
                        tag_code: employeeData.tag_code,
                        position: employeeData.position,
                        team: employeeData.team,
                        status: employeeData.status,
                        date: employeeData.date,
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

        let name = extractString(fields['Tên'] || fields['Ten'] || fields['Họ tên'] || fields['Nhân viên']);

        // Extract image URL from Hình ảnh field
        let imageUrl = null;
        if (fields['Hình ảnh'] && Array.isArray(fields['Hình ảnh']) && fields['Hình ảnh'].length > 0) {
            imageUrl = fields['Hình ảnh'][0].url || fields['Hình ảnh'][0].tmp_url || null;
        }

        // Convert Excel serial date to JS Date if exists
        let dateValue = null;
        if (fields['NGÀY']) {
            // Excel serial date: days since 1899-12-30
            const excelEpoch = new Date(1899, 11, 30);
            const days = parseInt(fields['NGÀY']);
            dateValue = new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000);
        }

        // Extract tag code - field name is "MÃ TAG" (uppercase, no diacritic on A)
        // Value is array: [{"type": "text", "text": "K101"}]
        let tagCode = null;
        if (fields['MÃ TAG'] && Array.isArray(fields['MÃ TAG']) && fields['MÃ TAG'].length > 0) {
            tagCode = fields['MÃ TAG'][0].text || null;
        }

        return {
            id: record.record_id,
            employee_id: fields['ID nhân viên'] || null,
            name: name || 'Unknown',
            image_url: imageUrl,
            employee_data: fields['Nhân viên'] || null,
            tag_code: tagCode,
            position: fields['Chức vụ'] || null,
            team: fields['Team'] || null,
            status: fields['Tình trạng'] || null,
            date: dateValue,
        };
    }

    // Get all employees from DB
    async getEmployeeData() {
        return this.prisma.larkEmployee.findMany({
            where: {
                status: {
                    not: 'đã nghỉ'
                }
            },
            orderBy: { created_at: 'desc' }
        });
    }

    // Fetch KPI records from Lark
    async fetchKPIRecords() {
        const token = await this.getAccessToken();
        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${this.KPI_BASE_ID}/tables/${this.KPI_TABLE_ID}/records`;

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
            this.logger.error('Failed to fetch KPI records from Lark', error);
            throw error;
        }
    }

    // Sync KPI data from Lark to database
    async syncKPIData() {
        try {
            const records = await this.fetchKPIRecords();
            this.logger.log(`Fetched ${records.length} KPI records from Lark. Syncing to database...`);

            let syncedCount = 0;
            const rawSamples = [];
            const allKeys = new Set<string>();

            for (const record of records) {
                Object.keys(record.fields).forEach(k => allKeys.add(k));
                if (rawSamples.length < 3) rawSamples.push(record);

                const kpiData = this.mapRecordToKPI(record);

                // Skip garbage: No name or just whitespace/Unknown
                const cleanName = (kpiData.name || '').trim();
                if (!cleanName || cleanName.toLowerCase() === 'unknown') {
                    this.logger.debug(`Skipping invalid KPI record during sync: ${record.record_id}`);
                    continue;
                }

                // Skip records that are useless (no name AND no team)
                if (!kpiData.name && !kpiData.team) {
                    this.logger.debug(`Skipping empty KPI record: ${record.record_id}`);
                    continue;
                }

                await this.prisma.larkKPI.upsert({
                    where: { id: kpiData.id },
                    update: {
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
                    },
                    create: {
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
                    },
                });
                syncedCount++;
            }

            this.logger.log(`Successfully synced ${syncedCount} KPI records.`);
            return {
                synced: syncedCount,
                total: records.length,
                samples: rawSamples,
                allKeys: Array.from(allKeys)
            };
        } catch (error) {
            this.logger.error('Failed to sync KPI data', error);
            throw error;
        }
    }

    // Sync Report KPI data from Lark (tblh9DeeqDBItrg7) to database
    async syncReportKPIData() {
        try {
            if (!this.KPI_BASE_ID || !this.REPORT_KPI_TABLE_ID) {
                this.logger.warn('LARK_KPI_BASE_ID or LARK_REPORT_KPI_TABLE_ID not configured');
                return { synced: 0, total: 0 };
            }

            const records = await this.fetchLarkRecordsGeneric(this.KPI_BASE_ID, this.REPORT_KPI_TABLE_ID);
            this.logger.log(`Fetched ${records.length} Report KPI records from Lark. Syncing to database...`);

            let syncedCount = 0;
            for (const record of records) {
                const mappedData = this.mapRecordToReportKPI(record);

                if (!mappedData.email && !mappedData.name) continue;

                await (this.prisma as any).$executeRawUnsafe(`
                    INSERT INTO "lark_report_kpi" (
                        "id", "employee_id", "name", "email", "team", "month", "report_date",
                        "kpi_day", "kpi_month", "completed_day", "completed_month", "kpi_status",
                        "task_auto", "task_auto_month", "task_new", "task_new_month", "traffic_month",
                        "status", "image_url", "updated_at"
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW())
                    ON CONFLICT ("id") DO UPDATE SET
                        "employee_id" = EXCLUDED."employee_id",
                        "name" = EXCLUDED."name",
                        "email" = EXCLUDED."email",
                        "team" = EXCLUDED."team",
                        "month" = EXCLUDED."month",
                        "report_date" = EXCLUDED."report_date",
                        "kpi_day" = EXCLUDED."kpi_day",
                        "kpi_month" = EXCLUDED."kpi_month",
                        "completed_day" = EXCLUDED."completed_day",
                        "completed_month" = EXCLUDED."completed_month",
                        "kpi_status" = EXCLUDED."kpi_status",
                        "task_auto" = EXCLUDED."task_auto",
                        "task_auto_month" = EXCLUDED."task_auto_month",
                        "task_new" = EXCLUDED."task_new",
                        "task_new_month" = EXCLUDED."task_new_month",
                        "traffic_month" = EXCLUDED."traffic_month",
                        "status" = EXCLUDED."status",
                        "image_url" = EXCLUDED."image_url",
                        "updated_at" = NOW();
                `,
                    mappedData.id, mappedData.employee_id, mappedData.name, mappedData.email, mappedData.team, mappedData.month, mappedData.report_date,
                    mappedData.kpi_day, mappedData.kpi_month, mappedData.completed_day, mappedData.completed_month, mappedData.kpi_status,
                    mappedData.task_auto, mappedData.task_auto_month, mappedData.task_new, mappedData.task_new_month, mappedData.traffic_month,
                    mappedData.status, mappedData.image_url);

                syncedCount++;
            }

            this.logger.log(`Successfully synced ${syncedCount} Report KPI records.`);
            return { synced: syncedCount, total: records.length };
        } catch (error) {
            this.logger.error('Failed to sync Report KPI data', error);
            throw error;
        }
    }

    private mapRecordToReportKPI(record: any) {
        const fields = record.fields;
        const person = Array.isArray(fields['Nhân viên']) ? fields['Nhân viên'][0] : (fields['Nhân viên'] || {});

        // Handle timestamp conversion
        let reportDate = null;
        if (fields['Ngày báo cáo']) {
            const val = Number(fields['Ngày báo cáo']);
            if (!isNaN(val)) reportDate = new Date(val);
        }

        return {
            id: record.record_id,
            employee_id: fields['ID nhân viên'] || null,
            name: person.name || null,
            email: person.email || null,
            team: fields['Team'] || null,
            month: fields['Tháng'] || null,
            report_date: reportDate,
            kpi_day: Number(fields['KPI Ngày']) || 0,
            kpi_month: Number(fields['KPI THÁNG']) || 0,
            completed_day: Number(fields['Hoàn thành']) || 0,
            completed_month: Number(fields['Hoàn thành Tháng']) || 0,
            kpi_status: fields['KPII'] || null,
            task_auto: Number(fields['Task Auto']) || 0,
            task_auto_month: Number(fields['Task Auto Tháng']) || 0,
            task_new: Number(fields['Task mới']) || 0,
            task_new_month: Number(fields['Task mới tháng']) || 0,
            traffic_month: fields['Traffic Tháng'] ? BigInt(fields['Traffic Tháng']) : BigInt(0),
            revenue_month: fields['Doanh thu Tháng'] ? BigInt(fields['Doanh thu Tháng']) : BigInt(0),
            revenue_day: fields['Doanh thu'] ? BigInt(fields['Doanh thu']) : BigInt(0),
            status: fields['Trạng thái'] || null,
            image_url: fields['Link ảnh'] || (Array.isArray(fields['Link ảnh']) ? fields['Link ảnh'][0]?.url : null),
        };
    }

    // Map Lark KPI record to database format
    private mapRecordToKPI(record: any) {
        const fields = record.fields;

        // Robust key normalization to handle mangled Unicode and variations
        const normalizeKey = (key: string) => {
            return key.toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '') // Remove accents
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
                const first = val[0];
                return first.name || first.text || (typeof first === 'string' ? first : null);
            }
            if (typeof val === 'object') return val.name || val.text || null;
            return String(val);
        };

        let name = extractString(findValue(['Tên', 'Ten', 'Họ tên', 'Ho ten', 'Full Name']));

        // If name still null, try 'Nhân viên' or 'Nhan vien' (User field)
        if (!name) {
            name = extractString(findValue(['Nhân viên', 'Nhan vien', 'Employee']));
        }

        // Final fallback: ID nhân viên or TAG if it looks like a name/code
        if (!name) {
            name = extractString(findValue(['ID nhân viên', 'Mã Nhân Viên VCB', 'TAG']));
        }

        if (!name) {
            this.logger.warn(`KPI Record ${record.record_id} has no name. Fields: ${Object.keys(record.fields).join(', ')}`);
        }

        // Extract KPI day percent
        let kpiDayPercent = null;
        const kpiDayPctVal = findValue(['% KPI NGÀY', '% KPI NGAY']);
        if (Array.isArray(kpiDayPctVal) && kpiDayPctVal.length > 0) {
            kpiDayPercent = kpiDayPctVal[0].text || null;
        }

        // Extract creative task
        let taskCreative = null;
        const taskSángTạo = findValue(['Task sáng tạo', 'Task sang tao']);
        if (Array.isArray(taskSángTạo) && taskSángTạo.length > 0) {
            taskCreative = parseInt(taskSángTạo[0]) || null;
        }

        // Extract auto task
        let taskAutoVal = findValue(['Số task tự động', 'So task tu dong', 'Task Auto']);
        if (Array.isArray(taskAutoVal) && taskAutoVal.length > 0) {
            taskAutoVal = parseInt(taskAutoVal[0]) || null;
        }

        // Date parsing
        let reportDate = null;
        const ngayBaoCao = findValue(['Ngày báo cáo', 'Ngay bao cao']);
        if (ngayBaoCao) {
            if (typeof ngayBaoCao === 'number') {
                const excelEpoch = new Date(1899, 11, 30);
                reportDate = new Date(excelEpoch.getTime() + ngayBaoCao * 24 * 60 * 60 * 1000);
            } else {
                reportDate = new Date(ngayBaoCao);
            }
        }

        return {
            id: record.record_id,
            employee_id: findValue(['ID nhân viên', 'ID nhan vien']) || null,
            name: name,
            tag: findValue(['TAG']) || null,
            team: findValue(['Team']) || null,
            image_url: imageUrl,
            kpi_day: findValue(['KPI Ngày', 'KPI Ngay']) ?? null,
            kpi_month: findValue(['KPI THÁNG', 'KPI THANG']) ?? null,
            kpii_status: findValue(['KPII']) || null,
            kpi_day_percent: kpiDayPercent,
            completed_day: findValue(['Hoàn thành', 'Hoan thanh']) ?? null,
            completed_month: findValue(['Hoàn thành Tháng', 'Hoan thanh Thang']) ?? null,
            task_new: findValue(['Task mới', 'Task moi']) ?? null,
            task_new_month: findValue(['Task mới tháng', 'Task moi thang']) ?? null,
            task_auto: taskAutoVal,
            task_auto_month: findValue(['Task Auto Tháng', 'Task Auto Thang']) ?? null,
            task_creative: taskCreative,
            content_win_new: findValue(['Content win mới', 'Content win moi']) ?? null,
            revenue_month: findValue(['Doanh thu tháng', 'Doanh thu thang']) != null ? BigInt(findValue(['Doanh thu tháng', 'Doanh thu thang'])) : null,
            traffic_month: findValue(['Traffic Tháng', 'Traffic Thang']) != null ? BigInt(findValue(['Traffic Tháng', 'Traffic Thang'])) : null,
            target_revenue_month: findValue(['Mục tiêu doanh thu tháng', 'Muc tieu doanh thu thang']) || null,
            target_traffic_month: findValue(['Mục tiêu Traffic tháng', 'Muc tieu Traffic thang']) || null,
            kpi_progress_month: findValue(['Tiến độ KPI tháng', 'Tien do KPI thang']) ?? null,
            employee_status: findValue(['Tình trạng', 'Tinh trang']) || null,
            state: findValue(['Trạng thái', 'Trang thai']) || null,
            employee_data: findValue(['Nhân viên', 'Nhan vien']) || null,
            report_date: reportDate,
            month: findValue(['Tháng', 'Thang']) || null,
            link_image: findValue(['Link ảnh', 'Link anh', 'flddOHyBPa']) || null,
        };
    }

    // Get all KPI data from DB
    async getKPIData() {
        return this.prisma.larkKPI.findMany({
            orderBy: { report_date: 'desc' }
        });
    }

    // Get combined user activity reports (LarkReport + LarkKPI)
    async getUserActivityReports(filters?: { date?: string; startDate?: string; endDate?: string; team?: string; requesterEmail?: string }) {
        try {
            // Fetch requester's role and team from LarkPermission
            let requesterRole = 'Member';
            let requesterTeam = null;

            if (filters?.requesterEmail) {
                const results = await this.prisma.$queryRawUnsafe<any[]>(
                    'SELECT * FROM "lark_permissions" WHERE "email" ILIKE $1 LIMIT 1',
                    filters.requesterEmail
                );
                const permission = results.length > 0 ? results[0] : null;
                if (permission) {
                    requesterRole = (permission.role || 'Member').toLowerCase();
                    requesterTeam = permission.team;
                }
            }

            // Fetch reports with optional filters
            const whereClause: any = {};
            let startOfDay: Date;
            let endOfDay: Date;

            if (filters?.startDate && filters?.endDate) {
                startOfDay = new Date(filters.startDate);
                startOfDay.setHours(0, 0, 0, 0);
                endOfDay = new Date(filters.endDate);
                endOfDay.setHours(23, 59, 59, 999);
            } else if (filters?.date) {
                const d = new Date(filters.date);
                startOfDay = new Date(d);
                startOfDay.setHours(0, 0, 0, 0);
                endOfDay = new Date(d);
                endOfDay.setHours(23, 59, 59, 999);
            } else {
                const d = new Date();
                startOfDay = new Date(d);
                startOfDay.setHours(0, 0, 0, 0);
                endOfDay = new Date(d);
                endOfDay.setHours(23, 59, 59, 999);
            }

            whereClause.date = {
                gte: startOfDay,
                lte: endOfDay,
            };

            const targetMonthNum = startOfDay.getMonth() + 1;
            const targetYear = startOfDay.getFullYear();

            // Fetch reports (unfiltered by team initially to allow cross-team detection)
            const reports = await this.prisma.larkReport.findMany({
                where: whereClause,
                orderBy: { date: 'desc' },
            });

            // Fetch all KPIs for the matching year/month if possible
            const allKpiInDb = await this.prisma.larkKPI.findMany();

            const monthFormats = [
                `T${targetMonthNum}`,
                `T${targetMonthNum < 10 ? '0' + targetMonthNum : targetMonthNum}`,
                `Tháng ${targetMonthNum}`,
                `tháng ${targetMonthNum}`,
                `Thang ${targetMonthNum}`,
                `thang ${targetMonthNum}`,
                `${targetMonthNum}`,
                targetMonthNum < 10 ? `0${targetMonthNum}` : `${targetMonthNum}`,
                ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][targetMonthNum],
                ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][targetMonthNum]
            ].filter(Boolean);

            let kpiData = allKpiInDb.filter(k => {
                if (k.state?.toLowerCase() === 'off') return false;
                const m = (k.month || '').trim();
                if (!m) {
                    // No month set: include if report_date is in target month
                    const rd = k.report_date;
                    if (rd) {
                        const d = new Date(rd);
                        return d.getMonth() + 1 === targetMonthNum && d.getFullYear() === targetYear;
                    }
                    return false;
                }
                if (monthFormats.includes(m)) return true;
                // Flexible: any string containing target month number (e.g. "2026-02", "KPI T2")
                const monthNum = parseInt(targetMonthNum.toString(), 10);
                const mDigits = m.match(/\d+/g);
                if (mDigits && mDigits.some(d => parseInt(d, 10) === monthNum)) return true;
                // ISO-style "YYYY-MM"
                if (/^\d{4}-\d{1,2}$/.test(m)) {
                    const [, mo] = m.split('-').map(Number);
                    return mo === monthNum;
                }
                return false;
            });

            // Fallback: nếu không có bản ghi KPI nào khớp tháng → thử tháng trước, rồi tháng trước nữa
            let kpiMonthFallback = false;
            if (kpiData.length === 0 && allKpiInDb.length > 0) {
                // Try previous months (up to 3 months back)
                for (let i = 1; i <= 3 && kpiData.length === 0; i++) {
                    let prevMonth = targetMonthNum - i;
                    if (prevMonth <= 0) prevMonth += 12;
                    const prevFormats = [
                        `T${prevMonth}`,
                        `T${prevMonth < 10 ? '0' + prevMonth : prevMonth}`,
                        `Tháng ${prevMonth}`,
                        `tháng ${prevMonth}`,
                        `${prevMonth}`,
                        prevMonth < 10 ? `0${prevMonth}` : `${prevMonth}`,
                    ].filter(Boolean);
                    kpiData = allKpiInDb.filter(k => {
                        if (k.state?.toLowerCase() === 'off') return false;
                        const m = (k.month || '').trim();
                        if (!m) return false;
                        if (prevFormats.includes(m)) return true;
                        const mDigits = m.match(/\d+/g);
                        return mDigits ? mDigits.some(d => parseInt(d, 10) === prevMonth) : false;
                    });
                    if (kpiData.length > 0) {
                        kpiMonthFallback = true;
                        this.logger.warn(`No KPI for month ${targetMonthNum}/${targetYear}; using ${kpiData.length} records from month ${prevMonth} as fallback.`);
                    }
                }
                // Ultimate fallback: use all records if still empty
                if (kpiData.length === 0) {
                    kpiData = allKpiInDb.filter(k => k.state?.toLowerCase() !== 'off');
                    kpiMonthFallback = kpiData.length > 0;
                    if (kpiMonthFallback) {
                        this.logger.warn(`No KPI for recent months; using all ${kpiData.length} KPI records in DB as fallback.`);
                    }
                }
            }

            this.logger.log(`Filtered ${kpiData.length} KPIs for month ${targetMonthNum}/${targetYear} (formats: ${monthFormats.slice(0, 6).join(', ')}...). Total in DB: ${allKpiInDb.length}`);

            // Fetch all employees to get positions
            const employees = await this.prisma.larkEmployee.findMany();
            const employeeMap = new Map();
            employees.forEach(emp => {
                if (emp.employee_id) {
                    employeeMap.set(emp.employee_id.trim(), emp);
                }
                if (emp.name) {
                    const nameKey = emp.name.toLowerCase().trim().replace(/\s+/g, ' ');
                    if (!employeeMap.has(nameKey)) {
                        employeeMap.set(nameKey, emp);
                    }
                }
            });

            // Fetch all permissions for identifying requester in results
            const permissions = await this.prisma.$queryRawUnsafe<any[]>('SELECT * FROM "lark_permissions"');

            const permMap = new Map();
            permissions.forEach(p => {
                if (p.name) {
                    const nameKey = p.name.toLowerCase().trim().replace(/\s+/g, ' ');
                    permMap.set(nameKey, p);
                }
                if (p.email) {
                    permMap.set(p.email.toLowerCase().trim(), p);
                }
            });

            // Fetch all Huyk Channels to count per user
            const allHuykChannels = await this.prisma.huykChannel.findMany();
            const huykChannelMap = new Map();
            allHuykChannels.forEach(h => {
                if (h.owner) {
                    const ownerKey = h.owner.toLowerCase().trim().replace(/\s+/g, ' ');
                    huykChannelMap.set(ownerKey, (huykChannelMap.get(ownerKey) || 0) + 1);
                }
            });

            const dailyReportKpis = await (this.prisma as any).larkReportKPI.findMany({
                where: {
                    report_date: {
                        gte: startOfDay,
                        lte: endOfDay,
                    }
                }
            });

            const reportKpiMapByEmail = new Map();
            const reportKpiMapByName = new Map();

            dailyReportKpis.forEach(rk => {
                const emailKey = rk.email?.toLowerCase().trim();
                const nameKey = rk.name ? rk.name.toLowerCase().trim().replace(/\s+/g, ' ') : null;

                const existing = emailKey ? reportKpiMapByEmail.get(emailKey) : (nameKey ? reportKpiMapByName.get(nameKey) : null);

                if (existing) {
                    // Update: sum metrics but keep latest metadata
                    existing.kpi_day = (existing.kpi_day || 0) + (rk.kpi_day || 0);
                    existing.completed_day = (existing.completed_day || 0) + (rk.completed_day || 0);
                    existing.task_auto = (existing.task_auto || 0) + (rk.task_auto || 0);
                    existing.task_new = (existing.task_new || 0) + (rk.task_new || 0);
                    existing.traffic_month = (Number(existing.traffic_month) || 0) + (Number(rk.traffic_month) || 0);
                    // Image/Avatar: take non-null if existing is null
                    if (!existing.image_url && rk.image_url) existing.image_url = rk.image_url;
                } else {
                    // Start new aggregated record (clone to avoid mutating the original fetched objects)
                    const clone = { ...rk };
                    if (emailKey) reportKpiMapByEmail.set(emailKey, clone);
                    if (nameKey) reportKpiMapByName.set(nameKey, clone);
                }
            });

            // Create maps for quick KPI lookup
            const kpiByNameTeam = new Map();
            const kpiByName = new Map();

            // Store unique KPI per person for aggregation
            const kpisForAggregation = new Map();
            const nameToPersonKey = new Map();

            kpiData.forEach(kpi => {
                const nameKey = kpi.name ? kpi.name.toLowerCase().trim().replace(/\s+/g, ' ') : null;
                const teamKey = kpi.team?.toLowerCase().trim() || '';
                const trimmedEmpId = kpi.employee_id?.trim();

                // Use record ID as ultimate fallback for key to ensure data is counted
                const personKey = trimmedEmpId || nameKey || kpi.id;

                if (nameKey) {
                    nameToPersonKey.set(nameKey, personKey);
                    if (teamKey) {
                        kpiByNameTeam.set(`${nameKey}_${teamKey}`, kpi);
                    }
                    // Also store by name as secondary (prefer records with image)
                    if (!kpiByName.has(nameKey) || kpi.link_image || kpi.image_url) {
                        kpiByName.set(nameKey, kpi);
                    }
                }

                // For summary calculation, we take the one with highest progress or latest
                if (!kpisForAggregation.has(personKey) || (kpi.completed_month || 0) > (kpisForAggregation.get(personKey).completed_month || 0)) {
                    kpisForAggregation.set(personKey, kpi);
                }
            });

            // Fetch reports for the specific day
            const dailyReports = await this.prisma.larkReport.findMany({
                where: whereClause,
                orderBy: { date: 'desc' },
            });

            // Map reports by name for fast lookup
            const reportsMap = new Map();
            dailyReports.forEach(r => {
                if (r.name) {
                    const nameKey = r.name.toLowerCase().trim().replace(/\s+/g, ' ');
                    const existing = reportsMap.get(nameKey);

                    if (existing) {
                        // Aggregate numeric answers
                        if (existing.answers && r.answers) {
                            const eAns = existing.answers as any;
                            const rAns = r.answers as any;
                            const videoKey = 'Số video edit sử dụng >50% source từ quay?';
                            if (rAns[videoKey]) {
                                // Sum up numeric values
                                const currentTotal = Number(eAns[videoKey]) || 0;
                                const newVal = Number(rAns[videoKey]) || 0;
                                eAns[videoKey] = currentTotal + newVal;
                            }
                        }
                    } else {
                        // Clone to avoid mutation of findMany result
                        reportsMap.set(nameKey, { ...r });
                    }

                    const personKey = nameToPersonKey.get(nameKey) || nameKey;

                    if (!kpisForAggregation.has(personKey)) {
                        kpisForAggregation.set(personKey, {
                            id: `report_${r.id}`,
                            name: r.name,
                            team: r.team || 'Khác',
                            kpi_day: 0,
                            kpi_month: 0,
                            completed_day: 0,
                            completed_month: 0,
                            traffic_month: 0,
                            revenue_month: 0,
                            kpi_progress_month: 0
                        });
                    }
                }
            });

            const teamFilterNormalized = filters?.team && filters.team !== 'All' ? filters.team.toLowerCase().trim() : null;

            const allResults = Array.from(kpisForAggregation.values()).map(kpi => {
                const nameKey = kpi.name?.toLowerCase().trim().replace(/\s+/g, ' ') || '';

                // Final guard: Skip records with no effective name in dashboard
                if (!nameKey || nameKey === 'unknown') {
                    return null;
                }

                const report = reportsMap.get(nameKey);

                // EFFECTIVE TEAM: Use today's report team FIRST, else fallback to KPI record
                const trimmedEmpId = kpi.employee_id?.trim();
                const personKey = trimmedEmpId || nameKey;
                const employee = employeeMap.get(nameKey) || (trimmedEmpId ? employeeMap.get(trimmedEmpId) : null);

                // Hỗ trợ lọc nhân viên đã nghỉ - nếu status là "đã nghỉ" thì không hiển thị
                const empStatus = (employee?.status || '').toLowerCase().trim();
                const kpiEmpStatus = (kpi.employee_status || '').toLowerCase().trim();
                const kpiState = (kpi.state || '').toLowerCase().trim();

                const isResigned = empStatus.includes('nghỉ') ||
                    empStatus === 'da nghi' ||
                    kpiEmpStatus.includes('nghỉ') ||
                    kpiEmpStatus === 'da nghi' ||
                    kpiState === 'off';

                if (isResigned) {
                    return null;
                }

                const position = employee?.position || null;

                const effectiveTeam = report?.team || kpi.team || 'Khác';
                const effectiveTeamNormalized = effectiveTeam.toLowerCase().trim();

                // Relaxed team matching
                const isMatchForRanking = !teamFilterNormalized ||
                    effectiveTeamNormalized === teamFilterNormalized ||
                    effectiveTeamNormalized.includes(teamFilterNormalized) ||
                    teamFilterNormalized.includes(effectiveTeamNormalized);

                // 2. Logic cho Báo cáo (Reports) & Summary:
                // - Mọi người xem được các báo cáo nếu khớp bộ lọc team (đảm bảo tính minh bạch cho Hiệu suất)
                // - Luôn bao gồm bản thân để phục vụ tab "Cá nhân"
                const personPerm = permMap.get(nameKey);
                const isSelf = filters?.requesterEmail && personPerm?.email &&
                    personPerm.email.toLowerCase() === filters.requesterEmail.toLowerCase();

                let isAuthorizedForReport = isMatchForRanking || isSelf;

                // Nếu không khớp cả 2 thì bỏ qua record này
                if (!isMatchForRanking && !isAuthorizedForReport) {
                    return null;
                }

                // Parse checklist from answers JSON
                let checklist = {
                    fb: false, ig: false, caption: false, tiktok: false, youtube: false, lark: false,
                };

                let answersData = report?.answers;
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

                // Get high-fidelity KPI report data for this specific person today
                const reportKpi = (report?.email ? reportKpiMapByEmail.get(report.email.toLowerCase().trim()) : null) ||
                    reportKpiMapByName.get(nameKey);

                return {
                    id: kpi.id,
                    employee_id: trimmedEmpId,
                    personKey: personKey,
                    name: kpi.name,
                    position: position,
                    email: report?.email || reportKpi?.email || null,
                    team: effectiveTeam,
                    avatar: this.convertDriveUrl(employee?.image_url) || this.convertDriveUrl(this.rkReportAvatar(reportKpi)) || this.convertDriveUrl(kpi.link_image) || this.convertDriveUrl(kpi.image_url) || null,
                    tag: kpi.tag || kpi.name || null,
                    status: report ? 'ĐÚNG HẠN' : (reportKpi ? 'ĐÚNG HẠN' : 'CHƯA BÁO CÁO'),
                    date: report?.date || reportKpi?.report_date || null,
                    checklist,
                    answers: answersData,
                    videoCount: Number(answersData?.['Số video edit sử dụng >50% source từ quay?'] || 0),
                    dailyGoal: reportKpi?.kpi_day ?? (kpi.kpi_day || 0),
                    done: reportKpi ? Number(reportKpi.completed_day) : (kpi.completed_day || 0),
                    kpi_day: reportKpi?.kpi_day ?? (kpi.kpi_day || 0),
                    kpi_month: kpi.kpi_month || reportKpi?.kpi_month || 0,
                    completed_day: reportKpi ? Number(reportKpi.completed_day) : (kpi.completed_day || 0),
                    completed_month: reportKpi ? Number(reportKpi.completed_month) : (kpi.completed_month || 0),
                    // Traffic & Revenue for the selected range:
                    // Unified calculation: Latest MTD for Traffic & Revenue
                    traffic_range: (reportKpi ? Number(reportKpi.traffic_month || 0) : 0) + (answersData ? Number(answersData['Bạn đã đạt bao nhiêu traffic cho video mới?']) || 0 : 0),
                    revenue_range: (reportKpi ? Number(reportKpi.revenue_month || 0) : 0) + (answersData ? Number(answersData['Bạn đã đạt doanh thu của bao nhiêu video?']) || 0 : 0),
                    task_progress: reportKpi ? {
                        task_auto: reportKpi.task_auto || 0,
                        task_new: reportKpi.task_new || 0,
                        kpi_status: reportKpi.kpi_status || 'N/A'
                    } : null,
                    traffic_month: kpi.traffic_month ? Number(kpi.traffic_month) : 0,
                    revenue_month: kpi.revenue_month ? Number(kpi.revenue_month) : 0,
                    monthlyProgress: kpi.kpi_progress_month !== null ? Math.round(Number(kpi.kpi_progress_month) * 100) : ((kpi.kpi_month || 0) > 0 ? Math.round((kpi.completed_month || 0) / kpi.kpi_month * 100) : 0),
                    channelCount: huykChannelMap.get(nameKey) || 0,
                    isAuthorizedForReport,
                    isMatchForRanking
                };
            });

            // Filter out nulls
            const allValidResults = allResults.filter(r => r !== null) as any[];

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
                totalChannels: 0,
                totalReports: 0,
                reportedCount: 0
            };

            // Calculate summary aggregates from mapped results (which already handle summing for ranges)
            allValidResults.forEach(r => {
                // Skip resigned employees in totals (matching the previous logic)
                const employee = employeeMap.get(r.name?.toLowerCase().trim().replace(/\s+/g, ' ') || '') || (r.employee_id ? employeeMap.get(r.employee_id.trim()) : null);
                const empStatus = (employee?.status || '').toLowerCase().trim();
                const isResigned = empStatus.includes('nghỉ') || empStatus === 'da nghi';

                if (isResigned) return;
                if (!r.name || r.name.toLowerCase() === 'unknown') return;

                aggregates.totalVideoTarget += Number(r.dailyGoal || 0);
                aggregates.totalVideoCompleted += Number(r.done || 0);
                aggregates.totalTrafficCompleted += Number(r.traffic_range || 0);
                aggregates.totalRevenueCompleted += Number(r.revenue_range || 0);

                const nameKey = r.name?.toLowerCase().trim().replace(/\s+/g, ' ') || '';
                const kpi = kpiByName.get(nameKey);
                aggregates.totalTrafficTarget += parseInt(kpi?.target_traffic_month || '0') || 0;
                aggregates.totalRevenueTarget += parseInt(kpi?.target_revenue_month || '0') || 0;
            });

            // Count reports and channels for today separately, based on combinedResults
            combinedResults.forEach(r => {
                aggregates.totalReports++;
                if (r.date) aggregates.reportedCount++;
                aggregates.totalChannels += (r.channelCount || 0);
            });

            // Calculate rankings using rankingList (which honors team filter for everyone)

            const trafficRanking = rankingList
                .sort((a, b) => Number(b.traffic_month || 0) - Number(a.traffic_month || 0))
                .slice(0, 10)
                .map((kpi, index) => {
                    const nameKey = kpi.name?.toLowerCase().trim().replace(/\s+/g, ' ') || '';
                    const trimmedEmpId = kpi.employee_id?.trim();
                    const employee = employeeMap.get(nameKey) || (trimmedEmpId ? employeeMap.get(trimmedEmpId) : null);

                    return {
                        rank: index + 1,
                        name: kpi.name,
                        position: employee?.position || null,
                        avatar: this.convertDriveUrl(employee?.image_url) || this.convertDriveUrl(kpi.link_image) || this.convertDriveUrl(kpi.image_url) || null,
                        value: Number(kpi.traffic_month || 0).toLocaleString('vi-VN')
                    };
                });

            const revenueRanking = rankingList
                .sort((a, b) => Number(b.revenue_month || 0) - Number(a.revenue_month || 0))
                .slice(0, 10)
                .map((kpi, index) => {
                    const nameKey = kpi.name?.toLowerCase().trim().replace(/\s+/g, ' ') || '';
                    const trimmedEmpId = kpi.employee_id?.trim();
                    const employee = employeeMap.get(nameKey) || (trimmedEmpId ? employeeMap.get(trimmedEmpId) : null);

                    return {
                        rank: index + 1,
                        name: kpi.name,
                        position: employee?.position || null,
                        avatar: this.convertDriveUrl(employee?.image_url) || this.convertDriveUrl(kpi.link_image) || this.convertDriveUrl(kpi.image_url) || null,
                        value: Number(kpi.revenue_month || 0).toLocaleString('vi-VN')
                    };
                });

            // Calculate team-level contribution breakdown (Global Month Context)
            // Use kpiData which is already filtered by current selected month and year
            const allKpiForMonth = kpiData;

            // Map to unique people globally for correct aggregation
            const globalKpis = new Map();
            allKpiForMonth.forEach(k => {
                const key = k.employee_id?.trim() || k.name?.toLowerCase().trim().replace(/\s+/g, ' ') || '';
                if (!globalKpis.has(key) || (k.completed_month || 0) > (globalKpis.get(key).completed_month || 0)) {
                    globalKpis.set(key, k);
                }
            });

            const globalTotals = { videos: 0, traffic: 0, revenue: 0, videoTarget: 0, trafficTarget: 0, revenueTarget: 0 };
            const teamBreakdown = {};

            // Calculate breakdowns based on the same range-filtered results used in the summary
            allValidResults.forEach(r => {
                const team = r.team || 'Khác';
                if (!teamBreakdown[team]) {
                    teamBreakdown[team] = { videos: 0, traffic: 0, revenue: 0 };
                }
                const v = r.done || 0;
                const t = Number(r.traffic_range || 0);
                const re = Number(r.revenue_range || 0);

                globalTotals.videos += v;
                globalTotals.traffic += t;
                globalTotals.revenue += re;

                teamBreakdown[team].videos += v;
                teamBreakdown[team].traffic += t;
                teamBreakdown[team].revenue += re;
            });

            const teamContributions = Object.entries(teamBreakdown).map(([team, stats]: [string, any]) => ({
                team,
                videoPct: globalTotals.videos ? Math.round((stats.videos / globalTotals.videos) * 100) : 0,
                trafficPct: globalTotals.traffic ? Math.round((stats.traffic / globalTotals.traffic) * 100) : 0,
                revenuePct: globalTotals.revenue ? Math.round((stats.revenue / globalTotals.revenue) * 100) : 0
            })).sort((a, b) => b.videoPct - a.videoPct);

            // Calculate Group-level contributions (Global vs Việt Nam)
            const groupTotals = {
                global: { videos: 0, traffic: 0, revenue: 0 },
                vn: { videos: 0, traffic: 0, revenue: 0 }
            };

            const globalTeamNames = ['Global - JP1', 'Global - JP2', 'Global JP3', 'Global JP4', 'Global - Indo', 'Global Thái Lan', 'Global Đài Loan'];
            const vnTeamNames = ['Team K0', 'Team K1', 'Team K2', 'AFF 01', 'Team ADS', 'MEDIA CHUNG'];

            Object.entries(teamBreakdown).forEach(([team, stats]: [string, any]) => {
                const teamLower = team.toLowerCase();
                const isGlobal = teamLower.includes('global') ||
                    teamLower.includes('jp') ||
                    globalTeamNames.some(gt => gt.toLowerCase() === teamLower);

                if (isGlobal) {
                    groupTotals.global.videos += stats.videos;
                    groupTotals.global.traffic += stats.traffic;
                    groupTotals.global.revenue += stats.revenue;
                } else {
                    groupTotals.vn.videos += stats.videos;
                    groupTotals.vn.traffic += stats.traffic;
                    groupTotals.vn.revenue += stats.revenue;
                }
            });

            const groupContributions = {
                global: {
                    videos: groupTotals.global.videos,
                    traffic: groupTotals.global.traffic,
                    revenue: groupTotals.global.revenue,
                    videoPct: globalTotals.videos ? Math.round((groupTotals.global.videos / globalTotals.videos) * 100) : 0,
                    trafficPct: globalTotals.traffic ? Math.round((groupTotals.global.traffic / globalTotals.traffic) * 100) : 0,
                    revenuePct: globalTotals.revenue ? Math.round((groupTotals.global.revenue / globalTotals.revenue) * 100) : 0
                },
                vn: {
                    videos: groupTotals.vn.videos,
                    traffic: groupTotals.vn.traffic,
                    revenue: groupTotals.vn.revenue,
                    videoPct: globalTotals.videos ? Math.round((groupTotals.vn.videos / globalTotals.videos) * 100) : 0,
                    trafficPct: globalTotals.traffic ? Math.round((groupTotals.vn.traffic / globalTotals.traffic) * 100) : 0,
                    revenuePct: globalTotals.revenue ? Math.round((groupTotals.vn.revenue / globalTotals.revenue) * 100) : 0
                }
            };

            // Syncing is already handled by summing allValidResults directly into aggregates above.
            // Keeping globalTotals synced for groupContributions calculation below.

            // Fetch outstanding reports (Ideas, Difficulties, Wins)
            const reportOutstandings = await this.prisma.$queryRawUnsafe(`
                SELECT * FROM "report_outstanding"
                ORDER BY "date" DESC, "created_at" DESC
                LIMIT 200
            `);

            return {
                reports: combinedResults,
                summary: aggregates,
                teamContributions,
                groupContributions, // New field Added
                reportOutstandings,
                rankings: {
                    traffic: trafficRanking,
                    revenue: revenueRanking
                },
                userRole: requesterRole,
                userTeam: requesterTeam,
                meta: {
                    kpiTotalInDb: allKpiInDb.length,
                    kpiFilteredForMonth: kpiData.length,
                    kpiMonthFallback: kpiMonthFallback
                }
            };
        } catch (error) {
            this.logger.error('Failed to get user activity reports', error);
            throw error;
        }
    }

    private convertDriveUrl(url: string | null | undefined): string | null {
        if (!url) return null;
        if (url.includes('drive.google.com')) {
            const match = url.match(/\/d\/([^/]+)/);
            if (match && match[1]) {
                // Return proxy-compatible URL for frontend or direct uc link
                return `https://drive.google.com/uc?export=view&id=${match[1]}`;
            }
        }

        // Handle Lark media URLs to use our proxy
        if (url.includes('open.larksuite.com/open-apis/drive/v1/medias/')) {
            const tokenMatch = url.match(/medias\/([^/?]+)/);
            const extraMatch = url.match(/extra=([^&]+)/);
            if (tokenMatch && tokenMatch[1]) {
                const port = this.configService.get<string>('PORT') || '3000';
                const apiBase = this.configService.get<string>('API_BASE_URL') || `http://localhost:${port}/api`;
                let proxyUrl = `${apiBase}/lark/media/${tokenMatch[1]}`;
                if (extraMatch && extraMatch[1]) {
                    proxyUrl += `?extra=${extraMatch[1]}`;
                }
                return proxyUrl;
            }
        }

        return url;
    }

    async getMedia(mediaId: string, extra?: string): Promise<{ data: any; contentType: string }> {
        const token = await this.getAccessToken();
        let url = `https://open.larksuite.com/open-apis/drive/v1/medias/${mediaId}/download`;
        if (extra) {
            url += `?extra=${encodeURIComponent(extra)}`;
        }

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
                contentType: response.headers['content-type'] || 'image/png',
            };
        } catch (error) {
            this.logger.error(`Failed to fetch media ${mediaId} from Lark`, error);
            throw error;
        }
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

            for (const record of records) {
                const fields = record.fields;
                const dateNow = new Date();
                await this.prisma.$executeRawUnsafe(`
                    INSERT INTO "lark_permissions" ("id", "email", "name", "pin_code", "employee", "role", "team", "status", "permissions", "created_at", "updated_at")
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
                    ON CONFLICT ("id") DO UPDATE SET
                    "email" = EXCLUDED."email",
                    "name" = EXCLUDED."name",
                    "pin_code" = EXCLUDED."pin_code",
                    "employee" = EXCLUDED."employee",
                    "role" = EXCLUDED."role",
                    "team" = EXCLUDED."team",
                    "status" = EXCLUDED."status",
                    "permissions" = EXCLUDED."permissions",
                    "updated_at" = $10
                `, record.record_id, fields['Email'] || null, fields['HoTen'] || null, fields['MaPin'] || null,
                    fields['Nhân viên'] ? JSON.stringify(fields['Nhân viên']) : null,
                    fields['Role'] || null, fields['Team'] || null, fields['Trang Thai'] || null,
                    fields['Permissions'] ? JSON.stringify(fields['Permissions']) : null, dateNow);
            }

            this.logger.log('Lark Permission data sync completed.');
        } catch (error) {
            this.logger.error('Failed to sync Lark Permission data', error);
        }
    }

    async getPersonalHistory(requesterEmail: string, targetName?: string) {
        if (!requesterEmail) return { history: [], teamStats: null };

        try {
            // Find requester info
            const results = await this.prisma.$queryRawUnsafe<any[]>(
                'SELECT * FROM "lark_permissions" WHERE "email" ILIKE $1 LIMIT 1',
                requesterEmail
            );
            const requesterPermission = results.length > 0 ? results[0] : null;

            // Check User table if not in lark_permissions
            let sysUser = null;
            if (!requesterPermission) {
                sysUser = await this.prisma.user.findFirst({
                    where: { email: { equals: requesterEmail, mode: 'insensitive' } }
                });
            }

            const requesterRole = requesterPermission?.role?.toLowerCase() ||
                (sysUser?.roles && (sysUser.roles as any).length > 0 ? (sysUser.roles as any)[0].toLowerCase() : null) ||
                'member';
            const requesterTeam = requesterPermission?.team || sysUser?.team || null;

            let userName = requesterPermission?.name || sysUser?.full_name || null;

            // Try to extract name from employee field if name is null
            if (!userName && requesterPermission?.employee) {
                try {
                    const emp = typeof requesterPermission.employee === 'string'
                        ? JSON.parse(requesterPermission.employee)
                        : requesterPermission.employee;
                    if (Array.isArray(emp) && emp.length > 0) {
                        userName = emp[0].name || null;
                    }
                } catch (e) {
                    this.logger.error('Failed to parse employee field for name', e);
                }
            }

            if (userName === 'Unknown') userName = null;
            let userTeam = requesterPermission?.team || sysUser?.team || null;

            // If Admin/Manager has no team, pick first one from KPI to avoid 0s
            if (!userTeam && (requesterRole === 'admin' || requesterRole === 'manager')) {
                const firstKpi = await this.prisma.larkKPI.findFirst({
                    where: { team: { not: null } }
                });
                if (firstKpi) userTeam = firstKpi.team;
                if (!userName) userName = requesterEmail.split('@')[0];
            }

            // Fallback for unidentified users (try finding by email in reports)
            if (!userName) {
                const lastReport = await this.prisma.larkReport.findFirst({
                    where: { email: { equals: requesterEmail, mode: 'insensitive' } }
                });
                if (lastReport) {
                    userName = lastReport.name;
                    userTeam = lastReport.team;
                }
            }

            // If a specific name is requested, check authorization
            if (targetName && targetName.trim()) {
                // Find the target person
                const targetUser = await this.prisma.user.findFirst({
                    where: { full_name: { contains: targetName.trim(), mode: 'insensitive' } }
                });

                if (targetUser) {
                    // Check if employee is resigned
                    const targetEmployee = await this.prisma.larkEmployee.findFirst({
                        where: { name: { equals: targetUser.full_name, mode: 'insensitive' } }
                    });

                    if (targetEmployee) {
                        const empStatus = (targetEmployee.status || '').toLowerCase().trim();
                        if (empStatus === 'đã nghỉ' || empStatus === 'da nghi' || empStatus.includes('nghỉ')) {
                            this.logger.warn(`Access denied: ${targetName} has resigned.`);
                            return { history: [], teamStats: null };
                        }
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
            const allKpiInDb = await this.prisma.larkKPI.findMany();

            const getKpisForMonth = (mNum: number) => {
                const formats = [`T${mNum}`, `Tháng ${mNum}`, `tháng ${mNum}`, `${mNum}`, mNum < 10 ? `0${mNum}` : `${mNum}`];
                return allKpiInDb.filter(k => {
                    if (!k.month) return false;
                    if (k.state?.toLowerCase() === 'off') return false;
                    const m = k.month.trim();
                    if (formats.includes(m)) return true;
                    const mDigits = m.match(/\d+/g);
                    return mDigits ? mDigits.some(d => parseInt(d) === mNum) : false;
                });
            };

            let allTeamKpis = getKpisForMonth(targetMonthNum);

            // Fallback: If no KPIs for current month, find most recent month with data
            if (allTeamKpis.length === 0 && allKpiInDb.length > 0) {
                // Find latest month present in DB
                const sortedByDate = [...allKpiInDb].sort((a, b) => (b.created_at?.getTime() || 0) - (a.created_at?.getTime() || 0));
                const latestKpi = sortedByDate[0];
                const mDigits = latestKpi.month?.match(/\d+/);
                if (mDigits) {
                    targetMonthNum = parseInt(mDigits[0]);
                    allTeamKpis = getKpisForMonth(targetMonthNum);
                    this.logger.log(`No data for T${new Date().getMonth() + 1}, falling back to month ${targetMonthNum}`);
                }
            }

            const targetMonth = `T${targetMonthNum}`;
            const monthFormats = [`T${targetMonthNum}`, `Tháng ${targetMonthNum}`, `${targetMonthNum}`];


            const [todayReport, employee, userChannelCount] = await Promise.all([
                this.prisma.larkReport.findFirst({
                    where: {
                        name: { equals: userName.trim(), mode: 'insensitive' },
                        date: { gte: startOfToday, lte: endOfToday }
                    }
                }),
                this.prisma.larkEmployee.findFirst({
                    where: { name: { equals: userName.trim(), mode: 'insensitive' } }
                }),
                this.prisma.huykChannel.count({
                    where: { owner: { equals: userName.trim(), mode: 'insensitive' } }
                })
            ]);

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

                const companyChannelsCount = await this.prisma.huykChannel.count().catch(() => 0);

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
                    const teamChannelsCount = await this.prisma.huykChannel.count({
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

                if (requesterRole === 'admin' || requesterRole === 'manager') {
                    // See everyone
                } else if (requesterRole === 'leader' && requesterTeam) {
                    membersWhere.team = requesterTeam;
                } else {
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
            const fs = require('fs');
            fs.appendFileSync('lark-error.log', `[${new Date().toISOString()}] Error in getPersonalHistory for ${requesterEmail}: ${error.message}\n${error.stack}\n\n`);
            this.logger.error(`Error in getPersonalHistory for ${requesterEmail}: ${error.message}`, error.stack);
            throw error;
        }
    }

    private async fetchAllRecords(baseId: string, tableId: string) {
        const token = await this.getAccessToken();
        let allRecords = [];
        let hasMore = true;
        let pageToken = '';

        try {
            while (hasMore) {
                const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/records`;
                const response = await firstValueFrom(
                    this.httpService.get(url, {
                        headers: { Authorization: `Bearer ${token}` },
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
            this.logger.error(`Failed to fetch records from table ${tableId}`, error);
            throw error;
        }
    }
    async updateOutstandingStatus(id: string, status: string) {
        try {
            await this.prisma.$executeRawUnsafe(
                `UPDATE "report_outstanding" SET "status" = $1 WHERE "id" = $2`,
                status, id
            );
            return { success: true, message: 'Status updated successfully' };
        } catch (error) {
            this.logger.error(`Failed to update outstanding status for id ${id}`, error);
            throw error;
        }
    }

    async syncHRData() {
        return this.syncPermissionData();
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

        const trangThai = String(fields['Trang Thai'] || '').toLowerCase();
        const isActive = trangThai !== 'da nghi' && trangThai !== 'đã nghỉ' && trangThai !== 'nghi viec';

        return {
            email: fields['Email'],
            full_name: fields['HoTen'] || 'Unknown',
            role: fields['Role'] || 'MEMBER',
            team: fields['Team'] || 'None',
            is_active: isActive,
        };
    }

    mapToUserRoles(role: string, team: string): string[] {
        const roles: string[] = [];
        const r = (role || '').toUpperCase();
        const t = (team || '').toUpperCase();

        if (r.includes('ADMIN')) roles.push('ADMIN');
        if (r.includes('MANAGER')) roles.push('MANAGER');

        if (r.includes('LEAD') || r.includes('TRƯỞNG')) {
            if (t.includes('VIDEO')) roles.push('LEADER_VIDEO');
            else if (t.includes('CONTENT')) roles.push('LEADER_CONTENT');
            else roles.push('MANAGER'); // Fallback for general leaders
        } else {
            // Check team for basic roles
            if (t.includes('VIDEO')) roles.push('EDITOR');
            else if (t.includes('CONTENT')) roles.push('CONTENT');
            else roles.push('EDITOR'); // Default
        }

        // Deduplicate and ensure at least one role
        const result = Array.from(new Set(roles));
        if (result.length === 0) result.push('EDITOR');
        return result;
    }

    private rkReportAvatar(rk: any): string | null {
        if (!rk || !rk.image_url) return null;
        if (typeof rk.image_url === 'string') return rk.image_url;
        if (Array.isArray(rk.image_url) && rk.image_url.length > 0) {
            // Lark attachments often have a 'url' or 'attachment_id' or 'file_token'
            return rk.image_url[0].url || rk.image_url[0].file_token || null;
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
}