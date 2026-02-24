const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const data = await prisma.huykChannel.findMany();
    console.log(`Found ${data.length} records in HuykChannel.`);
    if (data.length > 0) {
        console.log('Sample record:', JSON.stringify(data[0], (key, value) =>
            typeof value === 'bigint' ? value.toString() : value, 2));
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
