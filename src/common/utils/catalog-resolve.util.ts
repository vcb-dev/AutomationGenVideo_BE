import { PrismaService } from '../prisma/prisma.service'

/**
 * Product/Content ở "kho tổng" có thể chỉ là bản ghi rỗng giữ FK tới TeamProduct/TeamContent
 * (khi được đẩy lên từ kho team — xem cột source_team_product_id/source_team_content_id trong
 * schema.prisma), và TeamProduct/TeamContent đó tự nó cũng có thể chỉ giữ FK tới
 * EditorProduct/EditorContent (khi được đẩy từ kho cá nhân). Đọc thẳng cột của bản ghi gốc trong
 * các trường hợp này ra dữ liệu rỗng — phải đi xuyên chuỗi FK để lấy dữ liệu thực.
 */

export async function resolveProductSnapshot(prisma: PrismaService, productId: string) {
  const src = await prisma.product.findUnique({
    where: { id: productId },
    include: { source_team_product: { include: { source_editor_product: true } } },
  })
  if (!src) return null
  const tp = src.source_team_product
  const ep = tp?.source_editor_product

  return {
    id: src.id,
    sku: src.sku ?? tp?.sku ?? ep?.sku ?? null,
    name: src.name ?? tp?.name ?? ep?.name ?? null,
    brand_type: src.brand_type,
    image_url: src.image_url ?? tp?.image_url ?? ep?.image_url ?? null,
    image_urls: src.image_urls.length ? src.image_urls : tp?.image_urls.length ? tp.image_urls : (ep?.image_urls ?? []),
    price: src.price ?? tp?.price ?? ep?.price ?? null,
    market: src.market ?? tp?.market ?? ep?.market ?? null,
    price_segment: src.price_segment ?? tp?.price_segment ?? ep?.price_segment ?? null,
    priority_score: src.priority_score,
    cooldown_days: src.cooldown_days,
    material_id: src.material_id ?? tp?.material_id ?? ep?.material_id ?? null,
    product_line_id: src.product_line_id ?? tp?.product_line_id ?? ep?.product_line_id ?? null,
    classification_id: src.classification_id ?? tp?.classification_id ?? ep?.classification_id ?? null,
    is_active: src.is_active,
  }
}

export async function resolveContentSnapshot(prisma: PrismaService, contentId: string) {
  const src = await prisma.content.findUnique({
    where: { id: contentId },
    include: { source_team_content: { include: { source_editor_content: true } } },
  })
  if (!src) return null
  const tc = src.source_team_content
  const ec = tc?.source_editor_content

  return {
    id: src.id,
    brand_type: src.brand_type,
    market: src.market,
    title: src.title ?? tc?.title ?? ec?.title ?? null,
    body: src.body ?? tc?.body ?? ec?.body ?? null,
    script: src.script ?? tc?.script ?? ec?.script ?? null,
    file_content_url: src.file_content_url ?? tc?.file_content_url ?? ec?.file_content_url ?? null,
    voice_url: src.voice_url ?? tc?.voice_url ?? ec?.voice_url ?? null,
    content_line_id: src.content_line_id ?? tc?.content_line_id ?? ec?.content_line_id ?? null,
    classification_id: src.classification_id ?? tc?.classification_id ?? ec?.classification_id ?? null,
  }
}
