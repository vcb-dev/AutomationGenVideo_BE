
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const LARK_APP_ID = process.env.LARK_APP_ID || 'cli_a9b023ef4078ded0';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
const LARK_BASE_ID = 'JAEmwmWQkixHOOkumU5lRU7ogkb';
const LARK_TABLE_ID = 'tblWxMtDAkvh1gWS';
const BASE_URL = 'https://open.larksuite.com/open-apis';

const TARGET_DB_URL = process.env.SERVER_DATABASE_URL;

async function syncChannels() {
    if (!TARGET_DB_URL || TARGET_DB_URL.includes('user:password')) {
        console.error('❌ SERVER_DATABASE_URL is missing or placeholder');
        return;
    }

    const prisma = new PrismaClient({ datasources: { db: { url: TARGET_DB_URL } } });

    try {
        const authRes = await axios.post(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
            app_id: LARK_APP_ID,
            app_secret: LARK_APP_SECRET,
        });
        const token = authRes.data.tenant_access_token;

        console.log(`📥 Fetching Channels from Lark (Table: ${LARK_TABLE_ID})...`);
        let allRecords: any[] = [];
        let pageToken = '';
        let hasMore = true;

        while (hasMore) {
            const res = await axios.get(`${BASE_URL}/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records`, {
                headers: { Authorization: `Bearer ${token}` },
                params: { page_size: 200, page_token: pageToken || undefined }
            });
            const data = (res.data as any).data;
            allRecords = allRecords.concat(data.items || []);
            hasMore = data.has_more;
            pageToken = data.page_token;
        }
        console.log(`✅ Fetched ${allRecords.length} channels.`);

        // Helpers from LarkService
        const extractString = (val: any): string | null => {
            if (!val) return null;
            if (typeof val === 'string') return val;
            if (Array.isArray(val)) return val[0]?.text || val[0]?.name || val[0]?.en_name || JSON.stringify(val[0]);
            if (typeof val === 'object') return val.text || val.name || null;
            return String(val);
        };
        const extractUrl = (val: any): string | null => {
            if (!val) return null;
            if (typeof val === 'string') return val;
            if (Array.isArray(val)) return val[0]?.link || val[0]?.url || val[0]?.text || null;
            return val.link || val.url || val.text || null;
        };
        const extractEmail = (val: any): string | null => {
            if (!val) return null;
            if (Array.isArray(val)) return val[0]?.email || null;
            return val.email || null;
        };

        console.log('🚀 Overwriting huyk_channels on server (non-DoDa)...');
        // Delete existing (except Do Da)
        await (prisma as any).channel.deleteMany({
            where: { NOT: { id: { startsWith: 'doda_' } } },
        });

        const EXCLUDED_TEAMS = ['global - jp2', 'global - jp3'];
        let created = 0;

        for (const r of allRecords) {
            const f = r.fields;
            const teamTraffic = extractString(f['Team Traffic']) || extractString(f['Team traffic']) || '';
            if (EXCLUDED_TEAMS.includes(teamTraffic.toLowerCase().trim())) continue;

            const name = extractString(f['Tên kênh hiện tại']) || extractString(f['Tên kênh A?']) || extractString(f['name']) || 'N/A';
            const owner = extractString(f['Nhân viên traffic xây kênh']) || extractString(f['NV traffic xây kênh']) || extractString(f['owner A?']) || '';
            const email = extractEmail(f['Nhân viên traffic xây kênh']) || extractEmail(f['NV traffic xây kênh']) || null;

            await (prisma as any).channel.create({
                data: {
                    id: r.record_id,
                    name,
                    platform: extractString(f['Nền tảng']) || extractString(f['Nền tảng A?']) || '',
                    channel_id: extractString(f['ID kênh hiện tại']) || extractString(f['channel_id A?']) || extractString(f['channel_id']) || '',
                    link_channel: extractUrl(f['Link kênh']) || extractUrl(f['link_channel A?']) || extractUrl(f['link_channel']) || '',
                    status: extractString(f['Trạng thái hoạt động'] || f['Trạng thái A?'] || f['Trạng thái']) || 'Đang hoạt động',
                    team_traffic: teamTraffic,
                    owner,
                    email: email?.toLowerCase().trim() || null,
                }
            });
            created++;
        }
        
        console.log(`✨ SUCCESS: ${created} channels synced to Server DB!`);

    } catch (e: any) {
        console.error('❌ Sync failed:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

syncChannels();
