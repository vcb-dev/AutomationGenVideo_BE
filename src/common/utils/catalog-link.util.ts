import { PrismaService } from '../prisma/prisma.service'

/**
 * Mã source (Source.code / TeamSource.code / EditorSource.code) và mã sản phẩm
 * (Product.sku / TeamProduct.sku / EditorProduct.sku) là cùng một mã kinh doanh —
 * các hàm dưới đây tự động khớp và liên kết hai chiều theo mã đó, so khớp
 * trim + không phân biệt hoa/thường.
 */

function normalizeCode(code?: string | null): string | null {
  const trimmed = code?.trim()
  return trimmed ? trimmed : null
}

/** Tìm Product ở kho tổng có sku trùng mã (không giới hạn phạm vi). */
export async function findProductBySku(prisma: PrismaService, code?: string | null) {
  const normalized = normalizeCode(code)
  if (!normalized) return null
  return prisma.product.findFirst({ where: { sku: { equals: normalized, mode: 'insensitive' } } })
}

/** Tìm TeamProduct cùng team có sku trùng mã. */
export async function findTeamProductBySku(prisma: PrismaService, teamId: string, code?: string | null) {
  const normalized = normalizeCode(code)
  if (!normalized) return null
  return prisma.teamProduct.findFirst({
    where: { team_id: teamId, sku: { equals: normalized, mode: 'insensitive' } },
  })
}

/** Tìm EditorProduct của user có sku trùng mã. */
export async function findEditorProductBySku(prisma: PrismaService, userId: string, code?: string | null) {
  const normalized = normalizeCode(code)
  if (!normalized) return null
  return prisma.editorProduct.findFirst({
    where: { user_id: userId, sku: { equals: normalized, mode: 'insensitive' } },
  })
}

/**
 * Khi 1 Product mới được tạo ở kho tổng, quét ngược mọi Source/TeamSource/EditorSource
 * (không giới hạn team/user nào) đang có code trùng sku và chưa được liên kết
 * (product_id = null) để tự liên kết — đây là trục "liên kết chéo" cho engine auto-assign.
 */
export async function backfillSourcesForNewGlobalProduct(
  prisma: PrismaService,
  sku: string | null | undefined,
  productId: string,
) {
  const normalized = normalizeCode(sku)
  if (!normalized) return
  const where = { code: { equals: normalized, mode: 'insensitive' as const }, product_id: null }
  await Promise.all([
    prisma.source.updateMany({ where, data: { product_id: productId } }),
    prisma.teamSource.updateMany({ where, data: { product_id: productId } }),
    prisma.editorSource.updateMany({ where, data: { product_id: productId } }),
  ])
}

/** Khi 1 TeamProduct mới được tạo, quét ngược TeamSource cùng team đang treo (chưa gán team_product_id) trùng mã. */
export async function backfillTeamSourcesForNewTeamProduct(
  prisma: PrismaService,
  teamId: string,
  sku: string | null | undefined,
  teamProductId: string,
) {
  const normalized = normalizeCode(sku)
  if (!normalized) return
  await prisma.teamSource.updateMany({
    where: { team_id: teamId, code: { equals: normalized, mode: 'insensitive' }, team_product_id: null },
    data: { team_product_id: teamProductId },
  })
}

/** Khi 1 EditorProduct mới được tạo, quét ngược EditorSource cùng user đang treo (chưa gán editor_product_id) trùng mã. */
export async function backfillEditorSourcesForNewEditorProduct(
  prisma: PrismaService,
  userId: string,
  sku: string | null | undefined,
  editorProductId: string,
) {
  const normalized = normalizeCode(sku)
  if (!normalized) return
  await prisma.editorSource.updateMany({
    where: { user_id: userId, code: { equals: normalized, mode: 'insensitive' }, editor_product_id: null },
    data: { editor_product_id: editorProductId },
  })
}
