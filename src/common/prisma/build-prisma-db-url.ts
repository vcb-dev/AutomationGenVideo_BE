/** Supabase / PgBouncer transaction pooler (port 6543) — pool server-side rất nhỏ. */
export function isPgBouncerUrl(dbUrl: string): boolean {
  if (!dbUrl) return false;
  try {
    const u = new URL(dbUrl.replace(/^postgresql:/, 'http:'));
    return (
      u.port === '6543' ||
      u.searchParams.get('pgbouncer') === 'true' ||
      u.hostname.includes('pooler.supabase.com')
    );
  } catch {
    return dbUrl.includes('6543') || dbUrl.includes('pgbouncer=true');
  }
}

export function buildPrismaDbUrl(
  dbUrl: string,
  opts?: { poolSize?: number; poolTimeout?: number; connectTimeout?: number },
): string {
  if (!dbUrl) return dbUrl;

  const pgbouncer = isPgBouncerUrl(dbUrl);
  const envPool = process.env.DB_POOL_SIZE ? parseInt(process.env.DB_POOL_SIZE, 10) : NaN;
  const poolSize =
    opts?.poolSize ??
    (Number.isFinite(envPool) && envPool > 0 ? envPool : pgbouncer ? 5 : 20);
  const poolTimeout = opts?.poolTimeout ?? (pgbouncer ? 20 : 30);
  const connectTimeout = opts?.connectTimeout ?? 10;

  const qIndex = dbUrl.indexOf('?');
  const base = qIndex >= 0 ? dbUrl.slice(0, qIndex) : dbUrl;
  const params = new URLSearchParams(qIndex >= 0 ? dbUrl.slice(qIndex + 1) : '');
  params.set('connection_limit', String(poolSize));
  params.set('pool_timeout', String(poolTimeout));
  params.set('connect_timeout', String(connectTimeout));
  return `${base}?${params.toString()}`;
}

/** Ephemeral client (mirror / direct sync) — 1 slot PgBouncer. */
export function buildScopedPrismaDbUrl(dbUrl: string): string {
  return buildPrismaDbUrl(dbUrl, { poolSize: 1, poolTimeout: 30 });
}

export function defaultPoolSizeForUrl(dbUrl: string): number {
  const pgbouncer = isPgBouncerUrl(dbUrl);
  const envPool = process.env.DB_POOL_SIZE ? parseInt(process.env.DB_POOL_SIZE, 10) : NaN;
  if (Number.isFinite(envPool) && envPool > 0) return envPool;
  return pgbouncer ? 5 : 20;
}
