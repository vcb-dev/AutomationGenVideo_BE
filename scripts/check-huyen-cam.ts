/**
 * Debug: Kiểm tra tại sao "Huyền Cam" (team K1) không xuất hiện trên server
 */
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const serverUrl = process.env.SERVER_DATABASE_URL;
  if (!serverUrl) { console.log('❌ Missing SERVER_DATABASE_URL'); return; }

  const local = new PrismaClient();
  const server = new PrismaClient({ datasources: { db: { url: serverUrl } } });

  try {
    // 1. Check user in local DB
    console.log('=== LOCAL DB ===');
    const localUser = await local.user.findMany({
      where: { full_name: { contains: 'Huyền Cam', mode: 'insensitive' } },
      select: { id: true, full_name: true, email: true, team: true, employee_status: true, is_active: true }
    });
    console.log('Users matching "Huyền Cam":', JSON.stringify(localUser, null, 2));

    // 2. Check KPI in local DB
    const localKpi = await local.kpi.findMany({
      where: { name: { contains: 'Huyền Cam', mode: 'insensitive' } },
      take: 5,
      orderBy: { report_date: 'desc' },
      select: { id: true, name: true, team: true, report_date: true, kpi_day: true, completed_day: true, employee_status: true, state: true }
    });
    console.log(`Local KPI records (${localKpi.length}):`, JSON.stringify(localKpi, null, 2));

    // 3. Check user on server DB
    console.log('\n=== SERVER DB ===');
    const serverUser = await server.user.findMany({
      where: { full_name: { contains: 'Huyền Cam', mode: 'insensitive' } },
      select: { id: true, full_name: true, email: true, team: true, employee_status: true, is_active: true }
    });
    console.log('Users matching "Huyền Cam":', JSON.stringify(serverUser, null, 2));

    // 4. Check KPI on server DB
    const serverKpi = await server.kpi.findMany({
      where: { name: { contains: 'Huyền Cam', mode: 'insensitive' } },
      take: 5,
      orderBy: { report_date: 'desc' },
      select: { id: true, name: true, team: true, report_date: true, kpi_day: true, completed_day: true, employee_status: true, state: true }
    });
    console.log(`Server KPI records (${serverKpi.length}):`, JSON.stringify(serverKpi, null, 2));

    // 5. Check all K1 team members on server
    const k1Members = await server.kpi.findMany({
      where: { team: { contains: 'K1', mode: 'insensitive' } },
      distinct: ['name'],
      select: { name: true, team: true },
    });
    console.log(`\nAll K1 team members on server (${k1Members.length}):`, k1Members.map(m => m.name).join(', '));

  } finally {
    await local.$disconnect();
    await server.$disconnect();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
