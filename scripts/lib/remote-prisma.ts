/// <reference types="node" />
import { PrismaClient } from '@prisma/client';

/** Optional direct/session URL (set SERVER_DATABASE_DIRECT_URL). Pooler 6543 is default. */
export function resolveAdminDbUrl(dbUrl: string): string {
  return process.env.SERVER_DATABASE_DIRECT_URL || process.env.DATABASE_DIRECT_URL || dbUrl;
}

export function getRemoteDbUrl(forAdmin = false): string {
  const url = process.env.SERVER_DATABASE_URL;
  if (!url) throw new Error('Missing SERVER_DATABASE_URL');
  return forAdmin ? resolveAdminDbUrl(url) : url;
}

function buildRemoteUrl(dbUrl: string): string {
  const timeoutOpt = encodeURIComponent('-c statement_timeout=120000 -c lock_timeout=30000');
  const sep = dbUrl.includes('?') ? '&' : '?';
  const isDirect = dbUrl.includes('db.') && dbUrl.includes('.supabase.co');
  const limit = isDirect ? '' : 'connection_limit=1&';
  return `${dbUrl}${sep}${limit}options=${timeoutOpt}`;
}

export async function withRemoteClient<T>(dbUrl: string, fn: (prisma: PrismaClient) => Promise<T>): Promise<T> {
  const prisma = new PrismaClient({ datasources: { db: { url: buildRemoteUrl(dbUrl) } } });
  try {
    await prisma.$connect();
    return await fn(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

export async function execRemoteSql(dbUrl: string, sql: string): Promise<void> {
  await withRemoteClient(dbUrl, async (prisma) => {
    await prisma.$executeRawUnsafe(sql);
  });
}

export async function truncateTables(dbUrl: string, tables: string[]): Promise<void> {
  if (!tables.length) return;
  await withRemoteClient(dbUrl, async (prisma) => {
    for (const table of tables) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}"`);
    }
  });
}

/**
 * Full replace: clear table + batched INSERT on one connection (no buffer, no UPSERT).
 * SYNC_SKIP_TRUNCATE=1 after wipe-remote-data.ts (table already empty).
 */
export async function replaceTableRows(
  dbUrl: string,
  table: string,
  columns: string,
  buildValuesSql: (row: unknown) => string,
  rows: unknown[],
  chunkSize = 50,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const skipTruncate = shouldSkipTableClear();

  if (!skipTruncate) {
    console.log(`🗑️  Clearing "${table}" (batched DELETE)...`);
    await deleteTableInBatches(dbUrl, table, 200, (n) =>
      console.log(`   → deleted ${n} rows from "${table}"`),
    );
    console.log(`🗑️  Cleared "${table}"`);
  } else {
    console.log(`⏭️  Skip clear "${table}" (SYNC_SKIP_TRUNCATE=1)`);
  }

  if (!rows.length) return;

  await withRemoteClient(dbUrl, async (prisma) => {
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const values = chunk.map((row) => buildValuesSql(row)).join(',');
      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '120000'`);
          await tx.$executeRawUnsafe(`INSERT INTO "${table}" (${columns}) VALUES ${values}`);
        },
        { timeout: 130_000 },
      );
      onProgress?.(Math.min(i + chunkSize, rows.length), rows.length);
    }
  });
}

/** Incremental: batched UPSERT on one connection. */
export async function upsertTableRows(
  dbUrl: string,
  table: string,
  columns: string,
  conflictColumn: string,
  buildValuesSql: (row: unknown) => string,
  rows: unknown[],
  updateSet: string,
  chunkSize = 50,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  if (!rows.length) return;

  await withRemoteClient(dbUrl, async (prisma) => {
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const values = chunk.map((row) => buildValuesSql(row)).join(',');
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${table}" (${columns}) VALUES ${values}
        ON CONFLICT ("${conflictColumn}") DO UPDATE SET ${updateSet}
      `);
      onProgress?.(Math.min(i + chunkSize, rows.length), rows.length);
    }
  });
}

export function isFullReplaceMode(): boolean {
  return process.env.SYNC_FULL_REPLACE === '1' || process.env.SYNC_FULL_REPLACE === 'true';
}

export function shouldSkipTableClear(): boolean {
  return process.env.SYNC_SKIP_TRUNCATE === '1' || process.env.SYNC_SKIP_TRUNCATE === 'true';
}

/** DELETE theo batch — tránh treo im lặng, giảm thời gian giữ lock. */
export async function deleteTableInBatches(
  dbUrl: string,
  table: string,
  batchSize = 200,
  onProgress?: (deleted: number) => void,
): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await withRemoteClient(dbUrl, async (prisma) => {
      return prisma.$executeRawUnsafe(`
        WITH doomed AS (SELECT ctid FROM "${table}" LIMIT ${batchSize})
        DELETE FROM "${table}" WHERE ctid IN (SELECT ctid FROM doomed)
      `);
    });
    const count = Number(n);
    if (count === 0) break;
    total += count;
    onProgress?.(total);
  }
  return total;
}
