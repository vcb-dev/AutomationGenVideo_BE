
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function debugEmployeeImages() {
    const employees = await prisma.larkEmployee.findMany({
        take: 10,
    });

    console.log('--- Raw Employee Image URLs in DB ---');
    employees.forEach(emp => {
        console.log(`Name: ${emp.name}`);
        console.log(`Image URL: ${emp.image_url}`);
        console.log('-------------------');
    });
}

debugEmployeeImages()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
