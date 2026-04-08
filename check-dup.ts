import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const prisma = new PrismaClient();
async function main() {
  const lines: string[] = [];

  const kpis = await prisma.larkKPI.findMany({ select: { id: true, name: true, team: true, image_url: true, link_image: true, employee_id: true, month: true, state: true }});
  kpis.forEach(k => {
    if (k.name && k.name.toLowerCase().includes('chung')) {
       lines.push("KPI: " + JSON.stringify(k));
    }
  });

  const users = await prisma.user.findMany({ select: { employee_id: true, full_name: true, team: true, email: true }});
  users.forEach(u => {
     if (u.full_name && u.full_name.toLowerCase().includes('chung')) {
         lines.push("USER: " + JSON.stringify(u));
     }
  });

  const teams = await prisma.larkKPI.groupBy({ by: ['team'], _count: { id: true }});
  lines.push("Distinct Teams In KPI: " + JSON.stringify(teams, null, 2));

  const reports = await prisma.larkReport.findMany({ select: { id: true, name: true, team: true, email: true } });
  reports.forEach(r => {
    if (r.name && r.name.toLowerCase().includes('chung')) {
       lines.push("REPORT: " + JSON.stringify(r));
    }
  });

  // Also check LarkReportKPI
  const reportKpis = await (prisma as any).larkReportKPI.findMany({ select: { id: true, name: true, team: true, email: true, image_url: true }});
  reportKpis.forEach((r: any) => {
    if (r.name && r.name.toLowerCase().includes('chung')) {
       lines.push("REPORT_KPI: " + JSON.stringify(r));
    }
  });

  fs.writeFileSync('check-dup-output.txt', lines.join('\n'));
  console.log('Done! Written to check-dup-output.txt');
}
main().finally(() => prisma.$disconnect());
