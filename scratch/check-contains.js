const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const teamName = 'K1';
  console.log(`Querying contains: "${teamName}"`);
  
  const teamMembers = await prisma.user.findMany({
    where: {
      is_active: true,
      team: {
        contains: teamName,
        mode: 'insensitive',
      },
    },
    select: {
      full_name: true,
      team: true
    },
  });

  console.log(`Found: ${teamMembers.length} users`);
  teamMembers.forEach(tm => {
    console.log(`- Member: "${tm.full_name}", Team: "${tm.team}"`);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
