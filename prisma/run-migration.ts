import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Tạo bảng social_media_files...');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS social_media_files (
      id          TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
      post_id     TEXT,
      filename    TEXT        NOT NULL UNIQUE,
      mimetype    TEXT        NOT NULL DEFAULT 'video/mp4',
      size        INTEGER     NOT NULL,
      data        BYTEA       NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_social_media_files_post
        FOREIGN KEY (post_id) REFERENCES social_posts(id) ON DELETE SET NULL
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_social_media_files_post_id ON social_media_files(post_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_social_media_files_filename ON social_media_files(filename)
  `);

  console.log('✅ Xong! Bảng social_media_files đã được tạo.');
}

main()
  .catch((e) => { console.error('❌ Lỗi:', e.message); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
