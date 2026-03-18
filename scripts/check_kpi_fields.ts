
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const kpi = await prisma.larkKPI.findFirst();
    console.log('Sample record keys:', Object.keys(kpi || {}));
    
    // Check if the column exists in the model
    const dmmf = await (prisma)._dmmf;
    const model = dmmf.datamodel.models.find(m => m.name === 'LarkKPI');
    console.log('Model fields:', model.fields.map(f => f.name));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
