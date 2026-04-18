import axios from 'axios';
import { PrismaClient } from '@prisma/client';

// Remote DB URL from previous context
const REMOTE_DB_URL = "postgresql://postgres:trunghieu2003Hh%40@34.143.247.162:5432/video_production?sslmode=require&schema=public&connection_limit=10";

// Lark Config for Huyk Channel
const LARK_APP_ID = process.env.LARK_APP_ID || 'cli_a9b023ef4078ded0';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
const LARK_BASE_ID = "JAEmwmWQkixHOOkumU5lRU7ogkb";
const LARK_TABLE_ID = "tblWxMtDAkvh1gWS";

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

function mapRecordToChannel(record: any) {
    const fields = record.fields;
    
    const ownerInfo = fields['NV traffic xây kênh']?.[0];
    const linkInfo = fields['Link kênh'];

    return {
        id: record.record_id,
        name: extractText(fields['Tên kênh hiện tại']) || "Unknown",
        platform: extractText(fields['Nền tảng']) || null,
        channel_id: extractText(fields['ID kênh hiện tại']) || null,
        link_channel: linkInfo?.link || linkInfo?.text || (typeof linkInfo === 'string' ? linkInfo : null),
        status: extractText(fields['Trạng thái hoạt động']) || null,
        team_traffic: extractText(fields['Team Traffic']) || null,
        owner: ownerInfo?.name || null,
        email: ownerInfo?.email || null,
        created_at: new Date(),
        updated_at: new Date()
    };
}

async function main() {
    console.log('--- STARTING FORCE SYNC HUYK CHANNEL TO REMOTE ---');
    const token = await getToken();
    const rawRecords = await fetchLarkRecords(token);
    
    const channelData = rawRecords.map(mapRecordToChannel);

    console.log(`Mapped ${channelData.length} channels.`);

    if (channelData.length === 0) {
        console.log('No records found to sync.');
        return;
    }

    const prismaRemote = new PrismaClient({
        datasources: { db: { url: REMOTE_DB_URL } }
    });

    try {
        await prismaRemote.$connect();
        console.log('Connected to remote DB');

        // Delete existing records in huyk_channels
        console.log('Cleaning remote huyk_channels table...');
        await prismaRemote.channel.deleteMany({});

        // Insert new records in chunks
        const CHUNK_SIZE = 300;
        for (let i = 0; i < channelData.length; i += CHUNK_SIZE) {
            const chunk = channelData.slice(i, i + CHUNK_SIZE);
            await prismaRemote.channel.createMany({
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
