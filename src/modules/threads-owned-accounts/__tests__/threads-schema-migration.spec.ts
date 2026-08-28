import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Bảng Threads từng chỉ được định nghĩa trong `manual_add_threads_scraper_tables.sql`.
 * CI chỉ áp `<timestamp>_.../migration.sql`, nên production không bao giờ nhận được định
 * nghĩa đó — trang Tổng quan kênh Threads trả 500:
 *
 *   The column `scraper_threads_profiles.url` does not exist in the current database.
 *
 * Chạy lại file manual KHÔNG cứu được: nó dùng `CREATE TABLE IF NOT EXISTS`, mà bảng trên
 * production đã tồn tại (chỉ thiếu cột) nên câu lệnh thành lệnh rỗng.
 *
 * Test này soát bất biến thật sự: mọi cột mà Prisma Client sẽ SELECT đều phải xuất hiện
 * trong một migration mà CI thực sự chạy. Thiếu một cột là đỏ, trước khi kịp lên production.
 */

const PRISMA_DIR = join(__dirname, '..', '..', '..', '..', 'prisma');
const MIGRATIONS_DIR = join(PRISMA_DIR, 'migrations');

const MODELS: Record<string, string> = {
  ScraperThreadsProfile: 'scraper_threads_profiles',
  ScraperThreadsPost: 'scraper_threads_posts',
};

/** Tên các model trong schema — dùng để loại field quan hệ (không phải cột trong DB). */
const modelNames = (schema: string): Set<string> =>
  new Set([...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]));

/** Cột thật của một model: bỏ chú thích, thuộc tính khối (@@) và field quan hệ. */
const columnsOf = (schema: string, model: string): string[] => {
  const block = schema.match(new RegExp(`^model\\s+${model}\\s*\\{([\\s\\S]*?)^\\}`, 'm'));
  if (!block) throw new Error(`Không tìm thấy model ${model} trong schema.prisma`);

  const relations = modelNames(schema);

  return block[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('@@'))
    .map((l) => l.split(/\s+/))
    .filter(([name, type]) => name && type && /^[a-z_][a-z0-9_]*$/.test(name))
    // Field quan hệ: kiểu là một model (kể cả dạng mảng `Model[]` hay optional `Model?`)
    .filter(([, type]) => !relations.has(type.replace(/[[\]?]/g, '')))
    .map(([name]) => name);
};

/**
 * Bóc chú thích `--` khỏi SQL.
 *
 * Không có bước này thì một cột chỉ được NHẮC TỚI trong chú thích cũng làm test xanh,
 * dù DDL thật không hề tạo cột đó — đúng loại dương tính giả khiến test vô dụng.
 */
const stripComments = (sql: string): string =>
  sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');

/** Chỉ những migration CI thực sự áp — `manual_*.sql` bị bỏ qua có chủ đích. */
const ciAppliedSql = (): string => {
  const files = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{14}_/.test(d.name))
    .map((d) => join(MIGRATIONS_DIR, d.name, 'migration.sql'));

  return files
    .map((f) => {
      try {
        return stripComments(readFileSync(f, 'utf8'));
      } catch {
        return '';
      }
    })
    .join('\n');
};

/** Các câu lệnh SQL có nhắc tới một bảng cụ thể. */
const statementsForTable = (sql: string, table: string): string =>
  sql
    .split(';')
    .filter((stmt) => stmt.includes(table))
    .join(';');

describe('Bảng Threads phải được định nghĩa bằng migration mà CI áp', () => {
  const schema = readFileSync(join(PRISMA_DIR, 'schema.prisma'), 'utf8');
  const sql = ciAppliedSql();

  it.each(Object.entries(MODELS))(
    '%s: mọi cột đều có trong `<timestamp>_.../migration.sql`',
    (model, table) => {
      const statements = statementsForTable(sql, table);
      const thieu = columnsOf(schema, model).filter(
        (col) => !new RegExp(`"${col}"`).test(statements),
      );
      expect(thieu).toEqual([]);
    },
  );

  it('không được để `manual_*.sql` là nơi duy nhất định nghĩa bảng Threads', () => {
    for (const table of Object.values(MODELS)) {
      expect(statementsForTable(sql, table)).not.toEqual('');
    }
  });

  it('migration vá lệch schema phải dùng ADD COLUMN, không phải CREATE TABLE IF NOT EXISTS', () => {
    // `CREATE TABLE IF NOT EXISTS` là lệnh rỗng khi bảng đã tồn tại — đúng cái bẫy đã khiến
    // production kẹt. Bản vá lệch schema bắt buộc phải đi bằng ALTER TABLE ... ADD COLUMN.
    for (const table of Object.values(MODELS)) {
      expect(statementsForTable(sql, table)).toMatch(/ADD COLUMN IF NOT EXISTS/i);
    }
  });
});
