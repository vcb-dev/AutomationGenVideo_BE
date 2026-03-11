
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UserRole } from '@prisma/client';

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
    private readonly LIST_TASK_TABLE_ID: string;
    private readonly OUTSTANDING_TABLE_ID: string;

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
        this.LIST_TASK_TABLE_ID = this.configService.get<string>('LARK_LIST_TASK_TABLE_ID') || 'tblUubDhUoJ9TV7m';
        this.OUTSTANDING_TABLE_ID = this.configService.get<string>('LARK_OUTSTANDING_TABLE_ID') || 'tbluurIuf2qDCdFr';
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

    @Cron(CronExpression.EVERY_30_MINUTES)
    async handleCron() {
        this.logger.log('Starting scheduled Lark data sync (Reports, KPI, Employees)...');
        try {
            await Promise.all([
                this.syncReportData(),
                this.syncKPIData(),
                this.syncEmployeeData(),
                this.syncPermissionData(),
                this.syncChannelData(),
                this.syncListTaskData(),
                this.syncOutstandingData(),
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


                syncedCount++;
            }

            this.logger.log(`Successfully synced ${syncedCount} records.`);
        } catch (error) {
            this.logger.error('Failed to sync report data', error);
        }
    }

    async syncOutstandingData() {
        try {
            const baseId = this.REPORT_BASE_ID;
            const tableId = this.OUTSTANDING_TABLE_ID;

            this.logger.log(`Syncing Outstanding table: ${tableId} from base: ${baseId}`);
            const records = await this.fetchLarkRecordsGeneric(baseId, tableId);
            this.logger.log(`Fetched ${records.length} records from Outstanding table.`);

            const extractString = (val: any): string | null => {
                if (!val) return null;
                if (typeof val === 'string') return val;
                if (Array.isArray(val) && val.length > 0) {
                    const first = val[0];
                    return first.name || first.text || (typeof first === 'string' ? first : null);
                }
                return String(val);
            };

            for (const record of records) {
                const fields = record.fields;

                const findField = (names: string[]) => {
                    for (const name of names) {
                        if (fields[name] !== undefined) return fields[name];
                    }
                    return null;
                };

                const data = {
                    id: record.record_id,
                    name: extractString(findField(['HoTen', 'Họ Tên'])),
                    date: extractString(findField(['Ngày tháng', 'Ngày tháng'])),
                    team: extractString(findField(['Team'])),
                    role: extractString(findField(['Role', 'Chức danh'])),
                    email: extractString(findField(['Email'])),
                    category: extractString(findField(['Phân loại', 'Phân loại'])),
                    content: extractString(findField(['Nội dung', 'Nội dung'])),
                    status: extractString(findField(['Duyệt', 'Duyệt', 'Trang Thai', 'Trạng thái'])),
                    approved_by: extractString(findField(['Người duyệt', 'Người Duyệt'])),
                    approval_status: extractString(findField(['Duyệt', 'Duyệt'])),
                    employee: fields['Nhân viên'] ? fields['Nhân viên'] : null,
                    updated_at: new Date()
                };

                // Remove duplicate local unsynced record generated by python backend if it exists
                if (data.email && data.date && data.category) {
                    const matched = await (this.prisma as any).reportOutstanding.findFirst({
                        where: {
                            email: data.email,
                            date: data.date,
                            category: data.category,
                            id: { startsWith: 'out_' }
                        }
                    });
                    
                    if (matched) {
                        try {
                            await (this.prisma as any).reportOutstanding.delete({
                                where: { id: matched.id }
                            });
                        } catch (err) {
                            this.logger.warn(`Could not delete duplicate out_ record: ${matched.id}`);
                        }
                    }
                }

                await (this.prisma as any).reportOutstanding.upsert({
                    where: { id: data.id },
                    update: data,
                    create: {
                        ...data,
                        created_at: new Date()
                    }
                });
            }
            this.logger.log(`Synced ${records.length} outstanding records.`);
        } catch (error) {
            this.logger.error('Failed to sync outstanding data', error);
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

    async syncChannelData() {
        try {
            // This table tbljWdSiFVVWVqfp belongs to the REPORT_BASE_ID
            const baseId = this.configService.get<string>('LARK_REPORT_BASE_ID') || 'Q5Fmby8DVaKOyusfR8glgRB6gbf';
            const tableId = 'tbljWdSiFVVWVqfp';

            this.logger.log(`Syncing Channel table: ${tableId} from base: ${baseId}`);
            const records = await this.fetchLarkRecordsGeneric(baseId, tableId);
            this.logger.log(`Fetched ${records.length} records from Channel table. Syncing to Channel model...`);

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

                await this.prisma.channel.upsert({
                    where: { id: data.id },
                    update: data,
                    create: data,
                });
            }
            this.logger.log(`Successfully synced ${records.length} records to Channel.`);
        } catch (error) {
            this.logger.error('Failed to sync Channel data', error);
        }
    }

    async getChannelData() {
        return this.prisma.channel.findMany({
            orderBy: { created_at: 'desc' }
        });
    }

    async clearChannels() {
        return this.prisma.channel.deleteMany({});
    }

    async fetchLarkRecordsGeneric(baseId: string, tableId: string) {
        const token = await this.getAccessToken();
        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/records`;

        let allRecords = [];
        let pageToken = '';
        let hasMore = true;

        try {
            while (hasMore) {
                this.logger.debug(`Fetching: ${url} (Token: ${token.substring(0, 10)}...)`);
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

    // Fetch KPI records from Lark - Updated to use tblh9DeeqDBItrg7 as requested

    // Sync KPI data from Lark to database
    async syncKPIData() {
        try {
            const records = await this.fetchLarkRecordsGeneric(this.KPI_BASE_ID, this.KPI_TABLE_ID);
            this.logger.log(`Fetched ${records.length} KPI records from Lark (Table: ${this.KPI_TABLE_ID}). Clearing database and syncing...`);

            // Clear old data since we are switching table source
            await this.prisma.larkKPI.deleteMany({});

            let syncedCount = 0;
            const rawSamples = [];
            const allKeys = new Set<string>();

            const kpiRecordsToInsert: any[] = [];
            for (const record of records) {
                Object.keys(record.fields).forEach(k => allKeys.add(k));
                if (rawSamples.length < 3) rawSamples.push(record);

                const kpiData = this.mapRecordToKPI(record);

                // Skip garbage: No name or just whitespace/Unknown
                const cleanName = (kpiData.name || '').trim();
                if (!cleanName || cleanName.toLowerCase() === 'unknown') {
                    continue;
                }

                // Skip records that are useless (no name AND no team)
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
                await this.prisma.larkKPI.createMany({
                    data: kpiRecordsToInsert,
                    skipDuplicates: true, // Safety against Lark sending same record_id twice
                });
                syncedCount = kpiRecordsToInsert.length;
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
                reportDate = new Date(stringVal);
            }
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

    // Get combined user activity reports (LarkReport + LarkKPI)
    async getUserActivityReports(filters?: { date?: string; startDate?: string; endDate?: string; team?: string; requesterEmail?: string; timeType?: string }) {
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

                // FALLBACK: If not found in LarkPermission or team/role is missing, check System User table
                if (requesterRole === 'member' || !requesterTeam) {
                    const sysUser = await this.prisma.user.findFirst({
                        where: { email: { equals: filters.requesterEmail, mode: 'insensitive' } }
                    });
                    if (sysUser) {
                        // If System says Leader but Lark says Member/null, trust System
                        if (sysUser.roles.some(r => r === UserRole.MANAGER || r === UserRole.ADMIN || r === UserRole.MEMBER) && requesterRole === 'member') {
                            requesterRole = sysUser.roles.includes(UserRole.ADMIN) ? 'admin' :
                                sysUser.roles.includes(UserRole.MANAGER) ? 'manager' : 'member';
                        }
                        if (!requesterTeam && sysUser.team) {
                            requesterTeam = sysUser.team;
                        }
                    }
                }
            }

            // --- RESTRICTION LOGIC ---
            // If the requester is not an Admin or Manager, force them to see only their team's data
            const isInternalAdmin = requesterRole === 'admin' || requesterRole === 'manager';
            let enforcedTeam = null;

            if (!isInternalAdmin && requesterTeam) {
                enforcedTeam = requesterTeam;
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

            whereClause.OR = [
                {
                    date: {
                        gte: startOfDay,
                        lte: endOfDay,
                    }
                }
            ];

            if (filters?.requesterEmail) {
                whereClause.OR.push({
                    email: { equals: filters.requesterEmail, mode: 'insensitive' }
                });
            }

            let kpiMonthFallback = false;

            // 1. Identify all month/year pairs in the selected range
            const monthsInRange: { monthNum: number; year: number; formats: string[] }[] = [];
            {
                let curr = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);
                const endLimit = new Date(endOfDay.getFullYear(), endOfDay.getMonth(), 1);
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
                            `${m}`, m < 10 ? `0${m}` : `${m}`,
                            ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m],
                            ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m]
                        ].filter(Boolean)
                    });
                    curr.setMonth(curr.getMonth() + 1);
                }
            }

            // Fetch reports (unfiltered by team initially to allow cross-team detection)
            const reports = await this.prisma.larkReport.findMany({
                where: whereClause,
                orderBy: { date: 'desc' },
            });

            // Fetch all KPIs for the matching year/month if possible
            const allKpiInDb = await this.prisma.larkKPI.findMany();

            // Filter KPIs that match ANY month in range
            let kpiData = allKpiInDb.filter(k => {
                if (k.state?.toLowerCase() === 'off') return false;
                const mStr = (k.month || '').trim();

                // If no month set on record, check report_date
                if (!mStr) {
                    const rd = k.report_date ? new Date(k.report_date) : null;
                    return rd && monthsInRange.some(m => rd.getMonth() + 1 === m.monthNum && rd.getFullYear() === m.year);
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

            this.logger.log(`Filtered ${kpiData.length} KPIs for range [${startOfDay.toISOString()} - ${endOfDay.toISOString()}]. Months covered: ${monthsInRange.length}`);

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

            // Fetch all Channels to count per user
            const allChannelsInDb = await this.prisma.channel.findMany({
                where: { status: 'Đang hoạt động' }
            });

            const channelMap = new Map();
            const regionalChannelCounts = { vn: 0, global: 0 };

            const getRegionInternal = (teamName: string) => {
                const t = (teamName || '').toLowerCase();
                if (t.includes('global') || t.includes('thái lan') || t.includes('đài loan') || t.includes('indo') || t.includes('jp')) return 'global';
                return 'vn';
            };

            allChannelsInDb.forEach(h => {
                if (h.owner) {
                    const ownerKey = h.owner.toLowerCase().trim().replace(/\s+/g, ' ');
                    channelMap.set(ownerKey, (channelMap.get(ownerKey) || 0) + 1);
                }

                const region = getRegionInternal(h.team_traffic || '');
                regionalChannelCounts[region]++;
            });

            const dailyReportKpis = await (this.prisma as any).larkReportKPI.findMany({
                where: {
                    report_date: {
                        gte: startOfDay,
                        lte: endOfDay,
                    }
                }
            });

            // --- FIX: Fetch records for the ENTIRE month range to ensure Summary cards stay monthly ---
            const monthRangeStart = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1, 0, 0, 0, 0);
            const monthRangeEnd = new Date(endOfDay.getFullYear(), endOfDay.getMonth() + 1, 0, 23, 59, 59, 999);

            const monthlyReportKpis = await (this.prisma as any).larkReportKPI.findMany({
                where: {
                    report_date: {
                        gte: monthRangeStart,
                        lte: monthRangeEnd,
                    }
                }
            });

            const reportKpiMapByEmail = new Map();
            const reportKpiMapByName = new Map();
            const monthlyKpiMapByEmail = new Map();
            const monthlyKpiMapByName = new Map();

            // Daily map (for report status on specific day)
            dailyReportKpis.forEach(rk => {
                const date = new Date(rk.report_date || (rk as any).date);
                const timeKey = `${date.getMonth() + 1}_${date.getFullYear()}`;
                const emailKey = rk.email?.toLowerCase().trim();
                const nameKey = rk.name ? rk.name.toLowerCase().trim().replace(/\s+/g, ' ') : null;

                if (emailKey) reportKpiMapByEmail.set(`${emailKey}_${timeKey}`, rk);
                if (nameKey) reportKpiMapByName.set(`${nameKey}_${timeKey}`, rk);
            });

            // Monthly map (latest in month for Summary)
            monthlyReportKpis.forEach(rk => {
                const date = new Date(rk.report_date || (rk as any).date);
                const timeKey = `${date.getMonth() + 1}_${date.getFullYear()}`;
                const emailKey = rk.email?.toLowerCase().trim();
                const nameKey = rk.name ? rk.name.toLowerCase().trim().replace(/\s+/g, ' ') : null;

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

            // Create maps for quick KPI lookup
            const kpiByNameTeam = new Map();
            const kpiByName = new Map();

            // Store unique KPI per person-month for aggregation
            const kpisForAggregation = new Map();
            const nameToPersonKey = new Map();

            kpiData.forEach(kpi => {
                const nameKey = kpi.name ? kpi.name.toLowerCase().trim().replace(/\s+/g, ' ') : null;
                const teamKey = kpi.team?.toLowerCase().trim() || '';
                const trimmedEmpId = kpi.employee_id?.trim();

                // Determine the month/year for this KPI record to key it uniquely within a range
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

                const personKey = trimmedEmpId || nameKey || kpi.id;
                const personMonthKey = `${personKey}_${kpiMonth}_${kpiYear}`;

                if (nameKey) {
                    nameToPersonKey.set(nameKey, personKey);
                    if (teamKey) {
                        kpiByNameTeam.set(`${nameKey}_${teamKey}`, kpi);
                    }
                    if (!kpiByName.has(nameKey) || kpi.link_image || kpi.image_url) {
                        kpiByName.set(nameKey, kpi);
                    }
                }

                if (!kpisForAggregation.has(personMonthKey) || (kpi.completed_month || 0) > (kpisForAggregation.get(personMonthKey).completed_month || 0)) {
                    kpisForAggregation.set(personMonthKey, kpi);
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
                            const videoKeyNew = Object.keys(rAns).find(k => k.toLowerCase().includes('50%'));
                            const videoKeyOld = Object.keys(eAns).find(k => k.toLowerCase().includes('50%')) || videoKeyNew;
                            if (videoKeyNew) {
                                // Sum up numeric values
                                const currentTotal = Number(eAns[videoKeyOld]) || 0;
                                const newVal = Number(rAns[videoKeyNew]) || 0;
                                eAns[videoKeyOld] = currentTotal + newVal;
                            }
                        }
                    } else {
                        // Clone to avoid mutation of findMany result
                        reportsMap.set(nameKey, { ...r });
                    }

                    const personKey = nameToPersonKey.get(nameKey) || nameKey;
                    const reportMonthNum = (r.date ? new Date(r.date) : new Date()).getMonth() + 1;
                    const reportYear = (r.date ? new Date(r.date) : new Date()).getFullYear();
                    const personMonthKey = `${personKey}_${reportMonthNum}_${reportYear}`;

                    if (!kpisForAggregation.has(personMonthKey)) {
                        kpisForAggregation.set(personMonthKey, {
                            id: `report_${r.id}`,
                            employee_id: personKey !== nameKey ? personKey : null,
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

                const personPerm = permMap.get(nameKey);
                const isSelf = filters?.requesterEmail && personPerm?.email &&
                    personPerm.email.toLowerCase() === filters.requesterEmail.toLowerCase();

                // 2. Logic cho Báo cáo (Reports) & Summary:
                // - Admin/Manager xem được tất cả theo bộ lọc
                // - Member/Leader chỉ xem được báo cáo của Team mình (kể cả khi đang ở BXH "All")
                let isAuthorizedForReport = false;
                if (isInternalAdmin) {
                    isAuthorizedForReport = isMatchForRanking || isSelf;
                } else {
                    const myTeam = requesterTeam?.toLowerCase().trim();
                    isAuthorizedForReport = (myTeam && effectiveTeamNormalized === myTeam) || isSelf;
                }

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
                const timeKey = `${kpiMonth}_${kpiYear}`;

                // Get high-fidelity KPI report data for this specific person and month
                const rKpiEmailKey = report?.email ? `${report.email.toLowerCase().trim()}_${timeKey}` : null;
                const rKpiNameKey = `${nameKey}_${timeKey}`;

                const reportKpi = (rKpiEmailKey ? reportKpiMapByEmail.get(rKpiEmailKey) : null) ||
                    reportKpiMapByName.get(rKpiNameKey);

                // --- FIX: Lookup monthly stable KPI for Summary Cards ---
                const monthlyReportKpi = (rKpiEmailKey ? monthlyKpiMapByEmail.get(rKpiEmailKey) : null) ||
                    monthlyKpiMapByName.get(rKpiNameKey);

                const isCurrentMonth = matchedMonth.monthNum === (new Date().getMonth() + 1) && matchedMonth.year === new Date().getFullYear();
                const incrementalTraffic = isCurrentMonth && answersData ? Number(answersData['Bạn đã đạt bao nhiêu traffic cho video mới?']) || 0 : 0;
                const incrementalRevenue = isCurrentMonth && answersData ? Number(answersData['Bạn đã đạt doanh thu của bao nhiêu video?']) || 0 : 0;

                return {
                    id: kpi.id,
                    employee_id: trimmedEmpId,
                    personKey: personKey,
                    name: kpi.name,
                    position: position,
                    role: personPerm?.role || null,
                    email: report?.email || reportKpi?.email || null,
                    team: effectiveTeam,
                    avatar: this.convertDriveUrl(employee?.image_url) || this.convertDriveUrl(this.rkReportAvatar(reportKpi)) || this.convertDriveUrl(kpi.link_image) || this.convertDriveUrl(kpi.image_url) || null,
                    tag: kpi.tag || kpi.name || null,
                    status: report ? 'ĐÚNG HẠN' : (reportKpi ? 'ĐÚNG HẠN' : 'CHƯA BÁO CÁO'),
                    date: report?.date || reportKpi?.report_date || null,
                    checklist,
                    answers: answersData,
                    videoCount: answersData ? Number(answersData[Object.keys(answersData).find(k => k.toLowerCase().includes('50%')) || ''] || 0) : 0,
                    dailyGoal: reportKpi?.kpi_day ?? (kpi.kpi_day || 0),
                    done: reportKpi ? Number(reportKpi.completed_day) : (kpi.completed_day || 0),
                    kpi_day: reportKpi?.kpi_day ?? (kpi.kpi_day || 0),
                    kpi_month: kpi.kpi_month || monthlyReportKpi?.kpi_month || 0,
                    completed_day: reportKpi ? Number(reportKpi.completed_day) : (kpi.completed_day || 0),
                    completed_month: monthlyReportKpi ? Number(monthlyReportKpi.completed_month) : (kpi.completed_month || 0),
                    // Stable monthly traffic/revenue for the Summary Cards:
                    traffic_range: (monthlyReportKpi ? Number(monthlyReportKpi.traffic_month || 0) : Number(kpi.traffic_month || 0)) + incrementalTraffic,
                    revenue_range: (monthlyReportKpi ? Number(monthlyReportKpi.revenue_month || 0) : Number(kpi.revenue_month || 0)) + incrementalRevenue,
                    task_progress: reportKpi ? {
                        task_auto: reportKpi.task_auto || 0,
                        task_new: reportKpi.task_new || 0,
                        kpi_status: reportKpi.kpi_status || 'N/A'
                    } : {
                        task_auto: kpi.task_auto || 0,
                        task_new: kpi.task_new || 0,
                        kpi_status: kpi.kpii_status || 'N/A'
                    },
                    traffic_month: Math.max(Number(monthlyReportKpi?.traffic_month || 0), Number(kpi.traffic_month || 0)),
                    revenue_month: Math.max(Number(monthlyReportKpi?.revenue_month || 0), Number(kpi.revenue_month || 0)),
                    trafficTarget: parseInt(kpi.target_traffic_month || '0') || 0,
                    revenueTarget: parseInt(kpi.target_revenue_month || '0') || 0,
                    monthlyProgress: kpi.kpi_progress_month !== null ? Math.round(Number(kpi.kpi_progress_month) * 100) : ((kpi.kpi_month || 0) > 0 ? Math.round((kpi.completed_month || 0) / kpi.kpi_month * 100) : 0),
                    channelCount: channelMap.get(nameKey) || 0,
                    isAuthorizedForReport,
                    isMatchForRanking
                };
            });

            // --- NEW: Group by Person to aggregate stats across months if viewing range ---
            const groupedResults = new Map();
            allResults.filter(r => r !== null).forEach(r => {
                // Use a normalized name as primary key to prevent duplicate cards for the same person
                const key = r.name?.toLowerCase().trim().replace(/\s+/g, ' ') || r.employee_id || r.personKey;

                if (!groupedResults.has(key)) {
                    groupedResults.set(key, { ...r });
                } else {
                    const existing = groupedResults.get(key);
                    // Sum numeric metrics
                    existing.done += r.done;
                    existing.videoCount += r.videoCount;
                    existing.kpi_day += r.kpi_day;
                    existing.kpi_month += r.kpi_month;
                    existing.completed_day += r.completed_day;
                    existing.completed_month += r.completed_month;
                    existing.traffic_range += r.traffic_range;
                    existing.revenue_range += r.revenue_range;
                    existing.traffic_month += r.traffic_month;
                    existing.revenue_month += r.revenue_month;
                    existing.trafficTarget += r.trafficTarget;
                    existing.revenueTarget += r.revenueTarget;
                    existing.channelCount = Math.max(existing.channelCount, r.channelCount);
                    // Keep metadata from latest record (assuming allResults is somewhat chronological or month-indexed)
                    if (r.date && (!existing.date || new Date(r.date) > new Date(existing.date))) {
                        existing.date = r.date;
                        existing.status = r.status;
                        existing.avatar = r.avatar || existing.avatar;
                    }
                }
            });

            const allValidResults = Array.from(groupedResults.values());

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
                totalChannels: regionalChannelCounts.vn + regionalChannelCounts.global,
                totalReports: 0,
                reportedCount: 0
            };

            // Calculate summary aggregates from mapped results (which already handle summing for ranges)
            allValidResults.forEach(r => {
                const employee = employeeMap.get(r.name?.toLowerCase().trim().replace(/\s+/g, ' ') || '') || (r.employee_id ? employeeMap.get(r.employee_id.trim()) : null);
                const empStatus = (employee?.status || '').toLowerCase().trim();
                const isResigned = empStatus.includes('nghỉ') || empStatus === 'da nghi';

                if (isResigned) return;
                if (!r.name || r.name.toLowerCase() === 'unknown') return;

                // Use Monthly stats for the BIG KPI cards to show MTD progress as requested
                aggregates.totalVideoTarget += Number(r.kpi_month || 0);
                aggregates.totalVideoCompleted += Number(r.completed_month || 0);
                aggregates.totalTrafficCompleted += Number(r.traffic_range || 0);
                aggregates.totalRevenueCompleted += Number(r.revenue_range || 0);
                aggregates.totalTrafficTarget += Number(r.trafficTarget || 0);
                aggregates.totalRevenueTarget += Number(r.revenueTarget || 0);

                // --- Channels are already counted globally from Channel table for the summary ---
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
                    const nameKey = kpi.name?.toLowerCase().trim().replace(/\s+/g, ' ') || '';
                    const trimmedEmpId = kpi.employee_id?.trim();
                    const employee = employeeMap.get(nameKey) || (trimmedEmpId ? employeeMap.get(trimmedEmpId) : null);

                    return {
                        rank: index + 1,
                        name: kpi.name,
                        position: employee?.position || null,
                        avatar: this.convertDriveUrl(employee?.image_url) || this.convertDriveUrl(kpi.link_image) || this.convertDriveUrl(kpi.image_url) || null,
                        value: Number(kpi.traffic_range || 0).toLocaleString('vi-VN')
                    };
                });

            const revenueRanking = rankingList
                .sort((a, b) => Number(b.revenue_range || 0) - Number(a.revenue_range || 0))
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
                        value: Number(kpi.revenue_range || 0).toLocaleString('vi-VN')
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

            const globalTotals = { videos: 0, traffic: 0, revenue: 0, channels: 0, videoTarget: 0, trafficTarget: 0, revenueTarget: 0 };
            const teamBreakdown = {};

            // Calculate breakdowns based on the same range-filtered results used in the summary
            allValidResults.forEach(r => {
                const v = Number(r.completed_month || 0);
                const t = Number(r.traffic_range || 0);
                const re = Number(r.revenue_range || 0);
                const c = r.channelCount || 0;

                globalTotals.videos += v;
                globalTotals.traffic += t;
                globalTotals.revenue += re;
                // globalTotals.channels is already set from Channel table direct count internally below

                const team = r.team || 'Khác';
                if (!teamBreakdown[team]) {
                    teamBreakdown[team] = { videos: 0, traffic: 0, revenue: 0, channels: 0 };
                }
                teamBreakdown[team].videos += v;
                teamBreakdown[team].traffic += t;
                teamBreakdown[team].revenue += re;
                teamBreakdown[team].channels += c;
            });

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

            // Fetch outstanding reports (Ideas, Difficulties, Wins) excluding placeholders
            const reportOutstandings = await this.prisma.$queryRawUnsafe(`
                SELECT * FROM "report_outstanding"
                WHERE "content" NOT ILIKE '%không có%' 
                  AND "content" NOT ILIKE '%khong co%' 
                  AND "content" IS NOT NULL 
                  AND "content" != '' 
                  AND "content" != '-'
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
                
                // Field name mapping with fallbacks
                const email = fields['Email'] || null;
                const name = fields['Họ Tên'] || fields['HoTen'] || fields['Name'] || null;
                const maPin = fields['Mã Pin'] || fields['MaPin'] || fields['Mã pin'] || null;
                const employee = fields['Nhân viên'] || fields['Nhan vien'] ? JSON.stringify(fields['Nhân viên'] || fields['Nhan vien']) : null;
                const role = fields['Role'] || fields['Chức vụ'] || null;
                const team = fields['Team'] || fields['Phòng ban'] || null;
                const status = fields['Trạng thái'] || fields['Trang Thai'] || fields['Status'] || null;
                const permissions = fields['Permissions'] || fields['Quyền'] ? JSON.stringify(fields['Permissions'] || fields['Quyền']) : null;
                
                await this.prisma.$executeRawUnsafe(`
                    INSERT INTO "lark_permissions" ("id", "email", "name", "pin_code", "employee", "role", "team", "status", "permissions", "created_at", "updated_at")
                    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10, $10)
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
                `, record.record_id, email, name, maPin, employee, role, team, status, permissions, dateNow);
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
                this.prisma.channel.count({
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

        // ── 1. lark_reports (REPORT_BASE_ID / REPORT_TABLE_ID) ──────────────────
        try {
            const filter = oldEmail
                ? `CurrentValue.[Email] = "${oldEmail}"`
                : `CurrentValue.[Họ và Tên] = "${oldName}"`;
            const records = await this.searchLarkRecords(this.REPORT_BASE_ID, this.REPORT_TABLE_ID, filter);
            const updates: Record<string, string> = {};
            if (nameChanged) updates['Họ và Tên'] = newName;
            if (teamChanged) updates['Team'] = newTeam;
            if (emailChanged) updates['Email'] = newEmail;
            await batchUpdate(this.REPORT_BASE_ID, this.REPORT_TABLE_ID, buildBatchPayload(records, updates));
            this.logger.log(`[LarkSync] lark_reports: updated ${records.length} records`);
        } catch (e) { this.logger.warn(`[LarkSync] lark_reports sync failed: ${e.message}`); }

        // ── 2. report_outstanding (REPORT_BASE_ID / OUTSTANDING_TABLE_ID) ───────
        try {
            const filter = oldEmail
                ? `CurrentValue.[Email] = "${oldEmail}"`
                : `CurrentValue.[Họ và Tên] = "${oldName}"`;
            const records = await this.searchLarkRecords(this.REPORT_BASE_ID, this.OUTSTANDING_TABLE_ID, filter);
            const updates: Record<string, string> = {};
            if (nameChanged) updates['Họ và Tên'] = newName;
            if (teamChanged) updates['Team'] = newTeam;
            if (emailChanged) updates['Email'] = newEmail;
            await batchUpdate(this.REPORT_BASE_ID, this.OUTSTANDING_TABLE_ID, buildBatchPayload(records, updates));
            this.logger.log(`[LarkSync] outstanding: updated ${records.length} records`);
        } catch (e) { this.logger.warn(`[LarkSync] outstanding sync failed: ${e.message}`); }

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

            // Sync to Lark Suite if it's not a local record
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

            return { success: true, message: 'Status updated successfully and synced to Lark' };
        } catch (error) {
            this.logger.error(`Failed to update outstanding status for id ${id}`, error);
            throw error;
        }
    }

    async pushAllOutstandingData() {
        try {
            const outstandings = await (this.prisma as any).reportOutstanding.findMany();
            this.logger.log(`Pushing ${outstandings.length} outstanding records to Lark Suite...`);

            const fieldMap = await this.getOutstandingFieldMap();
            let pushedCount = 0;
            const skippedIds = [];
            const failedItems = [];

            for (const item of outstandings) {
                // Only push if it has a valid Lark record ID
                if (item.id && !item.id.startsWith('out_')) {
                    const fields: any = {};
                    fields[fieldMap.approval_status] = item.approval_status || 'Chưa Duyệt';
                    fields[fieldMap.status] = item.status || 'Chưa Duyệt';
                    if (item.approved_by) {
                        fields[fieldMap.approved_by] = item.approved_by;
                    }

                    try {
                        await this.updateBitableRecord(
                            this.REPORT_BASE_ID,
                            this.OUTSTANDING_TABLE_ID,
                            item.id,
                            fields
                        );
                        pushedCount++;
                    } catch (err) {
                        failedItems.push({ id: item.id, error: err.message });
                    }
                } else {
                    skippedIds.push(item.id);
                }
            }

            return {
                success: true,
                pushedCount,
                total: outstandings.length,
                skippedCount: skippedIds.length,
                failedCount: failedItems.length
            };
        } catch (error) {
            this.logger.error('Failed to push all outstanding data to Lark', error);
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

        if (r.includes('ADMIN')) {
            roles.push('ADMIN');
        } else if (r.includes('MANAGER')) {
            roles.push('MANAGER');
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
            team: extractString(fields['Team']),
            tiktok_post: extractString(fields['Tiktok Post']),
            status: fields['Trạng Thái'] || null,
            content_type: fields['Tuyến Nội Dung'] || null,
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

            let syncedCount = 0;
            for (const record of records) {
                const data = this.mapRecordToListTask(record);
                await this.prisma.larkListTask.upsert({
                    where: { id: data.id },
                    update: data,
                    create: data,
                });
                syncedCount++;
            }

            this.logger.log(`Successfully synced ${syncedCount} ListTask records.`);
            return { synced: syncedCount, total: records.length };
        } catch (error) {
            this.logger.error('Failed to sync ListTask data', error);
            throw error;
        }
    }

    async getListTaskData() {
        return this.prisma.larkListTask.findMany({
            orderBy: { date: 'desc' }
        });
    }

    async getDashboardAnalytics(filters?: { startDate?: string; endDate?: string; team?: string }) {
        const start = filters?.startDate ? new Date(filters.startDate) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const end = filters?.endDate ? new Date(filters.endDate) : new Date();
        const teamFilter = filters?.team === 'All' || !filters?.team ? null : filters?.team.toLowerCase().trim();

        // 1. Identify target months for KPI matching
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
                    ...(teamFilter ? { team: { contains: teamFilter, mode: 'insensitive' } } : {})
                },
                select: { id: true, content_type: true, employee_id: true, employee_name: true, employee_email: true, team: true }
            }),
            this.prisma.larkKPI.findMany({
                orderBy: { report_date: 'desc' }
            }),
            this.prisma.user.findMany({
                select: {
                    email: true,
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

        // Helper maps
        const userMapByEmail = new Map<string, typeof usersWithChannels[0]>();
        usersWithChannels.forEach(u => userMapByEmail.set(u.email.toLowerCase(), u));

        // Maps channels by owner
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
                existing.videoCount = Math.max(existing.videoCount, videosVal);
                existing.traffic = Math.max(existing.traffic, trafficVal);
                existing.revenue = Math.max(existing.revenue, revenueVal);
            } else {
                const user = email ? userMapByEmail.get(email) : null;
                empStats.set(key, {
                    name: kpi.name || 'Unknown',
                    email: email || '',
                    empId: kpi.employee_id || 'unknown',
                    team: teamName,
                    videoCount: videosVal,
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
            } else {
                // If person not in KPI, we can still show them if they have tasks, but user says "based on KPI"
                // For completeness/visual parity with chart, we add them if they have tasks
                const user = email ? userMapByEmail.get(email) : null;
                empStats.set(key, {
                    name: task.employee_name || 'Unknown',
                    email: email,
                    empId: task.employee_id || 'unknown',
                    team: task.team || 'Khác',
                    videoCount: 0, // Will be updated by tasks if we want, but user said "based on KPI"
                    lineCounts: { [task.content_type || 'Khác']: 1 },
                    traffic: 0,
                    revenue: 0,
                    channels: channelsByOwnerMap.get(nameKey) || user?._count.tracked_channels || 0,
                    isLeader: user?.roles.includes(UserRole.MANAGER) || user?.roles.includes(UserRole.ADMIN) || false
                });
                // If we want task row count as fallback:
                empStats.get(key)!.videoCount = 1;
            }
            // For existing ones, if they have tasks, it adds to breakdown but doesn't change their KPI 'videoCount'
        });

        // 3. Chart Data (Aggregate by Line)
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

        const totalVideosInRange = tasks.length;

        return {
            chartData,
            summary: {
                totalVideos: totalVideosInRange,
                prevVideos: prevTasksCount,
                totalTraffic: Math.round(Array.from(empStats.values()).reduce((a, b) => a + b.traffic, 0)),
                totalRevenue: Math.round(Array.from(empStats.values()).reduce((a, b) => a + b.revenue, 0))
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