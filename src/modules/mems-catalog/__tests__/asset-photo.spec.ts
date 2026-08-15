import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AssetPhotoService } from '../asset-photo.service';

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlink: jest.fn((_p: string, cb: () => void) => cb()),
}));

function buildDeps(over: Partial<any> = {}) {
  const created: any = { photos: [], updates: [], deleted: [] };
  const prisma: any = {
    memsAsset: {
      findUnique: jest.fn(async () =>
        over.assetMissing ? null : { id: 'asset-1', asset_code: 'CAM-001' },
      ),
    },
    memsAssetPhoto: {
      count: jest.fn(async () => over.existingCount ?? 0),
      findMany: jest.fn(async () => over.photos ?? []),
      findUnique: jest.fn(async () => over.photo ?? null),
      findFirst: jest.fn(async () => over.nextPhoto ?? null),
      create: jest.fn(async ({ data }: any) => {
        created.photos.push(data);
        return { id: 'photo-1', ...data };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        created.updates.push({ ...where, ...data });
        return data;
      }),
      updateMany: jest.fn(async ({ data }: any) => {
        created.updates.push({ many: true, ...data });
        return { count: 2 };
      }),
      delete: jest.fn(async ({ where }: any) => {
        created.deleted.push(where.id);
        return {};
      }),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };
  const drive: any = { isAvailable: () => over.driveAvailable ?? false, uploadFromPath: jest.fn() };
  return { prisma, drive, created };
}

const file = (over: Partial<Express.Multer.File> = {}) =>
  ({
    originalname: 'anh.JPG',
    mimetype: 'image/jpeg',
    size: 1024,
    buffer: Buffer.from('x'),
    ...over,
  }) as Express.Multer.File;

describe('AssetPhotoService.upload', () => {
  it('ảnh đầu tiên của máy tự thành ảnh đại diện', async () => {
    // Không bắt người dùng bấm thêm một nút nữa chỉ để nói điều hiển nhiên.
    const { prisma, drive, created } = buildDeps();
    await new AssetPhotoService(prisma, drive).upload('CAM-001', 'nguoi-tai', file(), undefined, {});

    expect(created.photos[0]).toMatchObject({ is_primary: true, sort_order: 0 });
  });

  it('ảnh thứ hai trở đi không giành cờ đại diện', async () => {
    const { prisma, drive, created } = buildDeps({ existingCount: 3 });
    await new AssetPhotoService(prisma, drive).upload('CAM-001', 'nguoi-tai', file(), undefined, {});

    expect(created.photos[0]).toMatchObject({ is_primary: false, sort_order: 3 });
  });

  it('tên file mang theo mã máy để tra ngược được', async () => {
    const { prisma, drive, created } = buildDeps();
    await new AssetPhotoService(prisma, drive).upload('CAM-001', 'nguoi-tai', file(), undefined, {});

    expect(created.photos[0].url).toContain('CAM-001_');
    expect(created.photos[0].url.endsWith('.jpg')).toBe(true);
  });

  it('chưa cấu hình Google Drive thì lưu đĩa và ghi rõ nơi lưu', async () => {
    const { prisma, drive, created } = buildDeps({ driveAvailable: false });
    await new AssetPhotoService(prisma, drive).upload('CAM-001', 'nguoi-tai', file(), undefined, {});

    expect(created.photos[0].storage).toBe('local');
    expect(created.photos[0].url.startsWith('/api/mems/photos/')).toBe(true);
  });

  it('có Google Drive thì đẩy lên đó', async () => {
    const { prisma, drive, created } = buildDeps({ driveAvailable: true });
    drive.uploadFromPath = jest.fn(async () => ({ url: 'https://drive/abc' }));
    await new AssetPhotoService(prisma, drive).upload('CAM-001', 'nguoi-tai', file(), undefined, {});

    expect(created.photos[0]).toMatchObject({ url: 'https://drive/abc', storage: 'google_drive' });
  });

  it('từ chối file không phải ảnh', async () => {
    const { prisma, drive } = buildDeps();
    await expect(
      new AssetPhotoService(prisma, drive).upload(
        'CAM-001',
        'nguoi-tai',
        file({ mimetype: 'application/pdf' }),
        undefined,
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('từ chối ảnh quá 10MB và nói rõ phải làm gì', async () => {
    const { prisma, drive } = buildDeps();
    await expect(
      new AssetPhotoService(prisma, drive).upload(
        'CAM-001',
        'nguoi-tai',
        file({ size: 11 * 1024 * 1024 }),
        undefined,
        {},
      ),
    ).rejects.toThrow(/nhỏ hơn/);
  });

  it('không chọn file thì báo lỗi thay vì nổ', async () => {
    const { prisma, drive } = buildDeps();
    await expect(
      new AssetPhotoService(prisma, drive).upload('CAM-001', 'nguoi-tai', undefined as any, undefined, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('mã máy không tồn tại thì báo không tìm thấy', async () => {
    const { prisma, drive } = buildDeps({ assetMissing: true });
    await expect(
      new AssetPhotoService(prisma, drive).upload('KHONG-CO', 'nguoi-tai', file(), undefined, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('chú thích toàn khoảng trắng lưu thành null, không lưu chuỗi rỗng', async () => {
    const { prisma, drive, created } = buildDeps();
    await new AssetPhotoService(prisma, drive).upload('CAM-001', 'nguoi-tai', file(), '   ', {});

    expect(created.photos[0].caption).toBeNull();
  });
});

describe('AssetPhotoService.setPrimary', () => {
  it('bỏ cờ mọi ảnh cũ trước khi gắn cờ ảnh mới', async () => {
    // Hai ảnh cùng cờ thì bảng kho hiện ảnh nào là chuyện may rủi theo thứ tự truy vấn.
    const { prisma, drive, created } = buildDeps({
      photo: { id: 'photo-9', asset_id: 'asset-1', is_primary: false },
    });
    await new AssetPhotoService(prisma, drive).setPrimary('photo-9');

    expect(created.updates[0]).toMatchObject({ many: true, is_primary: false });
    expect(created.updates[1]).toMatchObject({ id: 'photo-9', is_primary: true });
  });
});

describe('AssetPhotoService.remove', () => {
  it('xoá ảnh đại diện thì ảnh còn lại lên thay', async () => {
    // Không có bước này thì bảng kho mất hình mà người dùng không hiểu vì sao.
    const { prisma, drive, created } = buildDeps({
      photo: { id: 'photo-1', asset_id: 'asset-1', is_primary: true, storage: 'local', url: '/api/mems/photos/a.jpg' },
      nextPhoto: { id: 'photo-2' },
    });
    await new AssetPhotoService(prisma, drive).remove('photo-1');

    expect(created.deleted).toEqual(['photo-1']);
    expect(created.updates[0]).toMatchObject({ id: 'photo-2', is_primary: true });
  });

  it('xoá ảnh thường thì không đụng tới ảnh đại diện', async () => {
    const { prisma, drive, created } = buildDeps({
      photo: { id: 'photo-5', asset_id: 'asset-1', is_primary: false, storage: 'local', url: '/x/a.jpg' },
    });
    await new AssetPhotoService(prisma, drive).remove('photo-5');

    expect(created.updates).toHaveLength(0);
  });

  it('ảnh không tồn tại thì báo không tìm thấy', async () => {
    const { prisma, drive } = buildDeps({ photo: null });
    await expect(new AssetPhotoService(prisma, drive).remove('khong-co')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
