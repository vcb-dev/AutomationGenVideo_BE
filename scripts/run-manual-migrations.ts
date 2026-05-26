import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function runSqlFile(filePath: string) {
  console.log(`Running SQL file: ${filePath}`);
  const sql = fs.readFileSync(filePath, 'utf8');
  
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log(`Successfully executed ${filePath}`);
  } catch (error) {
    console.error(`Error executing ${filePath}:`, error.message);
    
    // Fallback: try to split by semicolon (naive)
    console.log("Attempting to run statement by statement...");
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
      
    for (const statement of statements) {
      try {
        await prisma.$executeRawUnsafe(statement);
      } catch (stmtError) {
        console.warn(`Warning: Failed statement: ${statement.slice(0, 50)}...`);
        console.warn(`Reason: ${stmtError.message}`);
      }
    }
  }
}

async function main() {
  const files = [
    'scripts/manual_update.sql'
  ];

  for (const file of files) {
    const fullPath = path.resolve(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      await runSqlFile(fullPath);
    } else {
      console.warn(`File not found: ${file}`);
    }
  }
  
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
