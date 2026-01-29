import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function assignEditorsToManager() {
  try {
    console.log('🔄 Starting to assign editors to manager...');
    
    const managerId = '38711093-5494-4b55-bf79-1364092dc04c';
    
    // Update all EDITOR users to have this manager
    const result = await prisma.user.updateMany({
      where: {
        role: 'EDITOR',
        manager_id: null,
      },
      data: {
        manager_id: managerId,
      },
    });
    
    console.log(`✅ Updated ${result.count} editors with manager_id`);
    
    // Show the updated editors
    const editors = await prisma.user.findMany({
      where: {
        role: 'EDITOR',
        manager_id: managerId,
      },
      select: {
        id: true,
        email: true,
        full_name: true,
        manager_id: true,
      },
    });
    
    console.log('📝 Editors now assigned to manager:');
    editors.forEach(editor => {
      console.log(`  - ${editor.email} (${editor.full_name})`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

assignEditorsToManager();
