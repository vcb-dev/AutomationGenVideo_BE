
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

async function main() {
  try {
    const result = await prisma.$queryRaw`SELECT name FROM lark_permissions LIMIT 5;`;
    console.log('Sample names from DB:');
    result.forEach(r => console.log(r.name));
    
    // Also write to a file to be sure
    fs.writeFileSync('db_names.txt', result.map(r => r.name).join('\n'), 'utf8');
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
