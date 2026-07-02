const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== USERS IN TEAM K1 ===');
  const k1Users = await prisma.user.findMany({
    where: {
      team: 'Team K1',
      is_active: true
    },
    select: {
      id: true,
      email: true,
      full_name: true,
      employee_id: true,
      employee_status: true,
      employee_position: true
    }
  });

  console.log(`Found ${k1Users.length} active users in Team K1:`);
  k1Users.forEach(u => {
    console.log(`- Name: ${u.full_name}, Email: ${u.email}, ID: ${u.employee_id}, Status: ${u.employee_status}, Position: ${u.employee_position}`);
  });

  // Check if Nguyen Kieu Anh is one of them (or any case variation)
  const kieuAnhUser = k1Users.find(u => u.full_name.toLowerCase().includes('kieu anh') || u.full_name.toLowerCase().includes('kiều anh'));
  console.log('\nNguyen Kieu Anh User Record:', kieuAnhUser ? kieuAnhUser : 'NOT FOUND IN USER TABLE');

  console.log('\n=== LARK REPORTS FOR TODAY (2026-06-04) FOR TEAM K1 ===');
  const startDate = new Date('2026-06-04T00:00:00.000Z');
  const endDate = new Date('2026-06-04T23:59:59.999Z');
  
  // Try precise Vietnam bounds: June 4 in VN is from 2026-06-03 17:00:00 to 2026-06-04 16:59:59 UTC
  const vnStart = new Date('2026-06-03T17:00:00.000Z');
  const vnEnd = new Date('2026-06-04T16:59:59.999Z');

  console.log(`Querying date between (UTC): ${startDate.toISOString()} and ${endDate.toISOString()}`);
  const reportsTodayUTC = await prisma.larkReport.findMany({
    where: {
      team: 'Team K1',
      date: {
        gte: startDate,
        lte: endDate
      }
    },
    orderBy: {
      created_at: 'desc'
    }
  });

  console.log(`Reports found for Team K1 today (UTC date match): ${reportsTodayUTC.length}`);
  reportsTodayUTC.forEach(r => {
    console.log(`- Name: ${r.name}, Email: ${r.email}, Date: ${r.date ? r.date.toISOString() : 'N/A'}, CreatedAt: ${r.created_at.toISOString()}`);
  });

  console.log(`\nQuerying date between (VN bounds): ${vnStart.toISOString()} and ${vnEnd.toISOString()}`);
  const reportsTodayVN = await prisma.larkReport.findMany({
    where: {
      team: 'Team K1',
      date: {
        gte: vnStart,
        lte: vnEnd
      }
    },
    orderBy: {
      created_at: 'desc'
    }
  });

  console.log(`Reports found for Team K1 today (VN date match): ${reportsTodayVN.length}`);
  reportsTodayVN.forEach(r => {
    console.log(`- Name: ${r.name}, Email: ${r.email}, Date: ${r.date ? r.date.toISOString() : 'N/A'}, CreatedAt: ${r.created_at.toISOString()}`);
  });

  // Also query without team filter for today VN bounds to see if she reported under a different team
  console.log('\n=== LARK REPORTS FOR TODAY (VN BOUNDS) - ALL TEAMS ===');
  const allReportsToday = await prisma.larkReport.findMany({
    where: {
      date: {
        gte: vnStart,
        lte: vnEnd
      }
    },
    orderBy: {
      team: 'asc'
    }
  });
  console.log(`Total reports today (all teams): ${allReportsToday.length}`);
  allReportsToday.forEach(r => {
    if (r.name.toLowerCase().includes('anh') || r.email.toLowerCase().includes('kieuanh')) {
      console.log(`- [MATCH ANH/EMAIL] Name: ${r.name}, Team: ${r.team}, Date: ${r.date ? r.date.toISOString() : 'N/A'}, CreatedAt: ${r.created_at.toISOString()}`);
    }
  });
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
