
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

const APP_ID = "cli_a9b023ef4078ded0";
const APP_SECRET = "ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu";
const BASE_ID = 'XJQWbUmkWaJcW8sShyIlLXaTgvb';
const TABLE_ID = 'tbl0wuaAIPo99wrX';

async function getAccessToken() {
    try {
        const response = await axios.post(
            'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal',
            { app_id: APP_ID, app_secret: APP_SECRET }
        );
        return response.data.tenant_access_token;
    } catch (error) {
        console.error('Error getting token:', error.response?.data || error.message);
        throw error;
    }
}

async function fetchLarkRecords(token: string) {
    let allRecords: any[] = [];
    let pageToken = '';
    let hasMore = true;

    while (hasMore) {
        const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${BASE_ID}/tables/${TABLE_ID}/records`;
        const params: any = {
            text_field_as_key: true,
            page_size: 100,
        };
        if (pageToken) params.page_token = pageToken;

        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${token}` },
            params: params
        });

        if (response.data.code !== 0) {
            throw new Error(`Lark API Error: ${response.data.msg}`);
        }

        const data = response.data.data;
        allRecords = allRecords.concat(data.items);
        hasMore = data.has_more;
        pageToken = data.page_token;
    }
    return allRecords;
}

function mapRecordToReport(record: any) {
    const fields = record.fields;

    // Log fields for the first valid record to debug
    if (fields['HoTen']) {
        // console.log(`Found valid record: ${fields['HoTen']}`);
    }

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
        team: team, // Using 'Team' as verified in debug script
        status: status, // Using 'TrangThai'
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

async function main() {
    console.log('Starting standalone sync...');
    const token = await getAccessToken();
    console.log('Got token.');
    const records = await fetchLarkRecords(token);
    console.log(`Fetched ${records.length} records.`);

    if (records.length > 0) {
        console.log('Sample Raw Field Keys:', Object.keys(records[0].fields));
    }

    let updated = 0;
    for (const record of records) {
        const reportData = mapRecordToReport(record);

        await prisma.larkReport.upsert({
            where: { id: reportData.id },
            update: {
                ...reportData,
                checklist: reportData.checklist as any,
                questions: reportData.questions as any,
            },
            create: {
                ...reportData,
                checklist: reportData.checklist as any,
                questions: reportData.questions as any,
            },
        });
        updated++;
        if (updated % 100 === 0) console.log(`Processed ${updated} records...`);
    }
    console.log('Sync complete.');
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
