
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class LarkService {
    private readonly logger = new Logger(LarkService.name);
    private accessToken: string;
    private tokenExpiresAt: number;

    private readonly BASE_ID = 'XJQWbUmkWaJcW8sShyIlLXaTgvb';
    private readonly TABLE_ID = 'tbl0wuaAIPo99wrX';
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

    // Cron job runs at 12:00 and 18:00 every day
    @Cron('0 12,18 * * *')
    async handleCron() {
        this.logger.log('Starting scheduled Lark report sync...');
        await this.syncReportData();
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
                        name: reportData.name,
                        team: reportData.team,
                        avatar: reportData.avatar,
                        status: reportData.status,
                        checklist: reportData.checklist,
                        video_source_count: reportData.video_source_count,
                        questions: reportData.questions,
                        submitted_at: reportData.submitted_at ? new Date(reportData.submitted_at) : null,
                    },
                    create: {
                        id: reportData.id,
                        name: reportData.name,
                        team: reportData.team,
                        avatar: reportData.avatar,
                        status: reportData.status,
                        checklist: reportData.checklist,
                        video_source_count: reportData.video_source_count,
                        questions: reportData.questions,
                        submitted_at: reportData.submitted_at ? new Date(reportData.submitted_at) : null,
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


    private mapRecordToReport(record: any) {
        const fields = record.fields;

        let avatarUrl = null;
        if (fields['Link Avatar'] && Array.isArray(fields['Link Avatar']) && fields['Link Avatar'].length > 0) {
            avatarUrl = fields['Link Avatar'][0].link || fields['Link Avatar'][0].text;
        } else if (typeof fields['Link Avatar'] === 'string') {
            avatarUrl = fields['Link Avatar'];
        }

        const name = fields['HoTen'] || fields['Name'] || fields['Tên'] || 'Unknown';
        const team = fields['Team'] || fields['Nhóm'] || 'N/A';
        const status = fields['TrangThai'] === 'Đúng hạn' ? 'ĐÚNG HẠN' : (fields['TrangThai'] || 'TRỄ HẠN');

        return {
            id: record.record_id,
            name: name,
            avatar: avatarUrl,
            team: team,
            status: status,
            checklist: {
                fb: fields['Check1'] || false,
                tiktok: fields['Check2'] || false,
                ig: fields['Check3'] || false,
                youtube: fields['Check4'] || false,
                zalo: fields['Check5'] || false,
                caption_hashtag: fields['Check6'] || false,
                lark: fields['Check7'] || false,
                reportLink: fields['Check8'] || false,
            },
            video_source_count: parseInt(fields['SoVideoTuQuay']) || 0,
            questions: {
                q1: fields['Cau1'] || 'Không có',
                q2: fields['Cau2'] || 'Không có',
                q3: fields['Cau3'] || 'Không có',
                q4: fields['Cau4'] || 'Không có',
                q5: fields['Cau5'] || 'Không có',
            },
            submitted_at: fields['NgayBaoCao'] ? new Date(fields['NgayBaoCao']) : new Date()
        };
    }
}
