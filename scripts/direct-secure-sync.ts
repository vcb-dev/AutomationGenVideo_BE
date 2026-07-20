import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const p = new PrismaClient({datasources:{db:{url: process.env.SERVER_DATABASE_URL}}});

const extractString = (val: any): string | null => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (Array.isArray(val)) {
        if (val.length === 0) return null;
        const first = val[0];
        if (typeof first === 'string') return first;
        if (typeof first === 'object' && first !== null) {
            return first.text || first.name || first.value || first.en_name || JSON.stringify(first);
        }
        return String(first);
    }
    if (typeof val === 'object') {
        return val.text || val.value || val.name || val.link || null;
    }
    return String(val);
};

const extractUrl = (val: any): string | null => {
    if (!val) return null;
    if (typeof val === 'string') return val;
    if (Array.isArray(val) && val.length > 0) {
        const first = val[0];
        return first.link || first.url || first.text || (typeof first === 'string' ? first : null);
    }
    if (typeof val === 'object') return val.link || val.url || val.text || null;
    return String(val);
};

const extractEmail = (val: any): string | null => {
    if (!val) return null;
    if (Array.isArray(val) && val.length > 0) {
        return val[0].email || null;
    }
    if (typeof val === 'object') return val.email || null;
    return null;
};

async function run() {
    try {
        console.log('Authenticating to Lark for direct secure insertion...');
        const authRes = await axios.post(
            'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal',
            {
                app_id: process.env.LARK_APP_ID,
                app_secret: process.env.LARK_APP_SECRET,
            }
        );
        const token = authRes.data.tenant_access_token;

        const baseId = 'JAEmwmWQkixHOOkumU5lRU7ogkb';
        const tableId = 'tblWxMtDAkvh1gWS';

        let pageToken = '';
        let hasMore = true;
        let allRecords: any[] = [];

        while (hasMore) {
            const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/records`;
            const res = await axios.get(url, {
                headers: { Authorization: `Bearer ${token}` },
                params: {
                    text_field_as_key: true,
                    page_size: 500,
                    ...(pageToken ? { page_token: pageToken } : {}),
                },
            });
            const data = res.data.data;
            if (data.items) {
                allRecords.push(...data.items);
            }
            hasMore = data.has_more;
            pageToken = data.page_token || '';
        }

        console.log(`Fetched ${allRecords.length} records from Lark.`);

        const EXCLUDED_TEAMS = ['global - jp2', 'global - jp3'];
        const channelsToInsert: any[] = [];

        for (const record of allRecords) {
            const f = record.fields;
            const teamTraffic = extractString(f['Team Traffic'])
                || extractString(f['Team traffic'])
                || '';

            if (EXCLUDED_TEAMS.includes(teamTraffic.toLowerCase().trim())) {
                continue;
            }

            const name = extractString(f['Tên kênh hiện tại'])
                || extractString(f['Tên kênh A?'])
                || extractString(f['name'])
                || 'N/A';

            const owner = extractString(f['Nhân viên traffic xây kênh'])
                || extractString(f['NV traffic xây kênh'])
                || extractString(f['owner A?'])
                || '';

            const data = {
                id: record.record_id,
                name,
                platform: extractString(f['Nền tảng'])
                    || extractString(f['Nền tảng A?'])
                    || '',
                channel_id: extractString(f['ID kênh hiện tại'])
                    || extractString(f['channel_id A?'])
                    || extractString(f['channel_id'])
                    || '',
                link_channel: extractUrl(f['Link kênh'])
                    || extractUrl(f['link_channel A?'])
                    || extractUrl(f['link_channel'])
                    || '',
                status: extractString(
                    f['Trạng thái hoạt động']
                    ?? f['Trạng thái A?']
                    ?? f['Trạng thái']
                    ?? f['Trạng Thái']
                    ?? f['status'],
                ) || 'Đang hoạt động',
                team_traffic: teamTraffic,
                owner,
                email: extractEmail(f['Nhân viên traffic xây kênh'])
                    || extractEmail(f['NV traffic xây kênh'])
                    || null,
            };
            
            channelsToInsert.push(data);
        }

        console.log(`Parsed ${channelsToInsert.length} valid records to sync.`);

        const huyenCamRows = channelsToInsert.filter(r => r.owner.includes('Huyền Cam'));
        console.log('HYEN CAM ROWS FOUND IN PARSER:', JSON.stringify(huyenCamRows, null, 2));

        if (channelsToInsert.length > 0) {
            console.log('Executing database atomic swap now...');
            await p.$transaction([
                p.channel.deleteMany({
                    where: { NOT: { id: { startsWith: 'doda_' } } }
                }),
                p.channel.createMany({
                    data: channelsToInsert,
                    skipDuplicates: true
                })
            ]);
            console.log('Atomic Swap Done!');
            
            // Validate right inside the script after transaction
            const finalCheck = await p.channel.findMany({
                where: { owner: { contains: 'Huyền Cam', mode: 'insensitive' } }
            });
            console.log(`Final verification in DB right after txn: ${finalCheck.length} rows found.`);
            console.log(JSON.stringify(finalCheck, null, 2));
        }

    } catch (err) {
        console.error('Execution error:', err);
    } finally {
        await p.$disconnect();
    }
}

run();
