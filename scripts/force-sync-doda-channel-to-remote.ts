import axios from 'axios';
import { PrismaClient } from '@prisma/client';

// Remote DB URL from env
const REMOTE_DB_URL = process.env.SERVER_DATABASE_URL;
if (!REMOTE_DB_URL) {
    console.error('Missing SERVER_DATABASE_URL in environment');
    process.exit(1);
}

// Lark Config for Đồ Da Channel
const LARK_APP_ID = process.env.LARK_APP_ID || 'cli_a9b023ef4078ded0';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
const DODA_BASE_ID = 'Livew1AE0i2vo5kF3YXlCPNWg8f';
const DODA_TABLE_ID = 'tblgOat8ymmJ6oi9';

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
        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${DODA_BASE_ID}/tables/${DODA_TABLE_ID}/records`;
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

const extractString = (val: any): string | null => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string') return val.trim();
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (Array.isArray(val)) {
        if (val.length === 0) return null;
        const first = val[0];
        if (typeof first === 'string') return first.trim();
        if (typeof first === 'object' && first !== null) {
            return (first.text || first.name || first.value || first.en_name || "").trim() || null;
        }
        return String(first).trim();
    }
    if (typeof val === 'object') {
        return (val.text || val.value || val.name || val.link || "").trim() || null;
    }
    return String(val).trim();
};

const extractUrl = (val: any): string | null => {
    if (!val) return null;
    if (typeof val === 'string') return val.trim();
    if (Array.isArray(val) && val.length > 0) {
        const first = val[0];
        return first.link || first.url || first.text || (typeof first === 'string' ? first.trim() : null);
    }
    if (typeof val === 'object') return val.link || val.url || val.text || null;
    return String(val).trim();
};

const normalizePlatform = (raw: string | null): string => {
    if (!raw) return '';
    const lower = raw.toLowerCase().trim();
    if (lower === 'ig' || lower === 'instagram') return 'Instagram';
    if (lower === 'tiktok') return 'TikTok';
    if (lower === 'facebook' || lower === 'fb') return 'Facebook';
    if (lower === 'douyin') return 'Douyin';
    if (lower === 'xiaohongshu' || lower === 'xhs') return 'Xiaohongshu';
    if (lower === 'youtube' || lower === 'yt') return 'YouTube';
    return raw.trim();
};

function mapRecordToChannel(record: any) {
    const f = record.fields;
    
    const name = extractString(f['Tên Kênh']) || extractString(f['Tên kênh']) || 'N/A';
    const owner = extractString(f['Họ Và Tên']) || extractString(f['Họ và tên']) || null;
    const platform = normalizePlatform(extractString(f['Nền Tảng']) || extractString(f['Nền tảng']));
    const link_channel = extractUrl(f['Link Kênh']) || extractUrl(f['Link kênh']);
    const status = extractString(f['Trạng Thái']) || extractString(f['Trạng thái']) || 'Active';

    return {
        id: `doda_${record.record_id}`,
        name,
        platform,
        channel_id: null, // Often not available in this specific table
        link_channel,
        status,
        team_traffic: 'Đồ Da',
        owner,
        email: null, // Need to match with users table later if needed
        created_at: new Date(),
        updated_at: new Date()
    };
}

async function main() {
    console.log('--- STARTING SYNC DO DA CHANNELS TO REMOTE ---');
    const token = await getToken();
    const rawRecords = await fetchLarkRecords(token);
    
    const channelData = rawRecords.map(mapRecordToChannel);

    console.log(`Mapped ${channelData.length} Đồ Da channels.`);

    const prismaRemote = new PrismaClient({
        datasources: { db: { url: REMOTE_DB_URL } }
    });

    try {
        await prismaRemote.$connect();
        console.log('Connected to remote DB');

        // Delete existing Đồ Da records
        console.log('Cleaning existing Đồ Da channels...');
        await prismaRemote.channel.deleteMany({
            where: { team_traffic: 'Đồ Da' }
        });

        // Insert new records
        if (channelData.length > 0) {
            await prismaRemote.channel.createMany({
                data: channelData as any,
                skipDuplicates: true
            });
            console.log(`Successfully synced ${channelData.length} Đồ Da channels.`);
        }

        console.log('--- SYNC COMPLETED ---');
    } catch (err) {
        console.error('Error during sync:', err);
    } finally {
        await prismaRemote.$disconnect();
    }
}

main();
