import { ConflictException, NotFoundException } from '@nestjs/common';
import { MemsCatalogService } from '../mems-catalog.service';

/**
 * Quản lý vị trí lưu kho (tủ, kệ, ngăn).
 *
 * Điều đáng canh nhất: xoá một vị trí đang chứa máy thì những máy đó mất chỗ đứng trong sổ —
 * còn trong kho nhưng không tra ra đang nằm đâu. Nên xoá là xoá mềm và phải chặn khi còn máy.
 *
 * Điều đáng canh thứ hai: tên trùng. Schema KHÔNG có ràng buộc duy nhất cho tên vị trí, mà
 * dropdown thì chỉ hiện tên — hai dòng "Kệ A-02" thì thủ kho chọn cái nào cũng như nhau, và
 * một nửa số máy nằm ở vị trí không ai dùng tới.
 */

function buildPrisma(over: { location?: any; duplicated?: any } = {}) {
  const location =
    over.location === undefined
      ? { id: 'loc-1', name: 'Tủ A', parent_id: null, assets: [] }
      : over.location;
  const prisma: any = {
    memsLocation: {
      create: jest.fn(async ({ data }: any) => ({ id: 'loc-moi', ...data })),
      findUnique: jest.fn(async () => location),
      // Mô phỏng đúng bộ lọc `id: { not: … }` của Prisma. Bỏ qua nó thì test "không tự chặn
      // chính mình" bao giờ cũng đỏ, dù code đúng — mock nói dối chứ không phải code sai.
      findFirst: jest.fn(async ({ where }: any) => {
        const found = over.duplicated ?? null;
        if (found && where?.id?.not && found.id === where.id.not) return null;
        return found;
      }),
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
    await new MemsCatalogService(prisma).createLocation({ name: '  Tủ A  ' } as any);

    expect(prisma.memsLocation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Tủ A' }) }),
    );
  });

  it('không khai vị trí cha thì lưu null, không lưu undefined', async () => {
    const { prisma } = buildPrisma();
    await new MemsCatalogService(prisma).createLocation({ name: 'Kệ B' } as any);

    expect(prisma.memsLocation.create.mock.calls[0][0].data.parent_id).toBeNull();
  });

  it('trùng tên trong cùng vị trí cha thì chặn', async () => {
    const { prisma } = buildPrisma({ duplicated: { id: 'loc-cu', name: 'Kệ A-02' } });

    await expect(
      new MemsCatalogService(prisma).createLocation({ name: 'Kệ A-02' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.memsLocation.create).not.toHaveBeenCalled();
  });

  it('so tên không phân biệt hoa thường và khoảng trắng thừa', async () => {
    // Người gõ "kệ a-02" không định tạo cái thứ hai, họ chỉ gõ vội.
    const { prisma } = buildPrisma({ duplicated: { id: 'loc-cu', name: 'Kệ A-02' } });

    await expect(
      new MemsCatalogService(prisma).createLocation({ name: '  kệ a-02 ' } as any),
    ).rejects.toThrow(/Kệ A-02/);
  });
});

describe('MemsCatalogService.updateLocation', () => {
  it('đổi tên thì cắt khoảng trắng thừa', async () => {
    const { prisma } = buildPrisma();
    await new MemsCatalogService(prisma).updateLocation('loc-1', { name: ' Tủ B ' } as any);

    expect(prisma.memsLocation.update.mock.calls[0][0].data.name).toBe('Tủ B');
  });

  it('không khai vị trí cha thì giữ nguyên cha cũ', async () => {
    // Form đổi tên không gửi kèm cha; hiểu là "gỡ khỏi cây" thì cả nhánh con bật lên gốc.
    const { prisma } = buildPrisma({
      location: { id: 'loc-2', name: 'Ngăn 1', parent_id: 'tu-D', assets: [] },
    });
    await new MemsCatalogService(prisma).updateLocation('loc-2', { name: 'Ngăn 2' } as any);

    expect(prisma.memsLocation.update.mock.calls[0][0].data.parent_id).toBe('tu-D');
  });

  it('không có vị trí đó thì báo không tìm thấy', async () => {
    const { prisma } = buildPrisma({ location: null });
    await expect(
      new MemsCatalogService(prisma).updateLocation('khong-co', { name: 'X' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('đổi sang tên đã thuộc vị trí khác thì chặn', async () => {
    const { prisma } = buildPrisma({ duplicated: { id: 'loc-khac', name: 'Kệ B-01' } });

    await expect(
      new MemsCatalogService(prisma).updateLocation('loc-1', { name: 'Kệ B-01' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lưu lại đúng tên cũ của chính nó thì không bị chính mình chặn', async () => {
    // Bấm Lưu mà không sửa gì là chuyện thường; coi đó là trùng thì không ai đổi nổi cha.
    const { prisma } = buildPrisma({ duplicated: { id: 'loc-1', name: 'Tủ A' } });
    await new MemsCatalogService(prisma).updateLocation('loc-1', { name: 'Tủ A' } as any);

    expect(prisma.memsLocation.update).toHaveBeenCalled();
  });
});

describe('MemsCatalogService.deleteLocation', () => {
  it('vị trí còn chứa máy thì chặn xoá và nói rõ còn bao nhiêu máy', async () => {
    // Xoá kèm máy bên trong thì những máy đó còn trong kho nhưng không tra ra đang nằm đâu.
    const { prisma } = buildPrisma({
      location: { id: 'loc-1', name: 'Tủ A', assets: [{ id: 'a1' }, { id: 'a2' }] },
    });

    await expect(new MemsCatalogService(prisma).deleteLocation('loc-1')).rejects.toThrow(/2/);
    expect(prisma.memsLocation.update).not.toHaveBeenCalled();
  });

  it('vị trí trống thì xoá MỀM, giữ lại bản ghi cho lịch sử', async () => {
    // Xoá cứng thì mọi phiếu cũ từng trỏ vào vị trí này sẽ trỏ vào khoảng không.
    const { prisma } = buildPrisma();
    await new MemsCatalogService(prisma).deleteLocation('loc-1');

    expect(prisma.memsLocation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { is_disabled: true } }),
    );
  });

  it('không có vị trí đó thì báo không tìm thấy', async () => {
    const { prisma } = buildPrisma({ location: null });
    await expect(
      new MemsCatalogService(prisma).deleteLocation('loc-khong-ton-tai'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
