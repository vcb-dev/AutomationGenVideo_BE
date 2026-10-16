import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

/**
 * Tìm source ở cả 3 kho theo tên/link/code + tên/SKU sản phẩm liên kết.
 * Bỏ dấu + coi `-`/`_` là khoảng trắng vì tên source thường là slug không dấu; Prisma `contains`
 * không bỏ dấu được nên lọc bằng raw SQL rồi trả id để ghép vào `where`.
 */
const SOURCE_SEARCH = {
  global: {
    from: Prisma.raw('sources s LEFT JOIN products p ON p.id = s.product_id'),
    cols: ['s.name', 's.link', 's.code', 'p.name', 'p.sku'],
  },
  team: {
    from: Prisma.raw(
      'team_sources s LEFT JOIN team_products tp ON tp.id = s.team_product_id LEFT JOIN products p ON p.id = s.product_id',
    ),
    cols: ['s.name', 's.link', 's.code', 'tp.name', 'tp.sku', 'p.name', 'p.sku'],
  },
  editor: {
    from: Prisma.raw(
      'editor_sources s LEFT JOIN editor_products ep ON ep.id = s.editor_product_id LEFT JOIN products p ON p.id = s.product_id',
    ),
    cols: ['s.name', 's.link', 's.code', 'ep.name', 'ep.sku', 'p.name', 'p.sku'],
  },
} as const

/**
 * Trả id các source khớp từ khoá, hoặc null khi từ khoá rỗng (không lọc).
 * `scopeId` = team_id (kho team, bỏ trống = mọi team) / user_id (kho cá nhân), bỏ qua với kho tổng.
 */
export async function findSourceIdsBySearch(
  prisma: PrismaService,
  kho: keyof typeof SOURCE_SEARCH,
  search: string | undefined,
  scopeId?: string,
): Promise<string[] | null> {
  const term = search?.trim().replace(/\s+/g, ' ')
  if (!term) return null

  const { from, cols } = SOURCE_SEARCH[kho]
  const matches = Prisma.join(
    cols.map(
      (c) => Prisma.sql`strpos(lower(immutable_unaccent(translate(coalesce(${Prisma.raw(c)}, ''), '-_', '  '))), k.q) > 0`,
    ),
    ' OR ',
  )
  const scope =
    kho === 'team' ? (scopeId ? Prisma.sql`AND s.team_id = ${scopeId}::uuid` : Prisma.empty)
    : kho === 'editor' ? Prisma.sql`AND s.user_id = ${scopeId}`
    : Prisma.empty

  const query = Prisma.sql`
    SELECT s.id FROM ${from}
    CROSS JOIN (SELECT lower(immutable_unaccent(translate(${term}, '-_', '  '))) AS q) k
    WHERE (${matches}) ${scope}`
  const rows = await prisma.$queryRaw<{ id: string }[]>(query)
  return rows.map((r) => r.id)
}
