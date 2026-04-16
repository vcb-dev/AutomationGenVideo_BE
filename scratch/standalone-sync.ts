import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function getAccessToken() {
  const response = await axios.post('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: 'cli_a9b023ef4078ded0',
    app_secret: 'ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu',
  });
  return response.data.tenant_access_token;
}

async function fetchRecords() {
    const token = await getAccessToken();
    const baseId = 'XJQWbUmkWaJcW8sShyIlLXaTgvb';
    const tableId = 'tblUubDhUoJ9TV7m';
    const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/records`;

    let allRecords = [];
    let pageToken = '';
    let hasMore = true;

    console.log('Fetching records from Lark...');
    while (hasMore) {
        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${token}` },
            params: {
                text_field_as_key: true,
                page_size: 100,
                ...(pageToken ? { page_token: pageToken } : {}),
            },
        });
        const data = response.data.data;
        allRecords = allRecords.concat(data.items || []);
        hasMore = data.has_more;
        pageToken = data.page_token;
        console.log(`Fetched ${allRecords.length} records...`);
        // Stop at 2000 for quick test or do all
        if (allRecords.length > 3000) break; 
    }
    return allRecords;
}

const TEAM_ID_MAP = {
    "optgmAjxPX": "Team K1",
    "opth87zsh9": "Team K2",
    "optLSu0E6l": "AFF 01",
    "optonYfIIw": "AFF 02",
    "optdYBBB79": "Global - JP1",
    "opt7VPlNbt": "Global - Indo",
    "optLOnq82e": "Team K0",
    "optsAgErUN": "Team ADS",
    "opteRGl6SB": "MEDIA CHUNG",
    "optowWD7Fz": "DATA",
    "optfnEgAuR": "Global Thái Lan",
    "optLFMbFec": "Global Đài Loan",
    "opt6i9kLZg": "Team K4",
    "optpjHn4pm": "Team K3"
};

async function main() {
  const records = await fetchRecords();
  const users = await prisma.user.findMany({ where: { team: { not: null } } });
  const userTeamMap = new Map();
  users.forEach(u => userTeamMap.set(u.email?.toLowerCase(), u.team));

  console.log('Syncing to database...');
  let updated = 0;

  for (const record of records) {
    const fields = record.fields;
    
    // Extract employee email
    let empEmail = null;
    let empName = null;
    const nhanVien = fields['Nhân Viên'];
    if (nhanVien && nhanVien.users && nhanVien.users.length > 0) {
        empEmail = nhanVien.users[0].email;
        empName = nhanVien.users[0].name;
    }

    // Extract team
    let team = null;
    const rawTeam = fields['Team'];
    if (Array.isArray(rawTeam) && rawTeam.length > 0) {
        const first = rawTeam[0];
        team = TEAM_ID_MAP[first] || (typeof first === 'string' && !first.startsWith('opt') ? first : null);
    }
    
    // Fallback to user team
    if ((!team || team.startsWith('opt')) && empEmail) {
        team = userTeamMap.get(empEmail.toLowerCase()) || team;
    }

    const fileContentUrl = Array.isArray(fields['File content']) ? fields['File content'][0]?.link : null;

    const data = {
        caption: (Array.isArray(fields['Caption']) ? fields['Caption'][0]?.text : fields['Caption']) || null,
        deadline: (Array.isArray(fields['Deadline']) ? fields['Deadline'][0]?.text : fields['Deadline']) || null,
        employee_name: empName,
        employee_email: empEmail,
        content: (Array.isArray(fields['Nội Dung']) ? fields['Nội Dung'][0]?.text : fields['Nội Dung']) || null,
        team: team,
        status: (Array.isArray(fields['Trạng Thái']) ? fields['Trạng Thái'][0]?.text : fields['Trạng Thái']) || null,
        content_type: (Array.isArray(fields['Tuyến Nội Dung']) ? fields['Tuyến Nội Dung'][0]?.text : fields['Tuyến Nội Dung']) || null,
        file_content_url: fileContentUrl
    };

    await prisma.larkListTask.upsert({
        where: { id: record.record_id },
        update: data as any,
        create: { id: record.record_id, ...data } as any,
    });
    updated++;
    if (updated % 500 === 0) console.log(`Updated ${updated}...`);
  }
  
  console.log(`Done! Synced ${updated} records.`);
  await prisma.$disconnect();
}

main().catch(console.error);
