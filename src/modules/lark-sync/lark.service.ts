import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class LarkService {
    private readonly logger = new Logger(LarkService.name);
    private tenantAccessToken: string | null = null;
    private tokenExpiresAt: number = 0;

    private readonly appId = process.env.LARK_APP_ID;
    private readonly appSecret = process.env.LARK_APP_SECRET;
    private readonly baseAppToken = process.env.LARK_BASE_APP_TOKEN;
    private readonly tableId = process.env.LARK_BASE_TABLE_ID;

    // Lark Suite uses open.larksuite.com (international version)
    private readonly BASE_URL = 'https://open.larksuite.com/open-apis';

    /**
     * Get tenant access token (auto-refresh if expired)
     */
    async getTenantAccessToken(): Promise<string> {
        const now = Date.now();

        // Return cached token if still valid (with 60s buffer)
        if (this.tenantAccessToken && this.tokenExpiresAt > now + 60000) {
            return this.tenantAccessToken;
        }

        this.logger.log('🔑 Fetching new Lark tenant access token...');

        const response = await axios.post(
            `${this.BASE_URL}/auth/v3/tenant_access_token/internal`,
            {
                app_id: this.appId,
                app_secret: this.appSecret,
            },
        );

        if (response.data.code !== 0) {
            throw new Error(`Lark auth failed: ${response.data.msg}`);
        }

        this.tenantAccessToken = response.data.tenant_access_token;
        // Token expires in `expire` seconds
        this.tokenExpiresAt = now + response.data.expire * 1000;

        this.logger.log('✅ Lark tenant access token obtained');
        return this.tenantAccessToken;
    }

    /**
     * Fetch all records from the PHAN_QUYEN table in Lark Base
     */
    async fetchHRRecords(): Promise<any[]> {
        const token = await this.getTenantAccessToken();
        const allRecords: any[] = [];
        let pageToken: string | undefined = undefined;
        let hasMore = true;

        this.logger.log('📥 Fetching HR records from Lark Base...');

        while (hasMore) {
            const params: any = {
                page_size: 100,
            };
            if (pageToken) {
                params.page_token = pageToken;
            }

            const response = await axios.get(
                `${this.BASE_URL}/bitable/v1/apps/${this.baseAppToken}/tables/${this.tableId}/records`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                    params,
                },
            );

            if (response.data.code !== 0) {
                throw new Error(`Lark API error: ${response.data.msg} (code: ${response.data.code})`);
            }

            const data = response.data.data;
            if (data.items) {
                allRecords.push(...data.items);
            }

            hasMore = data.has_more || false;
            pageToken = data.page_token;
        }

        this.logger.log(`✅ Fetched ${allRecords.length} records from Lark Base`);
        return allRecords;
    }

    /**
     * Parse a Lark Base record into a normalized employee object
     */
    parseRecord(record: any): {
        email: string;
        full_name: string;
        role: string;
        team: string;
        is_active: boolean;
        record_id: string;
    } | null {
        const fields = record.fields;

        // Get email - it's a text field
        const email = this.extractTextValue(fields['Email']);
        if (!email) {
            this.logger.warn(`⚠️ Skipping record without email: ${record.record_id}`);
            return null;
        }

        // Get full name
        const fullName = this.extractTextValue(fields['HoTen']) ||
            this.extractTextValue(fields['Nhân viên']) ||
            email.split('@')[0];

        // Get role
        const role = this.extractTextValue(fields['Role']) || 'Member';

        // Get team
        const team = this.extractTextValue(fields['Team']) || '';

        // Get status
        const status = this.extractTextValue(fields['Trạng Thái']) ||
            this.extractTextValue(fields['Trang Thai']) || 'ON';

        return {
            email: email.toLowerCase().trim(),
            full_name: fullName.trim(),
            role: role.trim(),
            team: team.trim(),
            is_active: status.toUpperCase() === 'ON',
            record_id: record.record_id,
        };
    }

    /**
     * Map Lark role string to our UserRole enum ARRAY
     * Member → [EDITOR, CONTENT]
     * Leader → [LEADER_VIDEO, LEADER_CONTENT]
     * Admin → [ADMIN]
     */
    mapToUserRoles(larkRole: string, team: string): string[] {
        const role = larkRole.toLowerCase().trim();

        if (role === 'admin') {
            return ['ADMIN'];
        }

        if (role === 'leader') {
            return ['LEADER_VIDEO', 'LEADER_CONTENT'];
        }

        // Member role → both EDITOR and CONTENT
        if (role === 'member') {
            return ['EDITOR', 'CONTENT'];
        }

        // Default fallback
        return ['CONTENT'];
    }

    /**
     * Extract text value from Lark field (handles different field types)
     */
    private extractTextValue(field: any): string | null {
        if (!field) return null;

        // Simple text/string value
        if (typeof field === 'string') return field;

        // Number value
        if (typeof field === 'number') return String(field);

        // Array of text segments (rich text)
        if (Array.isArray(field)) {
            return field
                .map((item) => {
                    if (typeof item === 'string') return item;
                    if (item?.text) return item.text;
                    if (item?.val) return item.val;
                    return '';
                })
                .join('')
                .trim();
        }

        // Object with text property
        if (field?.text) return field.text;
        if (field?.val) return field.val;
        if (field?.value) {
            if (typeof field.value === 'string') return field.value;
            if (Array.isArray(field.value)) {
                return field.value.map((v: any) => v?.text || v || '').join('');
            }
        }

        return null;
    }
}
