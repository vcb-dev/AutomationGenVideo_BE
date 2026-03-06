
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const baoViet = await (prisma as any).user.findFirst({ where: { email: 'haducbaoviet0911@gmail.com' } });
    if (!baoViet) {
        console.log("No Bao Viet found");
        return;
    }

    const members = await (prisma as any).user.findMany({
        where: { team_leader_id: baoViet.id }
    });

    console.log(`Bao Viet is leader for ${members.length} members.`);
    members.forEach((m: any) => console.log(`- ${m.full_name} (${m.email})`));
}

main().catch(console.error).finally(() => prisma.$disconnect());
