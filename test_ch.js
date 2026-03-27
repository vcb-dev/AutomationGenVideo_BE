const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Add replacer for BigInt
const replacer = (key, value) => typeof value === 'bigint' ? value.toString() : value;

async function main() {
  const ch = await prisma.trackedChannel.findFirst({ where: { username: '61581376858588', platform: 'FACEBOOK' } });
  console.log(JSON.stringify(ch, replacer, 2));
}
main().finally(() => prisma.$disconnect());
