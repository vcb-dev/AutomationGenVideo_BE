import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { toTemplateLiteral } from '../src/common/utils/character-export.util';

dotenv.config();

const prisma = new PrismaClient();

const OUTPUT_PATH = path.resolve(__dirname, '../prisma/scratch/characters-export.ts');

function formatValue(value: unknown, field: string): string {
  if (value === null) return 'null';
  if (value instanceof Date) return `new Date(${JSON.stringify(value.toISOString())})`;
  if (typeof value === 'string') return toTemplateLiteral(value);
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  throw new Error(`Không xử lý được kiểu dữ liệu của field "${field}": ${typeof value}`);
}

async function main() {
  const characters = await prisma.character.findMany({ orderBy: { order_index: 'asc' } });

  console.log(`Tổng số nhân vật lấy từ Supabase: ${characters.length}`);
  for (const c of characters) {
    console.log(`  - ${c.name} (slug: ${c.slug}) -> system_prompt: ${c.system_prompt.length} ky tu`);
  }

  const recordsSource = characters
    .map((c) => {
      const fields = Object.entries(c)
        .map(([key, value]) => `    ${key}: ${formatValue(value, key)},`)
        .join('\n');
      return `  {\n${fields}\n  }`;
    })
    .join(',\n');

  const now = new Date();
  const fileContent = `// Export toàn bộ dữ liệu bảng "characters" (model Character) trực tiếp từ Supabase.
// KHÔNG phải seed script — chỉ là bản chụp dữ liệu tham khảo, không có logic upsert/thực thi.
// Thời điểm export: ${now.toISOString()}
// Tổng số bản ghi: ${characters.length}

export interface Character {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatar_url: string | null;
  system_prompt: string;
  is_active: boolean;
  order_index: number;
  created_at: Date;
  updated_at: Date;
}

export const charactersData: Character[] = [
${recordsSource}
];
`;

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
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
