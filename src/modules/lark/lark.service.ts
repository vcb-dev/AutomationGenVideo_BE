
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

    private readonly BASE_ID = 'Q5Fmby8DVaKOyusfR8glgRB6gbf';
    private readonly TABLE_ID = 'tblte3XJWcPvHhxW';
    private readonly APP_ID: string;
    private readonly APP_SECRET: string;

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
        private readonly prisma: PrismaService,
    ) {
        this.APP_ID = this.configService.get<string>('LARK_APP_ID');
        this.APP_SECRET = this.configService.get<string>('LARK_APP_SECRET');
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

    // Cron job runs every 30 minutes
    @Cron(CronExpression.EVERY_30_MINUTES)
    async handleCron() {
        this.logger.log('Starting scheduled Lark data sync (Reports, KPI, Employees)...');
        try {
            await Promise.all([
                this.syncReportData(),
                this.syncKPIData(),
                this.syncEmployeeData(),
            ]);
            this.logger.log('Scheduled Lark data sync completed successfully.');
        } catch (error) {
            this.logger.error('Scheduled Lark data sync failed', error);
        }
    }

    async syncReportData() {
        try {
            const records = await this.fetchLarkRecords();
            this.logger.log(`Fetched ${records.length} records from Lark. Syncing to database...`);

            if (records.length > 0) {
                this.logger.debug('First record fields keys:', Object.keys(records[0].fields));
                this.logger.debug('First record fields:', JSON.stringify(records[0].fields, null, 2));
            }

            let syncedCount = 0;
            for (const record of records) {
                const reportData = this.mapRecordToReport(record);

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

    async fetchLarkRecords() {
        const token = await this.getAccessToken();
        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${this.BASE_ID}/tables/${this.TABLE_ID}/records`;

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

    // Clear all larkReport data
    async clearAllReports() {
        this.logger.log('Clearing all larkReport data...');
        const result = await this.prisma.larkReport.deleteMany({});
        this.logger.log(`Deleted ${result.count} records from larkReport`);
        return result;
    }

    async listTables() {
        const KPI_BASE_ID = 'XJQWbUmkWaJcW8sShyIlLXaTgvb';
        const token = await this.getAccessToken();
        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${KPI_BASE_ID}/tables`;

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
            name: fields['HoTen'] || 'Unknown',
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
            const EMPLOYEE_BASE_ID = 'XJQWbUmkWaJcW8sShyIlLXaTgvb';
            const EMPLOYEE_TABLE_ID = 'tblOHji4TJMlY11b';

            const token = await this.getAccessToken();
            const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${EMPLOYEE_BASE_ID}/tables/${EMPLOYEE_TABLE_ID}/records`;

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
            const KPI_BASE_ID = 'XJQWbUmkWaJcW8sShyIlLXaTgvb';
            const KPI_TABLE_ID = 'tblmjwNLtw8hAWns';

            const token = await this.getAccessToken();
            const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${KPI_BASE_ID}/tables/${KPI_TABLE_ID}/records`;

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
        const EMPLOYEE_BASE_ID = 'XJQWbUmkWaJcW8sShyIlLXaTgvb';
        const EMPLOYEE_TABLE_ID = 'tblOHji4TJMlY11b';

        const token = await this.getAccessToken();
        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${EMPLOYEE_BASE_ID}/tables/${EMPLOYEE_TABLE_ID}/records`;

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
            name: fields['Tên'] || 'Unknown',
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
            orderBy: { created_at: 'desc' }
        });
    }

    // Fetch KPI records from Lark
    async fetchKPIRecords() {
        const KPI_BASE_ID = 'XJQWbUmkWaJcW8sShyIlLXaTgvb';
        const KPI_TABLE_ID = 'tblmjwNLtw8hAWns';

        const token = await this.getAccessToken();
        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${KPI_BASE_ID}/tables/${KPI_TABLE_ID}/records`;

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
                            text_field_as_key: false,
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
        let name = null;
        const ten = findValue(['Tên', 'Ten']);
        if (Array.isArray(ten) && ten.length > 0) {
            name = ten[0].text || null;
        } else if (typeof ten === 'string') {
            name = ten;
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
            kpi_day: findValue(['KPI Ngày', 'KPI Ngay']) || null,
            kpi_month: findValue(['KPI THÁNG', 'KPI THANG']) || null,
            kpii_status: findValue(['KPII']) || null,
            kpi_day_percent: kpiDayPercent,
            completed_day: findValue(['Hoàn thành', 'Hoan thanh']) || null,
            completed_month: findValue(['Hoàn thành Tháng', 'Hoan thanh Thang']) || null,
            task_new: findValue(['Task mới', 'Task moi']) || null,
            task_new_month: findValue(['Task mới tháng', 'Task moi thang']) || null,
            task_auto: taskAutoVal,
            task_auto_month: findValue(['Task Auto Tháng', 'Task Auto Thang']) || null,
            task_creative: taskCreative,
            content_win_new: findValue(['Content win mới', 'Content win moi']) || null,
            revenue_month: findValue(['Doanh thu tháng', 'Doanh thu thang']) ? BigInt(findValue(['Doanh thu tháng', 'Doanh thu thang'])) : null,
            traffic_month: findValue(['Traffic Tháng', 'Traffic Thang']) ? BigInt(findValue(['Traffic Tháng', 'Traffic Thang'])) : null,
            target_revenue_month: findValue(['Mục tiêu doanh thu tháng', 'Muc tieu doanh thu thang']) || null,
            target_traffic_month: findValue(['Mục tiêu Traffic tháng', 'Muc tieu Traffic thang']) || null,
            kpi_progress_month: findValue(['Tiến độ KPI tháng', 'Tien do KPI thang']) || null,
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
    async getUserActivityReports(filters?: { date?: string; team?: string }) {
        try {
            // Fetch reports with optional filters
            const whereClause: any = {};

            if (filters?.date) {
                const targetDate = new Date(filters.date);
                const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
                const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

                whereClause.date = {
                    gte: startOfDay,
                    lte: endOfDay,
                };
            }

            if (filters?.team) {
                whereClause.team = filters.team;
            }

            // Fetch reports
            const reports = await this.prisma.larkReport.findMany({
                where: whereClause,
                orderBy: { date: 'desc' },
            });

            // Fetch all KPI data to match avatars
            const kpiData = await this.prisma.larkKPI.findMany();

            // Create maps for quick KPI lookup
            const kpiByNameTeam = new Map();
            const kpiByName = new Map();

            kpiData.forEach(kpi => {
                if (kpi.name) {
                    const nameKey = kpi.name.toLowerCase().trim().replace(/\s+/g, ' ');
                    const teamKey = kpi.team?.toLowerCase().trim() || '';

                    if (teamKey) {
                        kpiByNameTeam.set(`${nameKey}_${teamKey}`, kpi);
                    }

                    // Also store by name as secondary (prefer records with image)
                    if (!kpiByName.has(nameKey) || kpi.link_image || kpi.image_url) {
                        kpiByName.set(nameKey, kpi);
                    }
                }
            });

            // Combine data
            const combinedReports = reports.map(report => {
                const nameKey = report.name?.toLowerCase().trim().replace(/\s+/g, ' ') || '';
                const teamKey = report.team?.toLowerCase().trim() || '';

                // Try exact name+team match first
                let matchingKPI = kpiByNameTeam.get(`${nameKey}_${teamKey}`);

                // Fallback to name match only
                if (!matchingKPI) {
                    matchingKPI = kpiByName.get(nameKey);
                }

                // Parse checklist from answers JSON
                let checklist = {
                    fb: false,
                    ig: false,
                    caption: false,
                    tiktok: false,
                    youtube: false,
                    lark: false,
                };

                // Parse answers if it's a JSON string
                let answersData = report.answers;
                if (typeof answersData === 'string') {
                    try {
                        answersData = JSON.parse(answersData);
                    } catch (e) {
                        this.logger.warn(`Failed to parse answers for report ${report.id}`);
                    }
                }

                // Extract checklist items from answers
                if (answersData && typeof answersData === 'object') {
                    // Mapping based on actual Vietnamese question strings seen in Lark data
                    checklist.fb = answersData['Bạn đã đăng video lên FB chưa?'] === true || answersData['Báo cáo Lark - Bạn đã đăng video lên FB chưa?'] === true || false;
                    checklist.ig = answersData['Bạn đã đăng video lên IG chưa?'] === true || answersData['Báo cáo Lark - Bạn đã đăng video lên IG chưa?'] === true || false;
                    checklist.tiktok = answersData['Bạn đã đăng video lên Tiktok chưa?'] === true || answersData['Báo cáo Lark - Bạn đã đăng video lên Tiktok chưa?'] === true || false;
                    checklist.youtube = answersData['Bạn đã đăng video lên Youtube chưa?'] === true || answersData['Báo cáo Lark - Bạn đã đăng video lên Youtube chưa?'] === true || false;
                    checklist.lark = answersData['Bạn đã báo cáo đầy đủ thông tin công việc trên lark chưa?'] === true || answersData['Báo cáo Lark - Bạn đã báo cáo đầy đủ thông tin công việc trên lark chưa?'] === true || false;
                    checklist.caption = answersData['Bạn đã check lại caption và hagtag video chưa?'] === true || answersData['Báo cáo Lark - Bạn đã check lại caption và hagtag video chưa?'] === true || false;
                }

                return {
                    id: report.id,
                    name: report.name,
                    email: report.email,
                    team: report.team,
                    role: report.role,
                    date: report.date,
                    avatar: matchingKPI?.link_image || matchingKPI?.image_url || null,
                    tag: matchingKPI?.tag || report.name || null, // Fallback to name if tag not found
                    status: 'ĐÚNG HẠN', // Consistent with UI in screenshot
                    checklist,
                    answers: answersData,
                    employee_data: report.employee,
                    kpi_day: matchingKPI?.kpi_day || null,
                    kpi_month: matchingKPI?.kpi_month || null,
                    completed_day: matchingKPI?.completed_day || null,
                };
            });

            return combinedReports;
        } catch (error) {
            this.logger.error('Failed to get user activity reports', error);
            throw error;
        }
    }
}
