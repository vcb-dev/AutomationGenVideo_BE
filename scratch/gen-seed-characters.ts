import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { toTemplateLiteral, toConstName } from '../src/common/utils/character-export.util';

dotenv.config();

const prisma = new PrismaClient();

const OUTPUT_PATH = path.resolve(__dirname, '../prisma/seed-characters.ts');

async function main() {
  const characters = await prisma.character.findMany({ orderBy: { order_index: 'asc' } });

  console.log(`Tổng số nhân vật lấy từ Supabase: ${characters.length}`);
  for (const c of characters) {
    console.log(`  - ${c.name} (slug: ${c.slug}) -> system_prompt: ${c.system_prompt.length} ky tu`);
  }

  const promptConsts = characters
    .map((c) => {
      const constName = toConstName(c.slug);
      return `const ${constName} = ${toTemplateLiteral(c.system_prompt)};`;
    })
    .join('\n\n');

  const upserts = characters
    .map((c) => {
      const constName = toConstName(c.slug);
      const descLiteral = c.description === null ? 'null' : toTemplateLiteral(c.description);
      const avatarLiteral = c.avatar_url === null ? 'null' : toTemplateLiteral(c.avatar_url);
      return `  await prisma.character.upsert({
    where: { slug: ${toTemplateLiteral(c.slug)} },
    update: {
      system_prompt: ${constName},
      description: ${descLiteral},
    },
    create: {
      name: ${toTemplateLiteral(c.name)},
      slug: ${toTemplateLiteral(c.slug)},
      description: ${descLiteral},
      avatar_url: ${avatarLiteral},
      system_prompt: ${constName},
      is_active: ${c.is_active},
      order_index: ${c.order_index},
    },
  });`;
    })
    .join('\n\n');

  const fileContent = `import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

${promptConsts}

async function main() {
${upserts}

  console.log('✅ Seed characters hoàn tất');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
`;

  fs.writeFileSync(OUTPUT_PATH, fileContent, 'utf-8');
  console.log(`\nĐã ghi file: ${OUTPUT_PATH}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
