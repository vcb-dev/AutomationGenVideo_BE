import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const prisma = new PrismaClient();

const SOURCE_PATH =
  'C:\\Users\\Admin\\AppData\\Local\\Temp\\claude\\c--AutomationGenVideo\\b179303e-6362-41c7-805c-e55bddf5efd9\\scratchpad\\file_prompt.txt';

async function main() {
  const original = fs.readFileSync(SOURCE_PATH, 'utf-8');
  console.log(`Đọc từ file: ${original.length} ký tự, ${(original.match(/\r\n/g) || []).length} chỗ CRLF`);

  if (original.length !== 29424) {
    throw new Error(`Độ dài không khớp 29424, dừng lại để tránh ghi sai. Thực tế: ${original.length}`);
  }

  const updated = await prisma.character.update({
    where: { slug: 'huyk' },
    data: { system_prompt: original },
  });

  console.log(`Đã ghi lại vào Supabase. Độ dài sau khi update (theo object trả về): ${updated.system_prompt.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
