
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

// --- Configuration ---
const LARK_APP_ID = process.env.LARK_APP_ID || 'cli_a9b023ef4078ded0';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
const LARK_BASE_ID = process.env.LARK_REPORT_BASE_ID || 'Q5Fmby8DVaKOyusfR8glgRB6gbf';
const LARK_TABLE_ID = process.env.LARK_REPORT_TABLE_ID || 'tblte3XJWcPvHhxW';
const BASE_URL = 'https://open.larksuite.com/open-apis';

const TARGET_DB_URL = process.env.SERVER_DATABASE_URL;

async function syncReports() {
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

        console.log('📥 Fetching Reports from Lark (Last 3 days)...');
        // Simple fetch without complex filters for this script
        let allRecords: any[] = [];
        let pageToken = '';
        let hasMore = true;

        while (hasMore) {
            const res = await axios.get(`${BASE_URL}/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records`, {
                headers: { Authorization: `Bearer ${token}` },
                params: { page_size: 100, page_token: pageToken || undefined }
            });
            const data = res.data.data;
            allRecords = allRecords.concat(data.items || []);
            hasMore = data.has_more;
            pageToken = data.page_token;
            
            // Limit for this script to avoid massive data fetch if not needed
            if (allRecords.length > 1000) break; 
        }
        console.log(`✅ Fetched ${allRecords.length} recent reports.`);

        console.log('🚀 Upserting reports to server DB...');
        let upserted = 0;
        for (const r of allRecords) {
            const f = r.fields;
            const email = f['Email'] ? (Array.isArray(f['Email']) ? f['Email'][0]?.email : String(f['Email'])) : null;
            if (!email) continue;

            const name = f['Họ Tên'] || f['HoTen'] || f['Name'] || email.split('@')[0];
            const rawDate = f['Date'] || f['Ngày báo cáo'] || f['Ngày'] || f['Ngay'];
            if (!rawDate) continue;

            const reportDate = new Date(rawDate);
            const minDate = new Date('2026-03-01T00:00:00Z');
            if (reportDate < minDate) continue;
            
            // Simplified mapping
            await prisma.checklistReport.upsert({
                where: { id: r.record_id },
                create: {
                    id: r.record_id,
                    name: String(name),
                    email: email.toLowerCase().trim(),
                    team: f['Team'] ? String(f['Team']) : null,
                    date: reportDate,
                    answers: f,
                },
                update: {
                    name: String(name),
                    team: f['Team'] ? String(f['Team']) : null,
                    date: reportDate,
                    answers: f,
                }
            });
            upserted++;
        }
        console.log(`✨ SUCCESS: ${upserted} reports upserted to Server DB!`);

    } catch (e: any) {
        console.error('❌ Sync failed:', e.message);
    } finally {
        await server.$disconnect();
    }
}

// Injected fix for the script
const server = new PrismaClient({ datasources: { db: { url: TARGET_DB_URL } } });

syncReports();
