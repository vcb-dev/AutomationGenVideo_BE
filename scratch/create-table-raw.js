const { Client } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

async function main() {
  const connectionString = process.env.DATABASE_URL;
  console.log('Connecting to database using native pg client (autocommit mode)...');
  
  const client = new Client({ connectionString });
  await client.connect();
  
  try {
    console.log('1. Creating table video_scores...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS "video_scores" (
        "id" TEXT NOT NULL,
        "content_video_id" TEXT NOT NULL,
        "scored_by_id" TEXT NOT NULL,
        "score_hook" DOUBLE PRECISION NOT NULL,
        "score_content" DOUBLE PRECISION NOT NULL,
        "score_editing" DOUBLE PRECISION NOT NULL,
        "score_cta" DOUBLE PRECISION NOT NULL,
        "score_thumbnail" DOUBLE PRECISION NOT NULL,
        "score_total" DOUBLE PRECISION NOT NULL,
        "comment" TEXT,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "video_scores_pkey" PRIMARY KEY ("id")
      );
    `);
    console.log('   ✓ Table created successfully!');

    console.log('2. Creating unique index...');
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "video_scores_content_video_id_scored_by_id_key" 
      ON "video_scores"("content_video_id", "scored_by_id");
    `);
    console.log('   ✓ Unique index created!');
    
    console.log('3. Adding foreign key content_video_id...');
    try {
      await client.query(`
        ALTER TABLE "video_scores" 
        ADD CONSTRAINT "video_scores_content_video_id_fkey" 
        FOREIGN KEY ("content_video_id") REFERENCES "content_videos"("id") 
        ON DELETE CASCADE ON UPDATE CASCADE;
      `);
      console.log('   ✓ Foreign key content_video_id added!');
    } catch (err) {
      console.log('   ℹ Foreign key content_video_id might already exist:', err.message);
    }

    console.log('4. Adding foreign key scored_by_id...');
    try {
      await client.query(`
        ALTER TABLE "video_scores" 
        ADD CONSTRAINT "video_scores_scored_by_id_fkey" 
        FOREIGN KEY ("scored_by_id") REFERENCES "users"("id") 
        ON DELETE CASCADE ON UPDATE CASCADE;
      `);
      console.log('   ✓ Foreign key scored_by_id added!');
    } catch (err) {
      console.log('   ℹ Foreign key scored_by_id might already exist:', err.message);
    }
    
    console.log('5. Querying table row count...');
    const resCount = await client.query('SELECT count(*) FROM "video_scores";');
    console.log('   ✓ Query success! Rows count:', resCount.rows[0].count);
    console.log('🎉 Done! All DDL statements successfully applied and autocommitted.');
  } catch (err) {
    console.error('✗ SQL execution failed:', err.message);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
