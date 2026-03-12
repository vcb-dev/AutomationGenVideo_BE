const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const tasks = await prisma.larkListTask.findMany({
        where: { employee_name: { in: ['Bùi Đức Chung', 'Việt Ngô'] } },
        distinct: ['employee_name', 'team'],
        take: 10
    });
    console.log(tasks.map(k => ({ name: k.employee_name, team: k.team })));
}
main().finally(() => prisma.$disconnect());
