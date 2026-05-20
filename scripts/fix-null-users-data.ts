import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function runQuery(sql: string) {
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log(`✅ Success: ${sql}`);
  } catch (error: any) {
    console.log(`⚠️ Warning: ${sql} failed - ${error.message}`);
  }
}

async function main() {
  console.log('Fixing NULL user data and setting up trigger for shared users table...');

  // 1. Update existing null lark_record_id to use lark_employee_record_id, or generate a dummy one
  await runQuery(`
    UPDATE "users" 
    SET "lark_record_id" = COALESCE(
      NULLIF("lark_employee_record_id", ''), 
      'lark_gen_' || "id"::text
    )
    WHERE "lark_record_id" IS NULL OR "lark_record_id" = '';
  `);

  // 2. Update existing null raw_data
  await runQuery(`
    UPDATE "users" 
    SET "raw_data" = '{}'::jsonb 
    WHERE "raw_data" IS NULL;
  `);

  // 3. Create helper function and trigger
  await runQuery(`
    CREATE OR REPLACE FUNCTION clean_users_shared_fields()
    RETURNS TRIGGER AS $$
    BEGIN
        -- Copy lark_employee_record_id to lark_record_id if lark_record_id is null/empty
        IF NEW.lark_record_id IS NULL OR NEW.lark_record_id = '' THEN
            IF NEW.lark_employee_record_id IS NOT NULL AND NEW.lark_employee_record_id <> '' THEN
                NEW.lark_record_id := NEW.lark_employee_record_id;
            ELSE
                NEW.lark_record_id := 'lark_gen_' || NEW.id::text;
            END IF;
        END IF;

        -- Set raw_data to '{}' if null
        NEW.raw_data := COALESCE(NEW.raw_data, '{}'::jsonb);

        -- Set updated_at to NOW() if null
        NEW.updated_at := COALESCE(NEW.updated_at, NOW());

        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await runQuery(`
    DROP TRIGGER IF EXISTS trg_clean_users_shared_fields ON users;
  `);

  await runQuery(`
    CREATE TRIGGER trg_clean_users_shared_fields
    BEFORE INSERT OR UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION clean_users_shared_fields();
  `);

  console.log('Database fix complete!');
  await prisma.$disconnect();
}

main().catch(console.error);
