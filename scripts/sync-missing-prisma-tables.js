/**
 * One-off schema catch-up helper.
 *
 * It creates ONLY the tables that are explicitly @@map()'d in prisma/schema.prisma
 * but missing in the target database. SQL is sourced from prisma/migrations/_diff_db_to_schema.sql
 * (generated earlier via `prisma migrate diff`).
 *
 * Usage (Mac/local):
 *   DIRECT_DATABASE_URL="postgresql://..." node scripts/sync-missing-prisma-tables.js
 */
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const ROOT = path.resolve(__dirname, '..')
const SCHEMA_PATH = path.join(ROOT, 'prisma', 'schema.prisma')
const DIFF_SQL_PATH = path.join(ROOT, 'prisma', 'migrations', '_diff_db_to_schema.sql')

function getMappedTablesFromSchema(schemaText) {
  const mapRe = /@@map\(\"([^\"]+)\"\)/g
  const out = new Set()
  let m
  while ((m = mapRe.exec(schemaText))) out.add(m[1])
  return out
}

function sqlEscapeIdent(ident) {
  // ident already comes from schema; keep it simple
  return `"${ident.replaceAll('"', '""')}"`
}

function makeCreateTableIfNotExists(createTableSql) {
  return createTableSql.replace(/^CREATE TABLE\s+"/m, 'CREATE TABLE IF NOT EXISTS "')
}

function makeCreateIndexIfNotExists(createIndexSql) {
  return createIndexSql.replace(/^CREATE (UNIQUE )?INDEX\s+"/m, (_m, unique) =>
    `CREATE ${unique || ''}INDEX IF NOT EXISTS "`,
  )
}

function extractCreateTableBlock(diffSql, tableName) {
  const needle = `CREATE TABLE "${tableName}" (`
  const start = diffSql.indexOf(needle)
  if (start === -1) return null
  const end = diffSql.indexOf('\n);', start)
  if (end === -1) return null
  return diffSql.slice(start, end + '\n);'.length)
}

function extractIndexStatementsForTable(diffSql, tableName) {
  // crude: find lines `CREATE ... INDEX ... ON "<tableName>"` and capture the full statement line
  // Works because diff output puts index DDL on single lines.
  const lines = diffSql.split('\n')
  const hits = []
  const onNeedle = ` ON "${tableName}"(`
  for (const line of lines) {
    if (line.startsWith('CREATE ') && line.includes(onNeedle)) {
      hits.push(line)
    }
  }
  return hits
}

async function main() {
  const url = process.env.DIRECT_DATABASE_URL
  if (!url) {
    throw new Error('DIRECT_DATABASE_URL is required')
  }

  const schemaText = fs.readFileSync(SCHEMA_PATH, 'utf8')
  const diffSql = fs.readFileSync(DIFF_SQL_PATH, 'utf8')

  const mappedTables = getMappedTablesFromSchema(schemaText)
  if (mappedTables.size === 0) {
    throw new Error('No @@map tables found in schema.prisma (unexpected)')
  }

  const client = new Client({ connectionString: url })
  await client.connect()

  const existingRes = await client.query(
    `select relname
     from pg_class c
     join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r'`,
  )
  const existing = new Set(existingRes.rows.map((r) => r.relname))

  const missing = [...mappedTables].filter((t) => !existing.has(t)).sort()
  console.log(`Mapped tables: ${mappedTables.size}`)
  console.log(`Existing tables: ${existing.size}`)
  console.log(`Missing mapped tables: ${missing.length}`)

  if (missing.length === 0) {
    console.log('Nothing to do.')
    await client.end()
    return
  }

  // Build DDL batch (tables first, then indexes).
  const tableDdls = []
  const indexDdls = []
  const skipped = []

  for (const t of missing) {
    const block = extractCreateTableBlock(diffSql, t)
    if (!block) {
      skipped.push(t)
      continue
    }
    tableDdls.push(makeCreateTableIfNotExists(block))

    for (const idx of extractIndexStatementsForTable(diffSql, t)) {
      indexDdls.push(makeCreateIndexIfNotExists(idx))
    }
  }

  console.log(`DDL tables to create: ${tableDdls.length}`)
  console.log(`DDL indexes to create: ${indexDdls.length}`)
  if (skipped.length) {
    console.log(`WARNING: missing SQL blocks for: ${skipped.join(', ')}`)
  }

  await client.query('BEGIN')
  try {
    for (const ddl of tableDdls) {
      await client.query(ddl)
    }
    for (const ddl of indexDdls) {
      await client.query(ddl)
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    await client.end()
  }

  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

