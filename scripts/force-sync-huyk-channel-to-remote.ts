import axios from 'axios';
import { Prisma, PrismaClient } from '@prisma/client';

// Remote DB URL from env
const REMOTE_DB_URL = process.env.SERVER_DATABASE_URL;
if (!REMOTE_DB_URL) {
    console.error('Missing SERVER_DATABASE_URL in environment');
    process.exit(1);
}

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

        // KHÔNG deleteMany toàn bảng rồi createMany lại như trước. huyk_channels không chỉ chứa
        // dữ liệu Lark: kênh user tự add từ FE cũng nằm ở đây với id 'manual_%' (tracked-channels
        // dùng manual_<platform>_<username>, channels-team dùng manual_<uuid>), và cột owner_id/
        // team_id (FK, backfill từ 08/07/2026) chỉ tồn tại phía DB. Xóa-rồi-chèn-lại làm kênh add
        // tay "tự biến mất" và cột team trên FE (đọc qua relation team_id) trống đi sau mỗi lần
        // sync — đúng 2 lỗi user đã báo.

        // 1) Chỉ xóa bản ghi GỐC LARK (id là record_id, không phải manual_%) đã bị xóa khỏi Lark.
        //    Giữ nguyên ngoại lệ Đồ Da (được sync bằng luồng riêng, không có trong bảng Lark này).
        const larkIds = channelData.map(c => c.id);
        const removed = await prismaRemote.channel.deleteMany({
            where: {
                id: { notIn: larkIds },
                NOT: [
                    { id: { startsWith: 'manual_' } },
                    { team_traffic: 'Đồ Da' },
                ],
            },
        });
        console.log(`Removed ${removed.count} Lark-origin channels no longer in Lark.`);

        // 2) Upsert theo id, CHỈ đè các cột lấy từ Lark — không đụng owner_id/team_id đã backfill.
        const CHUNK_SIZE = 300;
        for (let i = 0; i < channelData.length; i += CHUNK_SIZE) {
            const chunk = channelData.slice(i, i + CHUNK_SIZE);
            const values = chunk.map(c => Prisma.sql`(
                ${c.id}, ${c.name}, ${c.platform}, ${c.channel_id}, ${c.link_channel},
                ${c.status}, ${c.team_traffic}, ${c.owner}, ${c.email}, NOW(), NOW()
            )`);
            await prismaRemote.$executeRaw(Prisma.sql`
                INSERT INTO huyk_channels
                    (id, name, platform, channel_id, link_channel, status, team_traffic, owner, email, created_at, updated_at)
                VALUES ${Prisma.join(values)}
                ON CONFLICT (id) DO UPDATE SET
                    name         = EXCLUDED.name,
                    platform     = EXCLUDED.platform,
                    channel_id   = EXCLUDED.channel_id,
                    link_channel = EXCLUDED.link_channel,
                    status       = EXCLUDED.status,
                    team_traffic = EXCLUDED.team_traffic,
                    owner        = EXCLUDED.owner,
                    email        = EXCLUDED.email,
                    updated_at   = NOW()
            `);
            console.log(`Upserted chunk ${Math.floor(i / CHUNK_SIZE) + 1} (${chunk.length} rows)`);
        }

        // 3) Backfill owner_id/team_id cho dòng mới từ Lark (cùng logic manual_backfill_channel_owner_team.sql,
        //    chỉ điền dòng đang NULL) — để cột Team/Chủ kênh trên FE hiện ngay, không phải chờ chạy tay.
        const filledOwners = await prismaRemote.$executeRaw`
            UPDATE huyk_channels c SET owner_id = u.id
            FROM users u
            WHERE lower(trim(c.email)) = lower(trim(u.email)) AND c.owner_id IS NULL
        `;
        const filledTeams = await prismaRemote.$executeRaw`
            UPDATE huyk_channels c SET team_id = t.id
            FROM teams t
            WHERE trim(c.team_traffic) = trim(t.name) AND c.team_id IS NULL
        `;
        console.log(`Backfilled owner_id for ${filledOwners} rows, team_id for ${filledTeams} rows.`);

        console.log('--- SYNC COMPLETED SUCCESSFULLY ---');
    } catch (err) {
        console.error('Error during sync:', err);
    } finally {
        await prismaRemote.$disconnect();
    }
}

main();
