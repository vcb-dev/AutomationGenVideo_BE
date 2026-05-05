
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const LARK_APP_ID = process.env.LARK_APP_ID || 'cli_a9b023ef4078ded0';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
const TARGET_DB_URL = process.env.SERVER_DATABASE_URL;

async function getLarkToken() {
    const res = await axios.post('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: LARK_APP_ID,
        app_secret: LARK_APP_SECRET,
    });
    return res.data.tenant_access_token;
}

async function fetchLarkRecords(token: string, baseId: string, tableId: string) {
    let allRecords: any[] = [];
    let pageToken = '';
    let hasMore = true;
    while (hasMore) {
        const res = await axios.get(`https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/records`, {
            headers: { Authorization: `Bearer ${token}` },
            params: { page_size: 500, page_token: pageToken || undefined }
        });
        const data = res.data.data;
        allRecords = allRecords.concat(data.items || []);
        hasMore = data.has_more;
        pageToken = data.page_token;
    }
    return allRecords;
}

function extractString(val: any): string | null {
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
}

const toNum = (val: any) => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;
    const parsed = parseFloat(String(val).replace(/[^0-9.-]+/g, ''));
    return isNaN(parsed) ? 0 : Math.floor(parsed);
};

const toBigInt = (val: any) => {
    if (val === null || val === undefined) return BigInt(0);
    if (typeof val === 'bigint') return val;
    const parsed = parseInt(String(val).replace(/[^0-9-]+/g, ''), 10);
    return isNaN(parsed) ? BigInt(0) : BigInt(parsed);
};

async function syncTable(prisma: any, token: string, baseId: string, tableId: string, modelName: string) {
    console.log(`📥 Fetching records from ${tableId}...`);
    const records = await fetchLarkRecords(token, baseId, tableId);
    console.log(`✅ Fetched ${records.length} records.`);

    console.log(`🗑️  Wiping remote ${modelName} table...`);
    await prisma[modelName].deleteMany({});

    console.log(`🚀 Inserting ${records.length} records into ${modelName}...`);
    const dataToInsert = records.map(r => {
        const f = r.fields;
        const name = extractString(f['Tên'] || f['Ten'] || f['Họ tên'] || f['Nhân viên'] || f['Họ và tên']);
        if (!name) return null;

        const rawDate = f['Ngày báo cáo'] || f['Ngày'] || f['Ngay'] || f['NGÀY'];
        const reportDate = rawDate ? new Date(rawDate) : null;

        return {
            id: r.record_id,
            name: String(name),
            team: extractString(f['Team']),
            kpi_day:         toNum(f['KPI Ngày'] || f['KPI Ngay']),
            completed_day:   toNum(f['Hoàn thành'] || f['Hoan thanh']),
            kpi_month:       toNum(f['KPI THÁNG'] || f['KPI THANG']),
            completed_month: toNum(f['Hoàn thành Tháng'] || f['Hoan thanh Thang']),
            traffic_month:   toBigInt(f['Traffic Tháng'] || f['Traffic Thang'] || f['Traffic']),
            revenue_month:   toBigInt(f['Doanh thu tháng'] || f['Doanh thu thang'] || f['Revenue']),
            target_traffic_month: extractString(f['Mục tiêu Traffic tháng'] || f['Muc tieu Traffic thang']),
            target_revenue_month: extractString(f['Mục tiêu doanh thu tháng'] || f['Muc tieu doanh thu thang']),
            kpi_progress_month: f['Tiến độ KPI tháng'] ? parseFloat(String(f['Tiến độ KPI tháng'])) : null,
            report_date:     reportDate,
            month:           extractString(f['Tháng'] || f['Thang']),
            employee_id:     extractString(f['ID nhân viên'] || f['Mã Nhân Viên VCB']),
        };
    }).filter(r => !!r);

    const CHUNK = 500;
    for (let i = 0; i < dataToInsert.length; i += CHUNK) {
        await prisma[modelName].createMany({ data: dataToInsert.slice(i, i + CHUNK), skipDuplicates: true });
        console.log(`   → ${modelName} Progress: ${Math.min(i + CHUNK, dataToInsert.length)}/${dataToInsert.length}`);
    }
}

async function sync() {
    if (!TARGET_DB_URL) {
        console.error('❌ SERVER_DATABASE_URL is missing');
        return;
    }
    console.log('🚀 Starting LIGHTWEIGHT DIRECT SYNC');
    const prisma = new PrismaClient({ datasources: { db: { url: TARGET_DB_URL } } });
    
    try {
        const token = await getLarkToken();

        // 1. Main KPI
        const mainBase = process.env.LARK_KPI_BASE_ID || 'UqgJw2SZOiZsAYk7ciTl11fKgjg';
        const mainTable = process.env.LARK_KPI_TABLE_ID || 'tblh9DeeqDBItrg7';
        await syncTable(prisma, token, mainBase, mainTable, 'larkKPI');

        // 2. Do Da KPI
        const dodaBase = process.env.LARK_KPI_DODA_BASE_ID;
        const dodaTable = process.env.LARK_KPI_DODA_TABLE_ID;
        if (dodaBase && dodaTable) {
            await syncTable(prisma, token, dodaBase, dodaTable, 'larkKpiDoDa');
        }

        console.log('✨ ALL SYNC COMPLETED!');
    } catch (e: any) {
        console.error('❌ Sync failed:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

sync();
