const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const replacer = (key, value) => typeof value === 'bigint' ? value.toString() : value;

async function main() {
  const ch = await prisma.trackedChannel.findFirst({ where: { username: '61581376858588', platform: 'FACEBOOK' } });
  fs.writeFileSync('out.json', JSON.stringify(ch, replacer, 2));
}
main().finally(() => prisma.$disconnect());
