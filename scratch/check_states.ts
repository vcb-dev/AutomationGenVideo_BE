import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const teams = await prisma.larkKPI.groupBy({
        by: ['team', 'state'],
        _count: {
            _all: true
        }
    });

    console.log(JSON.stringify(teams, null, 2));
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
