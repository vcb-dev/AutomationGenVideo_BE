/**
 * scripts/sync-channels-to-server-direct.ts
 *
 * Fetch toàn bộ records từ Lark Channel table (HuyK Channel)
 * rồi ghi đè thẳng lên SERVER database (bảng huyk_channels).
 */

import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const LARK_APP_ID = process.env.LARK_APP_ID || 'cli_a9b023ef4078ded0';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu';
const LARK_CHANNEL_BASE_ID = process.env.LARK_CHANNEL_BASE_ID || 'JAEmwmWQkixHOOkumU5lRU7ogkb';
const LARK_CHANNEL_TABLE_ID = process.env.LARK_CHANNEL_TABLE_ID || 'tblWxMtDAkvh1gWS';
const BASE_URL = 'https://open.larksuite.com/open-apis';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function getToken(): Promise<string> {
  console.log('🔑 Getting Lark access token...');
  const res = await axios.post(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    app_id: LARK_APP_ID,
    app_secret: LARK_APP_SECRET,
  });
  if (res.data.code !== 0) throw new Error(`Lark auth failed: ${res.data.msg}`);
  return res.data.tenant_access_token;
}

async function fetchAllRecords(token: string): Promise<any[]> {
  console.log(`📥 Fetching records from Lark Channel Table: ${LARK_CHANNEL_TABLE_ID}...`);
  const all: any[] = [];
  let pageToken: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const params: any = { page_size: 500 };
    if (pageToken) params.page_token = pageToken;

    const res = await axios.get(
      `${BASE_URL}/bitable/v1/apps/${LARK_CHANNEL_BASE_ID}/tables/${LARK_CHANNEL_TABLE_ID}/records`,
      { headers: { Authorization: `Bearer ${token}` }, params },
    );

    if (res.data.code !== 0)
      throw new Error(`Lark API error: ${res.data.msg} (code: ${res.data.code})`);

    const data = res.data.data;
    if (data.items) all.push(...data.items);
    hasMore = Boolean(data.has_more);
    pageToken = data.page_token;
  }

  console.log(`   → Fetched ${all.length} raw records`);
  return all;
}

const extractString = (val: any): string | null => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) {
        if (val.length === 0) return null;
        const first = val[0];
        if (typeof first === 'string') return first;
        if (typeof first === 'object' && first !== null) {
            return first.text || first.name || first.value || first.en_name || JSON.stringify(first);
        }
        return String(first);
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
    return null;
};

const extractEmail = (val: any): string | null => {
    if (!val) return null;
    if (Array.isArray(val) && val.length > 0) {
        return val[0].email || null;
    }
    return null;
};

async function main() {
  const serverUrl = requireEnv('SERVER_DATABASE_URL');
  const server = new PrismaClient({ datasources: { db: { url: serverUrl } } });

  try {
    const token = await getToken();
    const records = await fetchAllRecords(token);

    console.log('🚀 Syncing to remote huyk_channels table...');

    // We don't want to clear EVERYTHING if there are manual/doda channels
    // But for a "direct sync" from this Lark table, we replace only Lark-originated records
    // Actually, syncChannelData in lark.service.ts clears NOT doda_ prefix.
    
    let created = 0;
    let skipped = 0;

    const EXCLUDED_TEAMS = ['global - jp2', 'global - jp3'];

    const channelsToUpsert = [];

    for (const record of records) {
        const f = record.fields;
        const teamTraffic = extractString(f['Team Traffic']) || extractString(f['Team traffic']) || '';

        if (EXCLUDED_TEAMS.includes(teamTraffic.toLowerCase().trim())) {
            skipped++;
            continue;
        }

        const name = extractString(f['Tên kênh hiện tại']) || extractString(f['Tên kênh A?']) || extractString(f['name']) || 'N/A';
        const owner = extractString(f['Nhân viên traffic xây kênh']) || extractString(f['NV traffic xây kênh']) || '';
        const email = extractEmail(f['Nhân viên traffic xây kênh']) || extractEmail(f['NV traffic xây kênh']) || null;

        channelsToUpsert.push({
            id: record.record_id,
            name,
            platform: extractString(f['Nền tảng']) || '',
            channel_id: extractString(f['ID kênh hiện tại']) || '',
            link_channel: extractUrl(f['Link kênh']) || '',
            status: extractString(f['Trạng thái hoạt động'] ?? f['Trạng thái']) || 'Đang hoạt động',
            team_traffic: teamTraffic,
            owner,
            email,
            updated_at: new Date()
        });
    }

    // Perform upserts in batches
    const BATCH_SIZE = 100;
    for (let i = 0; i < channelsToUpsert.length; i += BATCH_SIZE) {
        const batch = channelsToUpsert.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(data => 
            server.channel.upsert({
                where: { id: data.id },
                update: data,
                create: { ...data, created_at: new Date() }
            })
        ));
        created += batch.length;
        process.stdout.write(`\r   Progress: ${created}/${channelsToUpsert.length}`);
    }

    console.log(`\n✅ Done! Synced ${created} channels (skipped ${skipped} excluded teams).`);

  } catch (err: any) {
    console.error('❌ Sync failed:', err.message);
  } finally {
    await server.$disconnect();
  }
}

main();
