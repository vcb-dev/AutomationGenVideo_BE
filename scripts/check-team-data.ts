import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const url = process.env.SERVER_DATABASE_URL || process.env.DATABASE_URL;
  console.log('Using DB:', url ? url.substring(0, 30) + '...' : 'DEFAULT');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  
  try {
    await prisma.$connect();
    
    // Hồ Đạt
    console.log('\n=== HỒ ĐẠT - USERS ===');
    const hdUsers = await prisma.user.findMany({
      where: { OR: [
        { full_name: { contains: 'Hồ Đạt', mode: 'insensitive' } },
        { full_name: { contains: 'Ho Dat', mode: 'insensitive' } },
      ]},
      select: { full_name: true, email: true, team: true, employee_id: true }
    });
    console.log(JSON.stringify(hdUsers, null, 2));

    console.log('\n=== HỒ ĐẠT - LARK_KPI (latest 3) ===');
    const hdKpi = await prisma.larkKPI.findMany({
      where: { OR: [
        { name: { contains: 'Hồ Đạt', mode: 'insensitive' } },
        { name: { contains: 'Ho Dat', mode: 'insensitive' } },
      ]},
      orderBy: { report_date: 'desc' }, take: 3,
      select: { name: true, team: true, completed_day: true, kpi_day: true, report_date: true, employee_id: true }
    });
    console.log(JSON.stringify(hdKpi, null, 2));

    console.log('\n=== HỒ ĐẠT - LARK_KPI_DO_DA (latest 3) ===');
    const hdDoda = await prisma.larkKpiDoDa.findMany({
      where: { OR: [
        { name: { contains: 'Hồ Đạt', mode: 'insensitive' } },
        { name: { contains: 'Ho Dat', mode: 'insensitive' } },
      ]},
      orderBy: { report_date: 'desc' }, take: 3,
      select: { name: true, team: true, completed_day: true, kpi_day: true, report_date: true, employee_id: true }
    });
    console.log(JSON.stringify(hdDoda, null, 2));

    // Trần Mai Linh
    console.log('\n=== TRẦN MAI LINH - USERS ===');
    const tmlUsers = await prisma.user.findMany({
      where: { full_name: { contains: 'Mai Linh', mode: 'insensitive' } },
      select: { full_name: true, email: true, team: true, employee_id: true }
    });
    console.log(JSON.stringify(tmlUsers, null, 2));

    console.log('\n=== TRẦN MAI LINH - LARK_KPI (latest 3) ===');
    const tmlKpi = await prisma.larkKPI.findMany({
      where: { name: { contains: 'Mai Linh', mode: 'insensitive' } },
      orderBy: { report_date: 'desc' }, take: 3,
      select: { name: true, team: true, completed_day: true, kpi_day: true, report_date: true, employee_id: true }
    });
    console.log(JSON.stringify(tmlKpi, null, 2));

    console.log('\n=== TRẦN MAI LINH - LARK_KPI_DO_DA (latest 3) ===');
    const tmlDoda = await prisma.larkKpiDoDa.findMany({
      where: { name: { contains: 'Mai Linh', mode: 'insensitive' } },
      orderBy: { report_date: 'desc' }, take: 3,
      select: { name: true, team: true, completed_day: true, kpi_day: true, report_date: true, employee_id: true }
    });
    console.log(JSON.stringify(tmlDoda, null, 2));

    // Nguyễn Thị Ánh
    console.log('\n=== NGUYỄN THỊ ÁNH - USERS ===');
    const ntaUsers = await prisma.user.findMany({
      where: { full_name: { contains: 'Nguyễn Thị Ánh', mode: 'insensitive' } },
      select: { full_name: true, email: true, team: true, employee_id: true }
    });
    console.log(JSON.stringify(ntaUsers, null, 2));

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
