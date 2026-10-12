import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

// Content gắn với sản phẩm = có task dùng cặp content + sản phẩm đó (suy từ tasks, không lưu riêng).
// Sản phẩm nhận theo SKU vì cùng SKU nằm ở nhiều kho; Product/TeamProduct có thể chỉ giữ FK tới bản gốc.

const PRODUCT_REF = { sku: true, name: true, image_url: true } as const

type ProductRef = { sku: string | null; name: string | null; image_url: string | null } | null | undefined

export interface LinkedProductRow {
  content_id: string | null
  team_content_id: string | null
  editor_content_id: string | null
  editor_product: ProductRef
  team_product: (NonNullable<ProductRef> & { source_editor_product: ProductRef }) | null
  product: (NonNullable<ProductRef> & {
    source_team_product: (NonNullable<ProductRef> & { source_editor_product: ProductRef }) | null
  }) | null
}

export interface LinkedProduct {
  sku: string
  name: string | null
  image_url: string | null
  content_count: number
}

export function taskProductSkuWhere(sku: string): Prisma.TaskWhereInput {
  const eq = { equals: sku.trim(), mode: Prisma.QueryMode.insensitive }
  return {
    OR: [
      { editor_product: { sku: eq } },
      { team_product: { sku: eq } },
      { team_product: { sku: null, source_editor_product: { sku: eq } } },
      { product: { sku: eq } },
      { product: { sku: null, source_team_product: { sku: eq } } },
      { product: { sku: null, source_team_product: { sku: null, source_editor_product: { sku: eq } } } },
    ],
  }
}

function resolveProductRef(row: LinkedProductRow) {
  const chain: ProductRef[] = row.editor_product
    ? [row.editor_product]
    : row.team_product
      ? [row.team_product, row.team_product.source_editor_product]
      : row.product
        ? [row.product, row.product.source_team_product, row.product.source_team_product?.source_editor_product]
        : []
  const sku = chain.find(r => r?.sku?.trim())?.sku?.trim()
  if (!sku) return null
  return {
    sku,
    name: chain.find(r => r?.name)?.name ?? null,
    image_url: chain.find(r => r?.image_url)?.image_url ?? null,
  }
}

export function groupLinkedProducts(rows: LinkedProductRow[]): LinkedProduct[] {
  const bySku = new Map<string, { sku: string; name: string | null; image_url: string | null; contents: Set<string> }>()
  for (const row of rows) {
    const contentId = row.content_id ?? row.team_content_id ?? row.editor_content_id
    const ref = resolveProductRef(row)
    if (!contentId || !ref) continue
    const key = ref.sku.toLowerCase()
    const entry = bySku.get(key) ?? { ...ref, contents: new Set<string>() }
    entry.name ??= ref.name
    entry.image_url ??= ref.image_url
    entry.contents.add(contentId)
    bySku.set(key, entry)
  }
  return [...bySku.values()]
    .map(({ contents, ...p }) => ({ ...p, content_count: contents.size }))
    .sort((a, b) => b.content_count - a.content_count || (a.name ?? a.sku).localeCompare(b.name ?? b.sku, 'vi'))
}

export async function listLinkedProducts(prisma: PrismaService, scope: Prisma.TaskWhereInput): Promise<LinkedProduct[]> {
  const rows = await prisma.task.findMany({
    where: {
      AND: [
        scope,
        { OR: [{ editor_product_id: { not: null } }, { team_product_id: { not: null } }, { product_id: { not: null } }] },
      ],
    },
    select: {
      content_id: true,
      team_content_id: true,
      editor_content_id: true,
      editor_product: { select: PRODUCT_REF },
      team_product: { select: { ...PRODUCT_REF, source_editor_product: { select: PRODUCT_REF } } },
      product: {
        select: {
          ...PRODUCT_REF,
          source_team_product: { select: { ...PRODUCT_REF, source_editor_product: { select: PRODUCT_REF } } },
        },
      },
    },
  })
  return groupLinkedProducts(rows)
}
