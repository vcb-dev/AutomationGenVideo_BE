import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const REMOTE_DB_URL: string = process.env.SERVER_DATABASE_URL!;
if (!REMOTE_DB_URL) { process.exit(1); }

const LARK_APP_ID = process.env.LARK_APP_ID || 'cli_a9b023ef4078ded0';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
const LARK_BASE_ID = process.env.LARK_KPI_DODA_BASE_ID || "Livew1AE0i2vo5kF3YXlCPNWg8f";
const LARK_TABLE_ID = process.env.LARK_KPI_DODA_TABLE_ID || "tblPIc4EQjd2wfAa";

async function getToken() {
    const res = await axios.post('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET
    });
    return res.data.tenant_access_token;
}

async function fetchLarkRecords(token: string) {
    const records: any[] = [];
    let pageToken = '';
    let hasMore = true;
    while (hasMore) {
        const res: any = await axios.get(`https://open.larksuite.com/open-apis/bitable/v1/apps/${LARK_BASE_ID}/tables/${LARK_TABLE_ID}/records`, {
            headers: { Authorization: `Bearer ${token}` },
            params: { page_size: 500, page_token: pageToken }
        });
        const data = res.data.data;
        if (data.items) records.push(...data.items);
        hasMore = data.has_more; pageToken = data.page_token;
        console.log(`📥 Fetched ${records.length} records from Lark (Đồ Da)...`);
    }
    return records;
}

function esc(val: any): string {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'bigint' || typeof val === 'number') return String(val);
    if (val instanceof Date) return `'${val.toISOString()}'`;
    return `'${String(val).replace(/'/g, "''")}'`;
}

// Helper to parse Lark fields (handles Person, Select, Text, etc.)
function parseLarkValue(val: any): any {
    if (val === null || val === undefined) return null;
    if (Array.isArray(val)) {
        if (val.length === 0) return null;
        return val[0].name || val[0].text || val[0];
    }
    if (typeof val === 'object') return val.name || val.text || JSON.stringify(val);
    return val;
}

async function main() {
    console.log('🚀 --- AGGREGATING ĐỒ DA EDITOR KPI STARTING ---');
    const token = await getToken();
    const rawRecords = await fetchLarkRecords(token);
    
    // Group records by Editor + Date
    const stats: Record<string, any> = {};
    
    for (const r of rawRecords) {
        const f = r.fields;
        const editor = parseLarkValue(f['Người edit']) || 'Unknown';
        const dateRaw = f['Ngày edit'];
        if (!dateRaw || editor === 'Unknown') continue;
        
        const date = new Date(parseInt(dateRaw));
        const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
        const key = `${editor}_${dateKey}`;
        
        if (!stats[key]) {
            stats[key] = {
                id: key,
                editor_name: editor,
                report_date: new Date(dateKey),
                report_date_key: dateKey,
                completed_day: 0,
                month: parseLarkValue(f['Tháng']) || `${date.getMonth() + 1}/${date.getFullYear()}`
            };
        }
        
        // Logic "Đã xong" linh hoạt hơn
        const isDone = f['Đã edit'] === true || f['Đã edit'] === 1 || 
                       String(f['Trạng thái']).includes('Hoàn thành') ||
                       String(f['Đã edit']).toLowerCase() === 'true';

        if (isDone) {
            stats[key].completed_day += 1;
        }
    }

    const finalData = Object.values(stats);
    console.log(`📊 Aggregated Data: ${finalData.length} editor-day records.`);

    const url = REMOTE_DB_URL.includes('?') ? `${REMOTE_DB_URL}&connection_limit=1` : `${REMOTE_DB_URL}?connection_limit=1`;
    const prisma = new PrismaClient({ datasources: { db: { url } } });

    try {
        await prisma.$connect();
        console.log('🔗 Connected to Supabase.');

        const COLUMNS = `"id","editor_name","report_date","report_date_key","month","completed_day","created_at","updated_at"`;

        // Step 1: Buffer Table
        await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS sync_lark_kpi_doda_editor_buffer`);
        await prisma.$executeRawUnsafe(`CREATE UNLOGGED TABLE sync_lark_kpi_doda_editor_buffer (LIKE "lark_kpi_do_da_editor" INCLUDING ALL)`);

        // Step 2: Load into Buffer
        const CHUNK_SIZE = 200;
        for (let i = 0; i < finalData.length; i += CHUNK_SIZE) {
            const chunk = finalData.slice(i, i + CHUNK_SIZE);
            const values = chunk.map(r => `(${esc(r.id)},${esc(r.editor_name)},${esc(r.report_date)},${esc(r.report_date_key)},${esc(r.month)},${r.completed_day},NOW(),NOW())`).join(',');
            await prisma.$executeRawUnsafe(`INSERT INTO sync_lark_kpi_doda_editor_buffer (${COLUMNS}) VALUES ${values}`);
            console.log(`   → Loaded ${Math.min(i + CHUNK_SIZE, finalData.length)}/${finalData.length} to Buffer`);
        }

        // Step 3: UPSERT to Main
        console.log('🪄  Merging into lark_kpi_do_da_editor...');
        const updateSet = `"completed_day"=EXCLUDED."completed_day", "month"=EXCLUDED."month", "updated_at"=NOW()`;
        
        await prisma.$executeRawUnsafe(`
            INSERT INTO "lark_kpi_do_da_editor" (${COLUMNS})
            SELECT ${COLUMNS} FROM sync_lark_kpi_doda_editor_buffer
            ON CONFLICT ("id") DO UPDATE SET ${updateSet}
        `);

        await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS sync_lark_kpi_doda_editor_buffer`);
        console.log('✅ ĐỒ DA EDITOR SYNC SUCCESSFUL!');
    } catch (err) {
        console.error('❌ Đồ Da Editor Sync failed:', err);
    } finally {
        await prisma.$disconnect();
    }
}
main();
