import { TaskAutoKpiService } from '../kpi.service';

/**
 * `product_profit` (migration 20260820_add_editor_kpi_product_profit) — hoàn thiện bộ 3 chỉ số
 * sản phẩm của EditorKpi: product_planned = SP GMV, product_win_collect = SP Traffic,
 * product_profit = SP Profit. Field không tham gia validate allocations (khác product_planned),
 * chỉ cần đảm bảo được ghi đúng xuống DB kèm fallback 0 khi FE không gửi (như 2 field product cũ).
 */
describe('TaskAutoKpiService.upsertEditorKpi — product_profit', () => {
  function build() {
    const prisma: any = {
      editorKpi: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async (args: any) => ({ id: 'kpi-1', ...args.data })),
        update: jest.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
      },
      editorKpiAllocation: { deleteMany: jest.fn(async () => ({})) },
    };
    const service = new TaskAutoKpiService(prisma);
    return { service, prisma };
  }

  it('không truyền product_profit → mặc định 0 khi tạo mới', async () => {
    const { service, prisma } = build();

    await service.upsertEditorKpi(
      {
        user_id: 'user-1',
        team_id: 'team-1',
        month: '2026-08',
        total_target: 0,
        product_planned: 0,
        product_win_collect: 0,
        allocations: [],
      } as any,
      'admin-1',
      ['ADMIN'],
    );

    const createArgs = prisma.editorKpi.create.mock.calls[0][0];
    expect(createArgs.data.product_profit).toBe(0);
  });

  it('có truyền product_profit → giữ nguyên giá trị, ghi đúng xuống DB cùng lứa GMV/Traffic', async () => {
    const { service, prisma } = build();

    await service.upsertEditorKpi(
      {
        user_id: 'user-1',
        team_id: 'team-1',
        month: '2026-08',
        total_target: 0,
        product_planned: 10,
        product_win_collect: 4,
        product_profit: 6,
        allocations: [],
      } as any,
      'admin-1',
      ['ADMIN'],
    );

    const createArgs = prisma.editorKpi.create.mock.calls[0][0];
    expect(createArgs.data.product_planned).toBe(10);
    expect(createArgs.data.product_win_collect).toBe(4);
    expect(createArgs.data.product_profit).toBe(6);
  });
});
