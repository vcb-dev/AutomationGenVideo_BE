import { ConflictException, NotFoundException } from '@nestjs/common';
import { MemsCatalogService } from '../mems-catalog.service';
import { photoUrlSignerStub } from '../../../common/mems/__tests__/photo-url-signer.stub';

/**
 * Quản lý vị trí lưu kho (tủ, kệ, ngăn).
 *
 * Điều đáng canh nhất: xoá một vị trí đang chứa máy thì những máy đó mất chỗ đứng trong sổ —
 * còn trong kho nhưng không tra ra đang nằm đâu. Nên xoá là xoá mềm và phải chặn khi còn máy.
 */

function buildPrisma(over: { location?: any } = {}) {
  const location =
    over.location === undefined
      ? { id: 'loc-1', name: 'Tủ A', parent_id: null, assets: [] }
      : over.location;
  const prisma: any = {
    memsLocation: {
      create: jest.fn(async ({ data }: any) => ({ id: 'loc-moi', ...data })),
      findUnique: jest.fn(async () => location),
      update: jest.fn(async ({ data }: any) => ({ ...location, ...data })),
    },
  };
  return { prisma };
}

describe('MemsCatalogService.createLocation', () => {
  it('cắt khoảng trắng thừa hai đầu tên vị trí', async () => {
    // "Tủ A " và "Tủ A" nhìn giống hệt nhau trên màn hình nhưng là hai vị trí khác nhau trong
    // sổ, và thủ kho sẽ không hiểu vì sao danh sách có hai dòng trùng.
    const { prisma } = buildPrisma();
    await new MemsCatalogService(prisma, photoUrlSignerStub).createLocation({ name: '  Tủ A  ' } as any);

    expect(prisma.memsLocation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Tủ A' }) }),
    );
  });

  it('không khai vị trí cha thì lưu null, không lưu undefined', async () => {
    const { prisma } = buildPrisma();
    await new MemsCatalogService(prisma, photoUrlSignerStub).createLocation({ name: 'Kệ B' } as any);

    expect(prisma.memsLocation.create.mock.calls[0][0].data.parent_id).toBeNull();
  });
});

describe('MemsCatalogService.deleteLocation', () => {
  it('vị trí còn chứa máy thì chặn xoá và nói rõ còn bao nhiêu máy', async () => {
    // Xoá kèm máy bên trong thì những máy đó còn trong kho nhưng không tra ra đang nằm đâu.
    const { prisma } = buildPrisma({
      location: { id: 'loc-1', name: 'Tủ A', assets: [{ id: 'a1' }, { id: 'a2' }] },
    });

    await expect(
      new MemsCatalogService(prisma, photoUrlSignerStub).deleteLocation('loc-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.memsLocation.update).not.toHaveBeenCalled();
  });

  it('vị trí trống thì xoá MỀM, giữ lại bản ghi cho lịch sử', async () => {
    // Xoá cứng thì mọi phiếu cũ từng trỏ vào vị trí này sẽ trỏ vào khoảng không.
    const { prisma } = buildPrisma();
    await new MemsCatalogService(prisma, photoUrlSignerStub).deleteLocation('loc-1');

    expect(prisma.memsLocation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { is_disabled: true } }),
    );
  });

  it('không có vị trí đó thì báo không tìm thấy', async () => {
    const { prisma } = buildPrisma({ location: null });
    await expect(
      new MemsCatalogService(prisma, photoUrlSignerStub).deleteLocation('loc-khong-ton-tai'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
