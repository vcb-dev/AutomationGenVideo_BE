
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const email = 'toanvan1112001@gmail.com';
  const start = new Date('2026-03-17T00:00:00.000Z');
  const end = new Date('2026-03-17T23:59:59.999Z');
  
  const reports = await prisma.larkReport.findMany({
    where: { 
      email: email,
      date: { 
        gte: start,
        lte: end
      }
    }
  });
  
  console.log(`Reports for ${email} on 2026-03-17:`);
  console.log(JSON.stringify(reports, null, 2));
  
  const employees = await prisma.user.findMany({
    where: { 
      full_name: { contains: 'Nguyễn Toán', mode: 'insensitive' },
      lark_employee_record_id: { not: null },
    }
  });
  console.log('\nEmployee Records (by name):');
  console.log(JSON.stringify(employees, null, 2));

  const perms = await prisma.larkPermission.findMany({
    where: { email: email }
  });
  console.log('\nPermission Records (by email):');
  console.log(JSON.stringify(perms, null, 2));

  await prisma.$disconnect();
}

check();
