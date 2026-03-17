
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const records = await prisma.larkKPI.findMany({
    where: { 
      AND: [
        { OR: [
            { name: { contains: 'Thùy Trang', mode: 'insensitive' } },
            { name: { contains: 'Thuỳ Trang', mode: 'insensitive' } }
          ]
        },
        { report_date: { 
            gte: new Date('2026-03-15T17:00:00.000Z'), 
            lte: new Date('2026-03-16T17:00:00.000Z') 
          } 
        }
      ]
    }
  });
  console.log('Records for 16/3:');
  console.log(JSON.stringify(records, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  await prisma.$disconnect();
}

check();
