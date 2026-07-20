import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const TARGET_DB_URL = process.env.SERVER_DATABASE_URL || process.env.DATABASE_URL;

async function main() {
  if (!TARGET_DB_URL) {
    console.error('❌ DATABASE_URL or SERVER_DATABASE_URL is not set.');
    process.exit(1);
  }

  console.log('Connecting to database...');
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: TARGET_DB_URL,
      },
    },
  });

  try {
    // 1. Add parent_id to social_accounts if not exists
    console.log('Checking for parent_id in social_accounts...');
    const parentIdCheck = await prisma.$queryRawUnsafe(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='social_accounts' AND column_name='parent_id';
    `);

    if (Array.isArray(parentIdCheck) && parentIdCheck.length === 0) {
      console.log('Adding parent_id column to social_accounts...');
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "social_accounts" ADD COLUMN "parent_id" TEXT;
      `);
      console.log('Adding foreign key constraint for parent_id...');
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "social_accounts" 
        ADD CONSTRAINT "social_accounts_parent_id_fkey" 
        FOREIGN KEY ("parent_id") REFERENCES "social_accounts"("id") ON DELETE SET NULL;
      `);
      console.log('Creating index on parent_id...');
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "social_accounts_parent_id_idx" ON "social_accounts"("parent_id");
      `);
      console.log('✅ Added parent_id column successfully.');
    } else {
      console.log('👍 parent_id column already exists.');
    }

    // 2. Add thumb_url to social_posts if not exists
    console.log('Checking for thumb_url in social_posts...');
    const thumbUrlCheck = await prisma.$queryRawUnsafe(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='social_posts' AND column_name='thumb_url';
    `);

    if (Array.isArray(thumbUrlCheck) && thumbUrlCheck.length === 0) {
      console.log('Adding thumb_url column to social_posts...');
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "social_posts" ADD COLUMN "thumb_url" TEXT;
      `);
      console.log('✅ Added thumb_url column to social_posts successfully.');
    } else {
      console.log('👍 thumb_url column already exists in social_posts.');
    }

    // 3. Add thumb_url to social_drafts if not exists
    console.log('Checking for thumb_url in social_drafts...');
    const draftThumbUrlCheck = await prisma.$queryRawUnsafe(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='social_drafts' AND column_name='thumb_url';
    `);

    if (Array.isArray(draftThumbUrlCheck) && draftThumbUrlCheck.length === 0) {
      console.log('Adding thumb_url column to social_drafts...');
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "social_drafts" ADD COLUMN "thumb_url" TEXT;
      `);
      console.log('✅ Added thumb_url column to social_drafts successfully.');
    } else {
      console.log('👍 thumb_url column already exists in social_drafts.');
    }

    // 4. Create social_oauth_states table if not exists
    console.log('Checking for social_oauth_states table...');
    const tableCheck = await prisma.$queryRawUnsafe(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name='social_oauth_states';
    `);

    if (Array.isArray(tableCheck) && tableCheck.length === 0) {
      console.log('Creating social_oauth_states table...');
      await prisma.$executeRawUnsafe(`
        CREATE TABLE "social_oauth_states" (
          "id" TEXT NOT NULL,
          "user_id" TEXT NOT NULL,
          "platform" TEXT NOT NULL,
          "expires_at" TIMESTAMPTZ NOT NULL,
          "tiktok_verifier" TEXT,
          "zalo_verifier" TEXT,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT "social_oauth_states_pkey" PRIMARY KEY ("id")
        );
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "social_oauth_states_expires_at_idx" ON "social_oauth_states"("expires_at");
      `);
      console.log('✅ Created social_oauth_states table successfully.');
    } else {
      console.log('👍 social_oauth_states table already exists.');
    }

    console.log('✨ All schema patches applied successfully!');
  } catch (error) {
    console.error('❌ Schema patch failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
