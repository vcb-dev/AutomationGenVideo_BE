/**
 * Restore characters from scripts/characters-backup.ts into DB (upsert by id + slug).
 */
import { PrismaClient } from '@prisma/client';
import { charactersBackup } from './characters-backup';

const prisma = new PrismaClient();

async function main() {
  console.log(`Restoring ${charactersBackup.length} character(s)...`);
  for (const row of charactersBackup) {
    const data = {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      avatar_url: row.avatar_url,
      system_prompt: row.system_prompt,
      is_active: row.is_active,
      order_index: row.order_index,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };

    const saved = await prisma.character.upsert({
      where: { id: data.id },
      create: data,
      update: {
        name: data.name,
        slug: data.slug,
        description: data.description,
        avatar_url: data.avatar_url,
        system_prompt: data.system_prompt,
        is_active: data.is_active,
        order_index: data.order_index,
        updated_at: data.updated_at,
      },
    });
    console.log(`OK: ${saved.slug} (${saved.id}) prompt_len=${saved.system_prompt.length}`);
  }
  const all = await prisma.character.findMany({
    select: { id: true, slug: true, name: true, is_active: true, order_index: true, updated_at: true },
    orderBy: { order_index: 'asc' },
  });
  console.log('characters now:', all);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
