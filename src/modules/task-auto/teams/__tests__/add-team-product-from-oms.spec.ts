import { TaskAutoTeamsService } from '../teams.service'
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'

/**
 * addTeamProduct() nhánh oms_variant_id (leader kéo sản phẩm từ kho tổng OMS về kho team) và
 * refreshTeamProductFromOms() (làm mới sku/tên/giá/ảnh theo dữ liệu mới nhất từ OMS) — 2 điểm
 * validate quan trọng: không cho kéo trùng 1 variant OMS vào cùng 1 team (unique [team_id,
 * oms_variant_id] ở DB), và không cho "làm mới" 1 sản phẩm không có nguồn gốc OMS.
 */
describe('TaskAutoTeamsService — OMS product sync', () => {
  const team = { id: 'team-1', leader_id: 'leader-1', members: [{ user_id: 'leader-1' }] }
  const sampleVariant = { id: 'var-1', sku: 'SKU-NEW', price: 150000, image_url: null }
  const sampleProduct = { id: 'prod-1', name: 'Áo thun basic', image_url: null, images: [] }

  function build(opts: { dupOmsVariant?: any; existingSku?: any } = {}) {
    const created: any[] = []
    const prisma: any = {
      team: { findUnique: jest.fn(async () => team) },
      teamProduct: {
        findFirst: jest.fn(async (args: any) => {
          if (args.where.oms_variant_id !== undefined) return opts.dupOmsVariant ?? null
          if (args.where.sku !== undefined) return opts.existingSku ?? null
          return null
        }),
        create: jest.fn(async (args: any) => { created.push(args); return { id: 'tp-new', ...args.data } }),
        update: jest.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
      },
      teamSource: { updateMany: jest.fn(async () => ({ count: 0 })) },
    }
    const oms: any = { getProductVariant: jest.fn(async () => ({ product: sampleProduct, variant: sampleVariant })) }
    const service = new TaskAutoTeamsService(prisma, oms)
    return { service, prisma, oms, created }
  }

  afterEach(() => jest.clearAllMocks())

  it('kéo sản phẩm OMS mới về kho team thành công', async () => {
    const { service, oms, created } = build()

    const result = await service.addTeamProduct(
      'team-1',
      { oms_product_id: 'prod-1', oms_variant_id: 'var-1', brand_type: 'DO_DA' } as any,
      'leader-1',
      ['LEADER'],
    )

    expect(oms.getProductVariant).toHaveBeenCalledWith('prod-1', 'var-1')
    expect(created[0].data).toEqual(
      expect.objectContaining({ team_id: 'team-1', oms_product_id: 'prod-1', oms_variant_id: 'var-1', sku: 'SKU-NEW' }),
    )
    expect(result).toEqual(expect.objectContaining({ id: 'tp-new' }))
  })

  it('thiếu oms_product_id kèm oms_variant_id → báo lỗi rõ ràng, không gọi OMS', async () => {
    const { service, oms } = build()

    await expect(
      service.addTeamProduct('team-1', { oms_variant_id: 'var-1', brand_type: 'DO_DA' } as any, 'leader-1', ['LEADER']),
    ).rejects.toThrow(BadRequestException)
    expect(oms.getProductVariant).not.toHaveBeenCalled()
  })

  it('variant OMS đã được kéo vào team này rồi → ConflictException, không tạo trùng', async () => {
    const { service, oms } = build({ dupOmsVariant: { id: 'tp-existing' } })

    await expect(
      service.addTeamProduct('team-1', { oms_product_id: 'prod-1', oms_variant_id: 'var-1', brand_type: 'DO_DA' } as any, 'leader-1', ['LEADER']),
    ).rejects.toThrow(ConflictException)
    expect(oms.getProductVariant).not.toHaveBeenCalled()
  })

  it('thiếu brand_type khi kéo từ OMS → BadRequestException', async () => {
    const { service } = build()

    await expect(
      service.addTeamProduct('team-1', { oms_product_id: 'prod-1', oms_variant_id: 'var-1' } as any, 'leader-1', ['LEADER']),
    ).rejects.toThrow(BadRequestException)
  })

  it('SKU của variant OMS đã tồn tại trong kho team (thêm thủ công trước đó) → Conflict', async () => {
    const { service } = build({ existingSku: { id: 'tp-other' } })

    await expect(
      service.addTeamProduct('team-1', { oms_product_id: 'prod-1', oms_variant_id: 'var-1', brand_type: 'DO_DA' } as any, 'leader-1', ['LEADER']),
    ).rejects.toThrow(ConflictException)
  })

  describe('refreshTeamProductFromOms', () => {
    it('làm mới sku/tên/giá/ảnh theo dữ liệu OMS mới nhất, giữ nguyên field nghiệp vụ', async () => {
      const { service, prisma } = build()
      const entry = { id: 'tp-1', team_id: 'team-1', sku: 'SKU-OLD', oms_product_id: 'prod-1', oms_variant_id: 'var-1' }
      // findFirst dùng cho 2 việc khác nhau trong refreshTeamProductFromOms(): tra entry theo id,
      // rồi check SKU mới (của variant OMS) có bị trùng sản phẩm khác trong team không (where.sku).
      prisma.teamProduct.findFirst = jest.fn(async (args: any) =>
        args.where.id !== undefined ? entry : null,
      )

      const result = await service.refreshTeamProductFromOms('team-1', 'tp-1', 'leader-1', ['LEADER'])

      expect(prisma.teamProduct.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tp-1' },
          data: expect.objectContaining({ sku: 'SKU-NEW', name: 'Áo thun basic', price: 150000 }),
        }),
      )
      expect(result).toEqual(expect.objectContaining({ sku: 'SKU-NEW' }))
    })

    it('sản phẩm không có nguồn gốc OMS (thêm thủ công) → không cho làm mới', async () => {
      const { service, prisma } = build()
      prisma.teamProduct.findFirst = jest.fn(async () => ({ id: 'tp-1', team_id: 'team-1', sku: 'SKU-X', oms_product_id: null, oms_variant_id: null }))

      await expect(service.refreshTeamProductFromOms('team-1', 'tp-1', 'leader-1', ['LEADER'])).rejects.toThrow(
        BadRequestException,
      )
    })

    it('sản phẩm không tồn tại trong kho team → NotFoundException', async () => {
      const { service, prisma } = build()
      prisma.teamProduct.findFirst = jest.fn(async () => null)

      await expect(service.refreshTeamProductFromOms('team-1', 'tp-missing', 'leader-1', ['LEADER'])).rejects.toThrow(
        NotFoundException,
      )
    })
  })
})
