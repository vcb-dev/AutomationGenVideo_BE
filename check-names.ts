
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const name1 = "Tuân Nguyễn";
    const name2 = "Van Lien";
    const name3 = "Đỗ Thị Nga";

    console.log('--- Searching for specific names in LarkKPI ---');
    const kpis = await prisma.larkKPI.findMany({
        where: {
            OR: [
                { name: { contains: "Tuân" } },
                { name: { contains: "Van" } },
                { name: { contains: "Nga" } }
            ]
        }
    });
    kpis.forEach(kpi => {
        console.log(`KPI Name: [${kpi.name}], EmployeeID: [${kpi.employee_id}]`);
    });

    console.log('\n--- Searching for specific names in LarkEmployee ---');
    const emps = await prisma.larkEmployee.findMany({
        where: {
            OR: [
                { name: { contains: "Tuân" } },
                { name: { contains: "Van" } },
                { name: { contains: "Nga" } }
            ]
        }
    });
    emps.forEach(emp => {
        console.log(`Emp Name: [${emp.name}], Position: [${emp.position}], EmployeeID: [${emp.employee_id}]`);
    });
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
