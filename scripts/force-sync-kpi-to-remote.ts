import axios from 'axios';
import { PrismaClient } from '@prisma/client';

// Remote DB URL from request
const REMOTE_DB_URL = "postgresql://postgres:trunghieu2003Hh%40@34.143.247.162:5432/video_production?sslmode=require&schema=public&connection_limit=10";

// Lark Config from URL
const LARK_APP_ID = process.env.LARK_APP_ID || 'cli_a9b023ef4078ded0';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
const LARK_BASE_ID = "UqgJw2SZOiZsAYk7ciTl11fKgjg";
const LARK_TABLE_ID = "tblh9DeeqDBItrg7";

async function getToken() {
    const res = await axios.post('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: LARK_APP_ID,
        app_secret: LARK_APP_SECRET
    });
    return res.data.tenant_access_token;
}

async function fetchLarkRecords(token: string) {
    const records: any[] = [];
    let pageToken = '';
    let hasMore = true;

    while (hasMore) {
        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records`;
        const res: any = await axios.get(url, {
            headers: { Authorization: `Bearer ${token}` },
            params: { page_size: 500, page_token: pageToken }
        });
        
        const data = res.data.data;
        if (data.items) records.push(...data.items);
        hasMore = data.has_more;
        pageToken = data.page_token;
        console.log(`Fetched ${records.length} records...`);
    }
    return records;
}

function extractText(field: any): string | null {
    if (field == null) return null;
    if (typeof field === 'string') return field.trim();
    if (Array.isArray(field)) {
        return field.map(f => f.text || f.name || "").join(", ").trim() || null;
    }
    return String(field);
}

function mapRecordToKPI(record: any) {
    const fields = record.fields;
    
    // Extract report_date from "Ngày báo cáo"
    let reportDate: Date | null = null;
    if (fields['Ngày báo cáo']) {
        const timestamp = typeof fields['Ngày báo cáo'] === 'number' ? fields['Ngày báo cáo'] : parseInt(fields['Ngày báo cáo']);
        if (!isNaN(timestamp)) reportDate = new Date(timestamp);
    }

    const name = extractText(fields['Tên']) || extractText(fields['Nhân viên']) || null;

    return {
        id: record.record_id,
        employee_id: fields['ID nhân viên'] || null,
        name: name,
        tag: extractText(fields['TAG']) || null,
        team: fields['Team'] || null, // Lấy luôn trong bảng lark_kpi
        image_url: fields['Hình ảnh']?.[0]?.url || null,
        kpi_day: parseInt(fields['KPI Ngày']) || 0,
        kpi_month: parseInt(fields['KPI THÁNG']) || 0,
        kpii_status: fields['KPII'] || null,
        completed_day: parseInt(fields['Hoàn thành']) || 0,
        completed_month: parseInt(fields['Hoàn thành Tháng']) || 0,
        task_new: parseInt(fields['Task mới']) || 0,
        task_new_month: parseInt(fields['Task mới tháng']) || 0,
        task_auto: parseInt(fields['Task Auto']) || 0,
        task_auto_month: parseInt(fields['Task Auto Tháng']) || 0,
        task_creative: parseInt(fields['Task sáng tạo']) || 0,
        revenue_month: fields['Doanh thu tháng'] ? BigInt(Math.floor(fields['Doanh thu tháng'])) : BigInt(0),
        traffic_month: fields['Traffic Tháng'] ? BigInt(Math.floor(fields['Traffic Tháng'])) : BigInt(0),
        report_date: reportDate,
        month: fields['Tháng'] || null,
        state: fields['Trạng thái'] || null,
        link_image: fields['Link ảnh'] || null,
        created_at: new Date(),
        updated_at: new Date()
    };
}

async function main() {
    console.log('--- STARTING FORCE SYNC LARK KPI TO REMOTE (Team from Lark) ---');
    const token = await getToken();
    const rawRecords = await fetchLarkRecords(token);
    
    // Filter records from March 1st, 2026
    const minDate = new Date('2026-03-01T00:00:00Z');
    const kpiData = rawRecords
        .map(mapRecordToKPI)
        .filter(row => row.report_date && row.report_date >= minDate);

    console.log(`Filtered ${kpiData.length} records since 2026-03-01`);

    if (kpiData.length === 0) {
        console.log('No records found to sync. Sample record from Lark:');
        console.log(JSON.stringify(rawRecords[0]?.fields, null, 2));
        return;
    }

    const prismaRemote = new PrismaClient({
        datasources: { db: { url: REMOTE_DB_URL } }
    });

    try {
        await prismaRemote.$connect();
        console.log('Connected to remote DB');

        // Delete existing records
        console.log('Cleaning remote lark_kpi table...');
        await prismaRemote.larkKPI.deleteMany({});

        // Insert new records in chunks
        const CHUNK_SIZE = 300;
        for (let i = 0; i < kpiData.length; i += CHUNK_SIZE) {
            const chunk = kpiData.slice(i, i + CHUNK_SIZE);
            await prismaRemote.larkKPI.createMany({
                data: chunk as any,
                skipDuplicates: true
            });
            console.log(`Inserted chunk ${Math.floor(i / CHUNK_SIZE) + 1} (${chunk.length} rows)`);
        }

        console.log('--- SYNC COMPLETED SUCCESSFULLY ---');
    } catch (err) {
        console.error('Error during sync:', err);
    } finally {
        await prismaRemote.$disconnect();
    }
}

main();
