const { PrismaClient } = require('@prisma/client');

// Sử dụng URL kết nối trực tiếp thực tế của Supabase (port 5432) để không bị nghẽn PgBouncer
const directUrl = "postgresql://postgres.wbiumzxlfvlzenyuykxe:trunghieu2003Hh%40@db.wbiumzxlfvlzenyuykxe.supabase.co:5432/postgres";
const prisma = new PrismaClient({
  datasources: {
    db: { url: directUrl }
  }
});

async function main() {
  console.log('🔍 Fetching users directly from Supabase...');
  const users = await prisma.user.findMany({
    select: {
      email: true,
      full_name: true,
      roles: true,
      is_active: true
    }
  });

  console.log(`📊 Total users fetched: ${users.length}`);

  const filtered = users.filter(u => {
    const fn = (u.full_name || '').toLowerCase();
    const em = (u.email || '').toLowerCase();
    return fn.includes('hiên') || fn.includes('hiển') || fn.includes('hiền') || em.includes('hien');
  });

  console.log('Results:', JSON.stringify(filtered, null, 2));
}

main()
  .catch(e => console.error('❌ Error:', e))
  .finally(() => prisma.$disconnect());
