import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function simulate() {
    const dateStr = "2026-03-16";
    const date = new Date(dateStr);
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const traffic = await prisma.larkTraffic.findFirst({
        where: {
            name: { contains: "Nguyễn Toán", mode: "insensitive" },
            date: { gte: startOfDay, lte: endOfDay }
        }
    });

    if (traffic) {
        console.log("FULL TRAFFIC DATA:");
        for (const [key, val] of Object.entries(traffic)) {
           if (val !== null && val !== undefined) console.log(`${key}: ${val}`);
        }
    } else {
        console.log("No traffic found for Nguyễn Toán on 16/03/2026");
    }

    await prisma.$disconnect();
}
simulate();
