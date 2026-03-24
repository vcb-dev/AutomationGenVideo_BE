const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const kpis = await prisma.larkKPI.findMany({ 
    where: { 
      OR: [ 
        { email: { contains: 'hthuha' } }, 
        { name: { contains: 'Thu Hà' } } 
      ] 
    } 
  }); 
  console.log(kpis.map(k=>({id: k.id, name:k.name, email:k.email, team:k.team})));
}

main().finally(() => prisma.$disconnect());
