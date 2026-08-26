import { TaskAutoTasksService } from '../tasks.service'
import { BadRequestException } from '@nestjs/common'

/**
 * create() với oms_variant_id (chọn sản phẩm trực tiếp từ kho tổng OMS, không qua Product local):
 * nếu đã biết assignee ngay lúc tạo thì materialize luôn thành 1 EditorProduct trong kho cá nhân
 * họ; nếu chưa (task PENDING) thì tạm giữ oms_product_id/oms_variant_id trên Task, materialize
 * sau ở update() khi assignee được set lần đầu (xem [[find-or-create-editor-product-from-oms]]).
 */
describe('TaskAutoTasksService.create — chọn sản phẩm từ OMS', () => {
  const sampleVariant = { id: 'var-1', sku: 'SKU-OMS-1', price: 90000, image_url: null }
  const sampleProduct = { id: 'prod-1', name: 'Vòng tay bạc', image_url: null, images: [] }

  function build(opts: { existingEditorProduct?: any; skuTaken?: any } = {}) {
    const prisma: any = {
      team: { findUnique: jest.fn(async () => ({ id: 'team-1', name: 'Team 1', brand_type: 'TRANG_SUC' })) },
      content: { findUnique: jest.fn(async () => ({ content_line_id: 'cl-1' })) },
      teamMember: { findFirst: jest.fn(async () => ({ team_id: 'team-1' })) },
      editorProduct: {
        findFirst: jest.fn(async (args: any) => {
          if (args.where.oms_variant_id !== undefined) return opts.existingEditorProduct ?? null
          if (args.where.sku !== undefined) return opts.skuTaken ?? null
          return null
        }),
        create: jest.fn(async (args: any) => ({ id: 'ep-new', ...args.data })),
      },
      task: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (args: any) => ({ id: 'task-new', ...args.data })),
      },
      notification: { create: jest.fn(async () => ({})) },
    }
    const oms: any = { getProductVariant: jest.fn(async () => ({ product: sampleProduct, variant: sampleVariant })) }
    const push: any = { sendToUser: jest.fn(async () => ({})) }
    const service = new TaskAutoTasksService(prisma, {} as any, push, {} as any, oms)
    return { service, prisma, oms }
  }

  afterEach(() => jest.clearAllMocks())

  it('đã biết assignee ngay lúc tạo → materialize EditorProduct ngay, task trỏ editor_product_id', async () => {
    const { service, prisma, oms } = build()

    await service.create(
      { team_id: 'team-1', content_id: 'content-1', assignee_id: 'member-1', oms_product_id: 'prod-1', oms_variant_id: 'var-1' } as any,
      'leader-1',
      ['LEADER'],
    )

    expect(oms.getProductVariant).toHaveBeenCalledWith('prod-1', 'var-1')
    const createArgs = prisma.task.create.mock.calls[0][0]
    expect(createArgs.data.editor_product_id).toBe('ep-new')
    expect(createArgs.data.oms_product_id).toBeNull()
    expect(createArgs.data.oms_variant_id).toBeNull()
  })

  it('chưa có assignee (task PENDING) → KHÔNG gọi OMS, tạm giữ oms_product_id/oms_variant_id trên Task', async () => {
    const { service, prisma, oms } = build()

    await service.create(
      { team_id: 'team-1', content_id: 'content-1', oms_product_id: 'prod-1', oms_variant_id: 'var-1' } as any,
      'leader-1',
      ['LEADER'],
    )

    expect(oms.getProductVariant).not.toHaveBeenCalled()
    const createArgs = prisma.task.create.mock.calls[0][0]
    expect(createArgs.data.editor_product_id).toBeNull()
    expect(createArgs.data.oms_product_id).toBe('prod-1')
    expect(createArgs.data.oms_variant_id).toBe('var-1')
  })

  it('editor đã materialize SKU này từ OMS trước đó (upsert) → dùng lại EditorProduct cũ, không tạo trùng', async () => {
    const { service, prisma } = build({ existingEditorProduct: { id: 'ep-existing' } })

    await service.create(
      { team_id: 'team-1', content_id: 'content-1', assignee_id: 'member-1', oms_product_id: 'prod-1', oms_variant_id: 'var-1' } as any,
      'leader-1',
      ['LEADER'],
    )

    expect(prisma.editorProduct.create).not.toHaveBeenCalled()
    const createArgs = prisma.task.create.mock.calls[0][0]
    expect(createArgs.data.editor_product_id).toBe('ep-existing')
  })

  it('SKU của variant OMS trùng với 1 sản phẩm editor đã thêm thủ công (không liên kết OMS) → báo lỗi, không tạo task', async () => {
    const { service, prisma } = build({ skuTaken: { id: 'ep-manual' } })

    await expect(
      service.create(
        { team_id: 'team-1', content_id: 'content-1', assignee_id: 'member-1', oms_product_id: 'prod-1', oms_variant_id: 'var-1' } as any,
        'leader-1',
        ['LEADER'],
      ),
    ).rejects.toThrow(BadRequestException)
    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it('oms_variant_id có nhưng thiếu oms_product_id → BadRequestException ngay, không đụng DB', async () => {
    const { service, prisma } = build()

    await expect(
      service.create(
        { team_id: 'team-1', content_id: 'content-1', oms_variant_id: 'var-1' } as any,
        'leader-1',
        ['LEADER'],
      ),
    ).rejects.toThrow(BadRequestException)
    expect(prisma.team.findUnique).not.toHaveBeenCalled()
  })
})
