const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== USERS AND TEAMS DIAGNOSTICS ===');
  
  // 1. Get all active users, their full name, and team field
  const users = await prisma.user.findMany({
    where: { is_active: true },
    select: {
      id: true,
      full_name: true,
      email: true,
      team: true
    }
  });
  console.log(`Total active users: ${users.length}`);
  console.log('Sample users and their team field value:');
  users.forEach(u => {
    console.log(`- Name: "${u.full_name}", Email: "${u.email}", team field: "${u.team}"`);
  });

  // 2. Check if TeamMember table exists and print content
  try {
    const teamMembers = await prisma.teamMember.findMany({
      include: {
        user: { select: { full_name: true } },
        team: { select: { name: true } }
      }
    });
    console.log(`\nTeamMember relationships count: ${teamMembers.length}`);
    teamMembers.forEach(tm => {
      console.log(`- Member: "${tm.user?.full_name}", Team: "${tm.team?.name}"`);
    });
  } catch (err) {
    console.log('\nCould not query teamMember table:', err.message);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
