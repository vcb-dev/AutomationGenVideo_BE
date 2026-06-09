/**
 * sync_users_from_lark_hr.js
 * Sync users từ Lark HR Bitable về bảng users trong DB.
 * Base:  GtOmwYSoUiFpcbkNFpPlG5pKgrh
 * Table: tblWq1M8sTSXgKmz
 *
 * BEHAVIOR: Ghi đè hoàn toàn field `team` từ Lark (KHÔNG merge).
 *           Chỉ update user đã tồn tại (match theo email hoặc full_name).
 *           KHÔNG tạo user mới / KHÔNG xóa user cũ.
 */

require('dotenv').config();
const https = require('https');
const { PrismaClient } = require('@prisma/client');

const LARK_APP_ID     = process.env.LARK_APP_ID;
const LARK_APP_SECRET = process.env.LARK_APP_SECRET;
const BASE_ID  = 'GtOmwYSoUiFpcbkNFpPlG5pKgrh';
const TABLE_ID = 'tblWq1M8sTSXgKmz';

const prisma = new PrismaClient();

// ─── HTTP helpers ────────────────────────────────────────────────────────────
function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsGet(url, token) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

// ─── Lark helpers ────────────────────────────────────────────────────────────
async function getAccessToken() {
  const res = await httpsPost('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: LARK_APP_ID,
    app_secret: LARK_APP_SECRET,
  });
  if (!res.tenant_access_token) throw new Error(`Token error: ${JSON.stringify(res)}`);
  return res.tenant_access_token;
}

async function fetchAllRecords(token) {
  const records = [];
  let pageToken = '';
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      text_field_as_key: 'true',
      page_size: '500',
    });
    if (pageToken) params.set('page_token', pageToken);

    const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${BASE_ID}/tables/${TABLE_ID}/records?${params}`;
    const res = await httpsGet(url, token);

    if (res.code !== 0) throw new Error(`Lark API error: ${res.msg} (code ${res.code})`);

    const data = res.data;
    if (data.items) records.push(...data.items);
    hasMore = data.has_more || false;
    pageToken = data.page_token || '';
    console.log(`  Fetched ${records.length} records so far...`);
  }
  return records;
}

// ─── Field extractors ────────────────────────────────────────────────────────
function extractString(val) {
  if (!val) return null;
  if (typeof val === 'string') return val.trim() || null;
  if (Array.isArray(val) && val.length > 0) {
    const first = val[0];
    if (typeof first === 'string') return first.trim() || null;
    if (typeof first === 'object') return (first.name || first.text || '').trim() || null;
  }
  if (typeof val === 'object') return (val.name || val.text || '').trim() || null;
  return String(val).trim() || null;
}

function extractTeam(val) {
  // Team field có thể là: string, array of strings, array of objects
  if (!val) return null;
  const parts = [];
  if (typeof val === 'string') {
    parts.push(...val.split(',').map(s => s.trim()).filter(Boolean));
  } else if (Array.isArray(val)) {
    for (const item of val) {
      if (!item) continue;
      if (typeof item === 'string') parts.push(item.trim());
      else if (typeof item === 'object') {
        const name = (item.name || item.text || '').trim();
        if (name) parts.push(name);
      }
    }
  } else if (typeof val === 'object') {
    const name = (val.name || val.text || '').trim();
    if (name) parts.push(name);
  }
  // Deduplicate case-insensitive
  const seen = new Set();
  const unique = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (!seen.has(key)) { seen.add(key); unique.push(p); }
  }
  return unique.length ? unique.join(', ') : null;
}

function parseRecord(record) {
  const f = record.fields;

  // Tên — thử nhiều field
  const name = extractString(f['Tên'] || f['Ten'] || f['Họ tên'] || f['Full Name'] || f['Name'] || f['Nhân viên']) || null;

  // Email
  const email = extractString(f['Email'] || f['email']) || null;

  // Team — GHI ĐÈ hoàn toàn
  const team = extractTeam(f['Team'] || f['team']) || null;

  // Chức vụ / position
  const position = extractString(f['Chức vụ'] || f['Chuc vu'] || f['Position'] || f['Role']) || null;

  // Tình trạng / status
  const status = extractString(f['Tình trạng'] || f['Tinh trang'] || f['Status']) || null;

  return { name, email, team, position, status, record_id: record.record_id };
}

// ─── normalize name ───────────────────────────────────────────────────────────
function normName(raw) {
  if (!raw) return '';
  return raw.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').trim().replace(/\s+/g, ' ');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== SYNC USERS FROM LARK HR TABLE ===');
  console.log(`Base:  ${BASE_ID}`);
  console.log(`Table: ${TABLE_ID}`);
  console.log('');

  // 1. Lấy token
  console.log('1. Getting Lark access token...');
  const token = await getAccessToken();
  console.log('   ✅ Token OK');

  // 2. Fetch tất cả records từ Lark
  console.log('\n2. Fetching records from Lark...');
  const records = await fetchAllRecords(token);
  console.log(`   ✅ Total Lark records: ${records.length}`);

  // 3. Parse records
  const larkUsers = records.map(parseRecord).filter(r => r.name && r.name !== 'Unknown');
  console.log(`   ✅ Valid (có tên): ${larkUsers.length}`);

  // Show mẫu để kiểm tra fields
  console.log('\n--- SAMPLE (first 5 records from Lark) ---');
  for (const u of larkUsers.slice(0, 5)) {
    console.log(`  name="${u.name}" | email="${u.email}" | team="${u.team}" | position="${u.position}" | status="${u.status}"`);
  }
  console.log('--- END SAMPLE ---\n');

  // 4. Lấy toàn bộ users từ DB
  console.log('3. Loading all DB users...');
  const dbUsers = await prisma.user.findMany({
    select: { id: true, email: true, full_name: true, team: true, employee_status: true, employee_position: true },
  });
  console.log(`   ✅ DB users: ${dbUsers.length}`);

  // Build lookup maps
  const dbByEmail = new Map();
  const dbByName  = new Map();
  for (const u of dbUsers) {
    if (u.email) dbByEmail.set(u.email.toLowerCase().trim(), u);
    if (u.full_name) dbByName.set(normName(u.full_name), u);
  }

  // 5. Sync
  console.log('\n4. Syncing...');
  let updated = 0, skipped = 0, noMatch = 0;

  const updateLog = [];

  for (const lu of larkUsers) {
    // Match theo email trước, rồi theo tên
    const emailKey = lu.email ? lu.email.toLowerCase().trim() : null;
    const nameKey  = normName(lu.name);

    const target = (emailKey ? dbByEmail.get(emailKey) : null) || dbByName.get(nameKey) || null;

    if (!target) {
      noMatch++;
      // console.log(`  [NO MATCH] name="${lu.name}" email="${lu.email}"`);
      continue;
    }

    // So sánh xem có thay đổi gì không
    const oldTeam = target.team;
    const newTeam = lu.team;
    const oldStatus = target.employee_status;
    const newStatus = lu.status;
    const oldPosition = target.employee_position;
    const newPosition = lu.position;

    const hasChange = oldTeam !== newTeam || oldStatus !== newStatus || oldPosition !== newPosition;

    if (!hasChange) {
      skipped++;
      continue;
    }

    // Log thay đổi team
    if (oldTeam !== newTeam) {
      updateLog.push(`  [TEAM CHANGE] "${target.full_name}" | "${oldTeam}" → "${newTeam}"`);
    }

    await prisma.user.update({
      where: { id: target.id },
      data: {
        // GHI ĐÈ hoàn toàn — KHÔNG merge
        team: newTeam,
        employee_status: newStatus ?? target.employee_status,
        employee_position: newPosition ?? target.employee_position,
      },
    });
    updated++;
  }

  // 6. Kết quả
  console.log('\n=== SYNC RESULT ===');
  console.log(`  Updated:  ${updated}`);
  console.log(`  Skipped (no change): ${skipped}`);
  console.log(`  No match in DB: ${noMatch}`);

  if (updateLog.length > 0) {
    console.log('\n--- TEAM CHANGES ---');
    updateLog.forEach(l => console.log(l));
  }

  // 7. Verify Đỗ Đăng Chung
  console.log('\n=== VERIFY: Đỗ Đăng Chung ===');
  const verifyUsers = await prisma.user.findMany({
    where: { full_name: { contains: 'Chung', mode: 'insensitive' } },
    select: { full_name: true, email: true, team: true, roles: true, employee_status: true },
  });
  for (const u of verifyUsers) {
    console.log(`  name="${u.full_name}" | email="${u.email}" | team="${u.team}" | roles=${JSON.stringify(u.roles)} | status="${u.employee_status}"`);
  }

  await prisma.$disconnect();
  console.log('\n✅ DONE!');
}

main().catch(async (e) => {
  console.error('❌ Error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
