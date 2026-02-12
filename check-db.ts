
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const employees = await prisma.larkEmployee.findMany({
        take: 10
    });
    console.log('--- LarkEmployee Sample ---');
    employees.forEach(emp => {
        console.log(`Name: ${emp.name}, Position: ${emp.position}, EmployeeID: ${emp.employee_id}`);
    });

    const kpis = await prisma.larkKPI.findMany({
        take: 5
    });
    console.log('\n--- LarkKPI Sample ---');
    kpis.forEach(kpi => {
        console.log(`Name: ${kpi.name}, EmployeeID: ${kpi.employee_id}`);
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
