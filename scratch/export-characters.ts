import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const prisma = new PrismaClient();

const OUTPUT_PATH =
  'C:\\Users\\Admin\\AppData\\Local\\Temp\\claude\\c--AutomationGenVideo\\b179303e-6362-41c7-805c-e55bddf5efd9\\scratchpad\\characters-backup.ts';

// ECMAScript chuẩn hóa mọi CR/CRLF *literal* trong template string thành LF khi engine
// parse/thực thi. Escape \r thành chuỗi "\r" tường minh (backslash + r) để giữ đúng \r\n
// gốc nếu file này từng được require/eval lại — escape sequence không bị chuẩn hóa.
function toTemplateLiteral(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
  return `\`${escaped}\``;
}

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (value instanceof Date) return `new Date(${JSON.stringify(value.toISOString())})`;
  if (typeof value === 'string') return toTemplateLiteral(value);
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

async function main() {
  const characters = await prisma.character.findMany();

  console.log(`Tổng số bản ghi lấy từ Supabase: ${characters.length}`);
  for (const c of characters) {
    console.log(`  - ${c.name} (slug: ${c.slug}) -> system_prompt: ${c.system_prompt.length} ky tu`);
  }

  const recordsSource = characters
    .map((c) => {
      const fields = Object.entries(c)
        .map(([key, value]) => `    ${key}: ${formatValue(value)},`)
        .join('\n');
      return `  {\n${fields}\n  }`;
    })
    .join(',\n');

  const now = new Date();
  const fileContent = `// Export toàn bộ dữ liệu bảng "characters" (model Character)
// Thời điểm export: ${now.toISOString()}
// Tổng số bản ghi: ${characters.length}

export const charactersBackup = [
${recordsSource}
];
`;

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, fileContent, 'utf-8');

  console.log(`Đã export ${characters.length} bản ghi ra: ${OUTPUT_PATH}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
