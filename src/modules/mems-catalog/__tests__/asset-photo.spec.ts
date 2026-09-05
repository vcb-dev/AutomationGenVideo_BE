import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AssetPhotoService } from '../asset-photo.service';
import { photoUrlSignerStub } from '../../../common/mems/__tests__/photo-url-signer.stub';

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
  // `resolveDatedFolder` phải có trong mock: service gọi nó trước `uploadFromPath`, và mọi lỗi
  // trong nhánh Drive đều bị bắt để rơi về lưu đĩa. Thiếu hàm này thì test "đẩy lên Drive" thất
  // bại vì đúng cái cơ chế dự phòng đó — lỗi trông như của Drive mà thật ra là của mock.
  const drive: any = {
    isAvailable: () => over.driveAvailable ?? false,
    resolveDatedFolder: jest.fn(async () => 'folder-1'),
    uploadFromPath: jest.fn(),
  };
  return { prisma, drive, created };
}

/**
 * Nội dung file mới là thứ quyết định loại ảnh, không phải `mimetype` hay đuôi trong
 * `originalname` — cả hai thứ đó đều do phía gửi tự đặt. Nên fixture phải mang chữ ký JPEG thật.
 */
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(16).fill(0)]);

const file = (over: Partial<Express.Multer.File> = {}) =>
  ({
    originalname: 'anh.JPG',
    mimetype: 'image/jpeg',
    size: 1024,
    buffer: JPEG_BYTES,
    ...over,
  }) as Express.Multer.File;

describe('AssetPhotoService.upload', () => {
  it('ảnh đầu tiên của máy tự thành ảnh đại diện', async () => {
    // Không bắt người dùng bấm thêm một nút nữa chỉ để nói điều hiển nhiên.
    const { prisma, drive, created } = buildDeps();
    await new AssetPhotoService(prisma, drive, photoUrlSignerStub).upload('CAM-001', 'nguoi-tai', file(), undefined, {});

    expect(created.photos[0]).toMatchObject({ is_primary: true, sort_order: 0 });
  });

  it('ảnh thứ hai trở đi không giành cờ đại diện', async () => {
    const { prisma, drive, created } = buildDeps({ existingCount: 3 });
    await new AssetPhotoService(prisma, drive, photoUrlSignerStub).upload('CAM-001', 'nguoi-tai', file(), undefined, {});

    expect(created.photos[0]).toMatchObject({ is_primary: false, sort_order: 3 });
  });

  it('tên file mang theo mã máy để tra ngược được', async () => {
    const { prisma, drive, created } = buildDeps();
    await new AssetPhotoService(prisma, drive, photoUrlSignerStub).upload('CAM-001', 'nguoi-tai', file(), undefined, {});

    expect(created.photos[0].url).toContain('CAM-001_');
    expect(created.photos[0].url.endsWith('.jpg')).toBe(true);
  });

  it('chưa cấu hình Google Drive thì lưu đĩa và ghi rõ nơi lưu', async () => {
    const { prisma, drive, created } = buildDeps({ driveAvailable: false });
    await new AssetPhotoService(prisma, drive, photoUrlSignerStub).upload('CAM-001', 'nguoi-tai', file(), undefined, {});

    expect(created.photos[0].storage).toBe('local');
    expect(created.photos[0].url.startsWith('/api/mems/photos/')).toBe(true);
  });

  it('có Google Drive thì đẩy lên đó', async () => {
    const { prisma, drive, created } = buildDeps({ driveAvailable: true });
    drive.uploadFromPath = jest.fn(async () => ({ url: 'https://drive/abc' }));
    await new AssetPhotoService(prisma, drive, photoUrlSignerStub).upload('CAM-001', 'nguoi-tai', file(), undefined, {});

    expect(created.photos[0]).toMatchObject({ url: 'https://drive/abc', storage: 'google_drive' });
  });

  it('từ chối ảnh quá 10MB và nói rõ phải làm gì', async () => {
    const { prisma, drive } = buildDeps();
    await expect(
      new AssetPhotoService(prisma, drive, photoUrlSignerStub).upload(
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
      new AssetPhotoService(prisma, drive, photoUrlSignerStub).upload('CAM-001', 'nguoi-tai', undefined as any, undefined, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('mã máy không tồn tại thì báo không tìm thấy', async () => {
    const { prisma, drive } = buildDeps({ assetMissing: true });
    await expect(
      new AssetPhotoService(prisma, drive, photoUrlSignerStub).upload('KHONG-CO', 'nguoi-tai', file(), undefined, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('chú thích toàn khoảng trắng lưu thành null, không lưu chuỗi rỗng', async () => {
    const { prisma, drive, created } = buildDeps();
    await new AssetPhotoService(prisma, drive, photoUrlSignerStub).upload('CAM-001', 'nguoi-tai', file(), '   ', {});

    expect(created.photos[0].caption).toBeNull();
  });
});

describe('AssetPhotoService.setPrimary', () => {
  it('bỏ cờ mọi ảnh cũ trước khi gắn cờ ảnh mới', async () => {
    // Hai ảnh cùng cờ thì bảng kho hiện ảnh nào là chuyện may rủi theo thứ tự truy vấn.
    const { prisma, drive, created } = buildDeps({
      photo: { id: 'photo-9', asset_id: 'asset-1', is_primary: false, purpose: 'CATALOG' },
    });
    await new AssetPhotoService(prisma, drive, photoUrlSignerStub).setPrimary('photo-9');

    expect(created.updates[0]).toMatchObject({ many: true, is_primary: false });
    expect(created.updates[1]).toMatchObject({ id: 'photo-9', is_primary: true });
  });
});

describe('AssetPhotoService.remove', () => {
  it('xoá ảnh đại diện thì ảnh còn lại lên thay', async () => {
    // Không có bước này thì bảng kho mất hình mà người dùng không hiểu vì sao.
    const { prisma, drive, created } = buildDeps({
      photo: { id: 'photo-1', asset_id: 'asset-1', is_primary: true, storage: 'local', url: '/api/mems/photos/a.jpg', purpose: 'CATALOG' },
      nextPhoto: { id: 'photo-2' },
    });
    await new AssetPhotoService(prisma, drive, photoUrlSignerStub).remove('photo-1');

    expect(created.deleted).toEqual(['photo-1']);
    expect(created.updates[0]).toMatchObject({ id: 'photo-2', is_primary: true });
  });

  it('xoá ảnh thường thì không đụng tới ảnh đại diện', async () => {
    const { prisma, drive, created } = buildDeps({
      photo: { id: 'photo-5', asset_id: 'asset-1', is_primary: false, storage: 'local', url: '/x/a.jpg', purpose: 'CATALOG' },
    });
    await new AssetPhotoService(prisma, drive, photoUrlSignerStub).remove('photo-5');

    expect(created.updates).toHaveLength(0);
  });

  it('ảnh không tồn tại thì báo không tìm thấy', async () => {
    const { prisma, drive } = buildDeps({ photo: null });
    await expect(new AssetPhotoService(prisma, drive, photoUrlSignerStub).remove('khong-co')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

/**
 * Ảnh chứng cứ của biên bản KHÔNG được lẫn vào thư viện ảnh của máy.
 *
 * Mỗi lượt bàn giao và nhận trả đều tải ảnh lên qua chính endpoint này, nên trước khi có cột
 * `purpose` thì mượn 20 lần là 60 tấm ảnh biên bản đứng cạnh ảnh catalogue — và tệ nhất là ảnh
 * đại diện ở bảng kho có thể rơi trúng một tấm chụp vết xước.
 */
describe('AssetPhotoService.upload — tách ảnh chứng cứ khỏi ảnh hồ sơ', () => {
  it('mặc định là ảnh hồ sơ của máy', async () => {
    const { prisma, drive, created } = buildDeps();
    await new AssetPhotoService(prisma, drive, photoUrlSignerStub).upload('CAM-001', 'nguoi-tai', file(), undefined, {});

    expect(created.photos[0].purpose).toBe('CATALOG');
  });

  it('ảnh bàn giao và ảnh nhận trả được đánh dấu riêng', async () => {
    for (const purpose of ['HANDOVER', 'RETURN'] as const) {
      const { prisma, drive, created } = buildDeps();
      await new AssetPhotoService(prisma, drive, photoUrlSignerStub).upload(
        'CAM-001',
        'nguoi-tai',
        file(),
        undefined,
        {},
        purpose,
      );

      expect(created.photos[0].purpose).toBe(purpose);
    }
  });

  it('ảnh chứng cứ KHÔNG bao giờ thành ảnh đại diện, kể cả khi máy chưa có ảnh nào', async () => {
    // Đây là hậu quả nhìn thấy được: bảng kho hiện ảnh chụp vết xước lúc trả máy làm ảnh đại diện.
    const { prisma, drive, created } = buildDeps({ existingCount: 0 });
    await new AssetPhotoService(prisma, drive, photoUrlSignerStub).upload(
      'CAM-001',
      'nguoi-tai',
      file(),
      undefined,
      {},
      'HANDOVER',
    );

    expect(created.photos[0].is_primary).toBe(false);
  });

  it('ảnh hồ sơ đầu tiên vẫn tự thành ảnh đại diện như cũ', async () => {
    const { prisma, drive, created } = buildDeps({ existingCount: 0 });
    await new AssetPhotoService(prisma, drive, photoUrlSignerStub).upload('CAM-001', 'nguoi-tai', file(), undefined, {});

    expect(created.photos[0].is_primary).toBe(true);
  });
});

describe('AssetPhotoService.list — thư viện ảnh của máy', () => {
  it('chỉ trả ảnh hồ sơ, không trả ảnh biên bản', async () => {
    const { prisma, drive } = buildDeps();
    await new AssetPhotoService(prisma, drive, photoUrlSignerStub).list('CAM-001');

    expect(prisma.memsAssetPhoto.findMany.mock.calls[0][0].where).toMatchObject({
      asset_id: 'asset-1',
      purpose: 'CATALOG',
    });
  });
});

/**
 * Ký URL phải xảy ra ở MỌI lối trả ảnh ra ngoài.
 *
 * Route phục vụ ảnh là công khai nên nó chỉ nhận đường dẫn có token còn hạn — quên ký ở một lối
 * nào đó thì đúng màn hình dùng lối ấy hiện toàn ô ảnh vỡ, mà không có lỗi nào trong console
 * server để lần ra.
 */
describe('AssetPhotoService — ký URL trước khi trả ra ngoài', () => {
  const signerDanhDau = {
    sign: (url: string) => `${url}?t=DA-KY`,
    signAll: <T extends { url: string }>(photos: T[]) =>
      photos.map((p) => ({ ...p, url: `${p.url}?t=DA-KY` })),
    verify: () => true,
  } as any;

  it('danh sách ảnh của máy trả về URL đã ký', async () => {
    const { prisma, drive } = buildDeps({
      photos: [{ id: 'p1', url: '/api/mems/photos/CAM-001_1_abc.jpg' }],
    });

    const photos = await new AssetPhotoService(prisma, drive, signerDanhDau).list('CAM-001');

    expect(photos[0].url).toContain('?t=DA-KY');
  });

  it('ảnh vừa tải lên cũng trả về URL đã ký', async () => {
    // Màn bàn giao hiện ảnh ngay sau khi tải lên; chưa ký là ô ảnh vỡ cho tới lần nạp lại trang.
    const { prisma, drive } = buildDeps({ driveAvailable: false });

    const photo = await new AssetPhotoService(prisma, drive, signerDanhDau).upload(
      'CAM-001',
      'nguoi-tai',
      file(),
      undefined,
      {},
    );

    expect(photo.url).toContain('?t=DA-KY');
  });
});

/**
 * Ảnh chứng cứ của biên bản không được lẫn sang vai trò ảnh hồ sơ, kể cả qua đường vòng.
 *
 * Tách `purpose` mới chỉ chặn được lối tải lên. Còn hai lối vòng nữa dẫn tới đúng hậu quả mà nó
 * sinh ra để tránh: xoá ảnh đại diện thì ảnh kế tiếp lên thay mà không xét mục đích, và
 * `setPrimary` nhận bất kỳ id nào. Ảnh biên bản lại đánh `sort_order` theo nhóm riêng nên tấm
 * đầu tiên mang số 0 — nó xếp TRƯỚC mọi ảnh catalogue và luôn thắng.
 */
describe('AssetPhotoService — ảnh chứng cứ không được thành ảnh đại diện', () => {
  it('xoá ảnh đại diện thì chỉ ảnh HỒ SƠ mới được lên thay', async () => {
    const { prisma, drive } = buildDeps({
      photo: { id: 'p1', asset_id: 'asset-1', is_primary: true, storage: 'local', url: '/x/a.jpg', purpose: 'CATALOG' },
      nextPhoto: { id: 'p2' },
    });

    await new AssetPhotoService(prisma, drive, photoUrlSignerStub).remove('p1');

    expect(prisma.memsAssetPhoto.findFirst.mock.calls[0][0].where).toMatchObject({
      asset_id: 'asset-1',
      purpose: 'CATALOG',
    });
  });

  it('không đặt ảnh chứng cứ làm ảnh đại diện được', async () => {
    const { prisma, drive } = buildDeps({
      photo: { id: 'p9', asset_id: 'asset-1', is_primary: false, purpose: 'HANDOVER', url: '/x/a.jpg' },
    });

    await expect(
      new AssetPhotoService(prisma, drive, photoUrlSignerStub).setPrimary('p9'),
    ).rejects.toThrow(/ảnh hồ sơ|biên bản/i);
  });

  it('vẫn đặt được ảnh hồ sơ làm ảnh đại diện như cũ', async () => {
    const { prisma, drive } = buildDeps({
      photo: { id: 'p2', asset_id: 'asset-1', is_primary: false, purpose: 'CATALOG', url: '/x/b.jpg' },
    });

    await new AssetPhotoService(prisma, drive, photoUrlSignerStub).setPrimary('p2');

    expect(prisma.memsAssetPhoto.update).toHaveBeenCalled();
  });

  it('không xoá được ảnh chứng cứ của biên bản', async () => {
    // `photoKeys` của biên bản trỏ vào chính id này. Xoá đi là biên bản còn ghi "3 ảnh" mà không
    // tấm nào mở được — quay lại đúng tình trạng trước khi siết BR-26.
    const { prisma, drive, created } = buildDeps({
      photo: { id: 'p9', asset_id: 'asset-1', is_primary: false, purpose: 'RETURN', url: '/x/c.jpg' },
    });

    await expect(
      new AssetPhotoService(prisma, drive, photoUrlSignerStub).remove('p9'),
    ).rejects.toThrow(/biên bản/i);

    expect(created.deleted).toHaveLength(0);
  });
});
