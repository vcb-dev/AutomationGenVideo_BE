import { TaskAutoTasksService } from '../tasks.service';

/**
 * getApprovedProductLineBreakdown() (private, gọi qua getDashboard → product_by_category) —
 * "SẢN PHẨM" (GMV/Traffic/Profit): xác định ProductLine của mỗi task APPROVED, ưu tiên
 * Task.product_line_id (denormalized), fallback sang product_id/editor_product_id/team_product_id
 * → product_line_id của Product/EditorProduct/TeamProduct tương ứng. Nhãn nhóm ưu tiên
 * ProductLine.video_category, fallback ProductLine.name viết hoa. Task không xác định được dòng
 * sản phẩm nào bị bỏ qua. Xem comment gốc tại tasks.service.ts.
 */
describe('TaskAutoTasksService — product_by_category (qua getDashboard)', () => {
  function build(opts: {
    productBreakdownRows?: any[];
    products?: any[];
    editorProducts?: any[];
    teamProducts?: any[];
    productLines?: any[];
  }) {
    const teamsLed = [
      {
        id: 't-1',
        name: 'Team A',
        members: [{ user_id: 'u1', user: { id: 'u1', full_name: 'A', email: 'a@x.com' } }],
      },
    ];
    const prisma: any = {
      team: { findMany: jest.fn(async () => teamsLed) },
      task: {
        groupBy: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        // Phân biệt lời gọi của getContentFreshnessByAssignee (select assignee_id/content_id/...)
        // với getApprovedProductLineBreakdown (select product_line_id/product_id/...) bằng field
        // đặc trưng trong `select` — 2 hàm đều gọi task.findMany trong cùng Promise.all.
        findMany: jest.fn(async (args: any) => {
          if (args.select?.product_line_id !== undefined) {
            return opts.productBreakdownRows ?? [];
          }
          return [];
        }),
      },
      product: { findMany: jest.fn(async () => opts.products ?? []) },
      editorProduct: { findMany: jest.fn(async () => opts.editorProducts ?? []) },
      teamProduct: { findMany: jest.fn(async () => opts.teamProducts ?? []) },
      editorKpi: { findMany: jest.fn(async () => []) },
      trafficReport: { findMany: jest.fn(async () => []) },
      revenueReport: { groupBy: jest.fn(async () => []) },
      contentLine: { findMany: jest.fn(async () => []) },
      editorDailyKpi: { findMany: jest.fn(async () => []) },
      productLine: { findMany: jest.fn(async () => opts.productLines ?? []) },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any);
    return { service, prisma };
  }

  async function productByCategory(service: TaskAutoTasksService) {
    const result: any = await service.getDashboard('leader-1', ['LEADER'], undefined, undefined);
    return result.product_by_category as { category: string; count: number }[];
  }

  it('task có product_line_id denormalized → đếm thẳng, ưu tiên video_category', async () => {
    const { service } = build({
      productBreakdownRows: [
        { product_line_id: 'pl-1', product_id: null, editor_product_id: null, team_product_id: null },
      ],
      productLines: [{ id: 'pl-1', name: 'Dòng GMV', video_category: 'GMV' }],
    });

    const result = await productByCategory(service);

    expect(result).toEqual([{ category: 'GMV', count: 1 }]);
  });

  it('ProductLine không set video_category → fallback về name viết hoa', async () => {
    const { service } = build({
      productBreakdownRows: [
        { product_line_id: 'pl-2', product_id: null, editor_product_id: null, team_product_id: null },
      ],
      productLines: [{ id: 'pl-2', name: 'traffic', video_category: null }],
    });

    const result = await productByCategory(service);

    expect(result).toEqual([{ category: 'TRAFFIC', count: 1 }]);
  });

  it('task chỉ có product_id → tra product_line_id qua Product, rồi resolve category', async () => {
    const { service } = build({
      productBreakdownRows: [
        { product_line_id: null, product_id: 'p-1', editor_product_id: null, team_product_id: null },
      ],
      products: [{ id: 'p-1', product_line_id: 'pl-1' }],
      productLines: [{ id: 'pl-1', name: 'Dòng GMV', video_category: 'GMV' }],
    });

    const result = await productByCategory(service);

    expect(result).toEqual([{ category: 'GMV', count: 1 }]);
  });

  it('task chỉ có editor_product_id → tra qua EditorProduct', async () => {
    const { service } = build({
      productBreakdownRows: [
        { product_line_id: null, product_id: null, editor_product_id: 'ep-1', team_product_id: null },
      ],
      editorProducts: [{ id: 'ep-1', product_line_id: 'pl-3' }],
      productLines: [{ id: 'pl-3', name: 'Dòng Profit', video_category: 'PROFIT' }],
    });

    const result = await productByCategory(service);

    expect(result).toEqual([{ category: 'PROFIT', count: 1 }]);
  });

  it('task chỉ có team_product_id → tra qua TeamProduct', async () => {
    const { service } = build({
      productBreakdownRows: [
        { product_line_id: null, product_id: null, editor_product_id: null, team_product_id: 'tp-1' },
      ],
      teamProducts: [{ id: 'tp-1', product_line_id: 'pl-1' }],
      productLines: [{ id: 'pl-1', name: 'Dòng GMV', video_category: 'GMV' }],
    });

    const result = await productByCategory(service);

    expect(result).toEqual([{ category: 'GMV', count: 1 }]);
  });

  it('task không xác định được dòng sản phẩm nào → bị bỏ qua, không tính vào mẫu số', async () => {
    const { service } = build({
      productBreakdownRows: [
        { product_line_id: null, product_id: null, editor_product_id: null, team_product_id: null },
        { product_line_id: 'pl-missing', product_id: null, editor_product_id: null, team_product_id: null },
      ],
      productLines: [],
    });

    const result = await productByCategory(service);

    expect(result).toEqual([]);
  });

  it('gộp đúng nhiều task cùng category, khác nguồn liên kết (product_line_id lẫn product_id)', async () => {
    const { service } = build({
      productBreakdownRows: [
        { product_line_id: 'pl-1', product_id: null, editor_product_id: null, team_product_id: null },
        { product_line_id: null, product_id: 'p-1', editor_product_id: null, team_product_id: null },
        { product_line_id: null, product_id: null, editor_product_id: null, team_product_id: 'tp-1' },
      ],
      products: [{ id: 'p-1', product_line_id: 'pl-1' }],
      teamProducts: [{ id: 'tp-1', product_line_id: 'pl-2' }],
      productLines: [
        { id: 'pl-1', name: 'Dòng GMV', video_category: 'GMV' },
        { id: 'pl-2', name: 'Dòng Traffic', video_category: 'TRAFFIC' },
      ],
    });

    const result = await productByCategory(service);

    expect(result).toEqual(
      expect.arrayContaining([
        { category: 'GMV', count: 2 },
        { category: 'TRAFFIC', count: 1 },
      ]),
    );
    expect(result).toHaveLength(2);
  });
});
