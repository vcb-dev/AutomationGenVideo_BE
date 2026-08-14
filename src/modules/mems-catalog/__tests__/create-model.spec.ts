import { ConflictException } from '@nestjs/common';
import { MemsCatalogService } from '../mems-catalog.service';

function buildPrisma(duplicated: { id: string } | null = null) {
  const created: any = {};
  const prisma: any = {
    memsAssetModel: {
      findFirst: jest.fn(async () => duplicated),
      create: jest.fn(async (args: any) => {
        created.args = args;
        return { id: 'model-1', ...args.data };
      }),
    },
  };
  return { prisma, created };
}

const DTO = {
  categoryId: 'cat-1',
  name: 'Sony A7 IV',
  manufacturer: 'Sony',
  referencePrice: 48_000_000,
  accessories: ['Pin', 'Sạc', 'Dây đeo'],
};

describe('MemsCatalogService.createModel', () => {
  it('khai model kèm phụ kiện, giữ đúng thứ tự đã nhập', async () => {
    // Thứ tự phụ kiện là thứ tự hiện trên biên bản bàn giao, đảo lung tung thì thủ kho khó dò.
    const { prisma, created } = buildPrisma();
    await new MemsCatalogService(prisma).createModel(DTO);

    expect(created.args.data.accessories.create).toEqual([
      { name: 'Pin', sort_order: 0 },
      { name: 'Sạc', sort_order: 1 },
      { name: 'Dây đeo', sort_order: 2 },
    ]);
  });

  it('trùng tên model trong cùng danh mục thì chặn', async () => {
    // Hai model cùng tên trong một danh mục làm dropdown chọn máy thành trò đoán mò.
    const { prisma } = buildPrisma({ id: 'model-cũ' });
    await expect(
      new MemsCatalogService(prisma).createModel(DTO),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lọc trùng theo cả danh mục lẫn tên, không chỉ theo tên', async () => {
    // findFirst lọc theo cả category_id, nên tên giống ở danh mục khác không đụng nhau.
    const { prisma } = buildPrisma();
    await new MemsCatalogService(prisma).createModel(DTO);

    expect(prisma.memsAssetModel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { category_id: 'cat-1', name: 'Sony A7 IV' },
      }),
    );
  });

  it('không khai phụ kiện thì vẫn tạo được model', async () => {
    const { prisma, created } = buildPrisma();
    await new MemsCatalogService(prisma).createModel({
      categoryId: 'cat-1',
      name: 'Manfrotto 055',
    });

    expect(created.args.data.accessories.create).toEqual([]);
  });

  it('bỏ trống hãng và giá thì lưu null, không lưu undefined', async () => {
    // Prisma bỏ qua undefined, cột sẽ giữ giá trị cũ khi dùng lại hàm này cho cập nhật sau này.
    const { prisma, created } = buildPrisma();
    await new MemsCatalogService(prisma).createModel({
      categoryId: 'cat-1',
      name: 'Manfrotto 055',
    });

    expect(created.args.data.manufacturer).toBeNull();
    expect(created.args.data.reference_price).toBeNull();
  });
});
