const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const emails = [
    'thanhdatho37ga02378@gmail.com',
    'nglinh890@gmail.com',
    'donga131101@gmail.com',
  ];
  for (const email of emails) {
    const rows = await prisma.larkReport.findMany({
      where: { email: { equals: email, mode: 'insensitive' } },
      orderBy: { date: 'desc' },
      take: 10,
      select: { id: true, email: true, name: true, team: true, date: true, created_at: true },
    });
    console.log('====', email, rows.length);
    console.log(JSON.stringify(rows, null, 2));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
