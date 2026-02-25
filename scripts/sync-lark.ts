import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const LARK_APP_ID = process.env.LARK_APP_ID || 'cli_a917e6e937f89e19';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || 'KaKQJ48T6ks9qwUwZvJYZfkxf1I5pfwe';
const LARK_BASE_APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || 'GtOmwYSoUiFpcbkNFpPlG5pKgrh';
const LARK_BASE_TABLE_ID = process.env.LARK_BASE_TABLE_ID || 'tblWq1M8sTSXgKmz';
const BASE_URL = 'https://open.larksuite.com/open-apis';

async function getToken(): Promise<string> {
    console.log('🔑 Getting Lark access token...');
    const res = await axios.post(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
        app_id: LARK_APP_ID,
        app_secret: LARK_APP_SECRET,
    });
    if (res.data.code !== 0) throw new Error(`Auth failed: ${res.data.msg}`);
    console.log('✅ Token obtained');
    return res.data.tenant_access_token;
}

async function fetchRecords(token: string): Promise<any[]> {
    console.log('📥 Fetching records from Lark Base...');
    const allRecords: any[] = [];
    let pageToken: string | undefined;
    let hasMore = true;

    while (hasMore) {
        const params: any = { page_size: 100 };
        if (pageToken) params.page_token = pageToken;

        const res = await axios.get(
            `${BASE_URL}/bitable/v1/apps/${LARK_BASE_APP_TOKEN}/tables/${LARK_BASE_TABLE_ID}/records`,
            { headers: { Authorization: `Bearer ${token}` }, params }
        );

        if (res.data.code !== 0) throw new Error(`API error: ${res.data.msg} (code: ${res.data.code})`);

        const data = res.data.data;
        if (data.items) allRecords.push(...data.items);
        hasMore = data.has_more || false;
        pageToken = data.page_token;
    }

    console.log(`✅ Fetched ${allRecords.length} records`);
    return allRecords;
}

function extractText(field: any): string | null {
    if (!field) return null;
    if (typeof field === 'string') return field;
    if (typeof field === 'number') return String(field);
    if (Array.isArray(field)) {
        return field.map((item) => {
            if (typeof item === 'string') return item;
            if (item?.text) return item.text;
            return '';
        }).join('').trim();
    }
    if (field?.text) return field.text;
    if (field?.val) return field.val;
    return null;
}

function mapRoles(larkRole: string): string[] {
    const role = larkRole.toLowerCase().trim();
    if (role === 'admin') return ['ADMIN'];
    if (role === 'leader') return ['LEADER_VIDEO', 'LEADER_CONTENT'];
    if (role === 'member') return ['EDITOR', 'CONTENT'];
    return ['CONTENT'];
}

async function main() {
    console.log('🚀 Starting Lark → DB sync...\n');

    const token = await getToken();
    const records = await fetchRecords(token);

    let created = 0, updated = 0, skipped = 0;

    for (const record of records) {
        const fields = record.fields;

        const email = extractText(fields['Email']);
        if (!email) { skipped++; continue; }

        const fullName = extractText(fields['HoTen']) || extractText(fields['Nhân viên']) || email.split('@')[0];
        const larkRole = extractText(fields['Role']) || 'Member';
        const team = extractText(fields['Team']) || '';
        const status = extractText(fields['Trạng Thái']) || extractText(fields['Trang Thai']) || 'ON';

        const roles = mapRoles(larkRole);
        const isActive = status.toUpperCase() === 'ON';

        const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });

        if (existing) {
            await prisma.user.update({
                where: { email: email.toLowerCase().trim() },
                data: { full_name: fullName.trim(), roles: roles as any[], is_active: isActive },
            });
            updated++;
            console.log(`📝 Updated: ${email} → [${roles.join(', ')}] | Team: ${team}`);
        } else {
            const hash = await bcrypt.hash('VCB@2024', 10);
            await prisma.user.create({
                data: {
                    email: email.toLowerCase().trim(),
                    password_hash: hash,
                    full_name: fullName.trim(),
                    roles: roles as any[],
                    is_active: isActive,
                },
            });
            created++;
            console.log(`✅ Created: ${email} → [${roles.join(', ')}] | Team: ${team}`);
        }
    }

    console.log(`\n🏁 Sync complete!`);
    console.log(`   📊 Total: ${records.length}`);
    console.log(`   ✅ Created: ${created}`);
    console.log(`   📝 Updated: ${updated}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   🔑 Default password for new users: VCB@2024`);
}

main()
    .catch((e) => { console.error('❌ Error:', e.message); process.exit(1); })
    .finally(() => prisma.$disconnect());
