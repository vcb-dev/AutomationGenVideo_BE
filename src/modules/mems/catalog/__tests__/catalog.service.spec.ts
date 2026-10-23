import { intakeStatusFor } from '../../../../utils/mems/intake-rules.util';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { MemsCatalogService } from '../catalog.service';
import { photoUrlSignerStub } from '../../../../common/mems/__tests__/photo-url-signer.stub';

describe('Nhập kho thiết bị', () => {
  function buildPrisma(opts: { categoryCode: string; existingCount: number; serialTaken?: boolean }) {
    const prisma: any = {
      memsAssetModel: {
        findUniqueOrThrow: jest.fn(async () => ({
          id: 'model-1',
          category: { code: opts.categoryCode },
        })),
      },
      memsAsset: {
        findUnique: jest.fn(async () =>
          opts.serialTaken ? { id: 'existing', asset_code: 'CAM-007' } : null,
        ),
        count: jest.fn(async () => opts.existingCount),
        create: jest.fn(async ({ data }: any) => ({ id: 'new-asset', ...data })),
      },
      memsAssetEvent: { create: jest.fn(async ({ data }: any) => data) },
      // Sinh mã máy khoá theo tiền tố danh mục: đếm và ghi phải nằm trong cùng giao dịch có khoá,
      // nếu không hai người cùng nhập kho sẽ cùng đọc ra N rồi cùng sinh mã N+1.
      $executeRawUnsafe: jest.fn(async (..._args: any[]) => 1),
    };
    // Tạo máy và ghi nhật ký nhập kho nằm trong cùng một giao dịch.
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    return prisma;
  }

  describe('MemsCatalogService.createAsset', () => {
    it('sinh mã thiết bị theo tiền tố danh mục và số thứ tự', async () => {
      const prisma = buildPrisma({ categoryCode: 'CAM', existingCount: 2 });
      const service = new MemsCatalogService(prisma, photoUrlSignerStub);

      const asset = await service.createAsset({ modelId: 'model-1', serialNumber: 'SN-999' });

      expect(asset.asset_code).toBe('CAM-003');
    });

    it('thiết bị khai tình trạng Tốt vào kệ ngay', async () => {
      // Đổi so với trước: máy mới không còn LUÔN đi Chờ kiểm tra. Tình trạng khai lúc nhập mới là
      // thứ quyết định — khai Tốt thì không có gì để kiểm, bắt đi vòng chỉ làm kho đứng hình.
      const prisma = buildPrisma({ categoryCode: 'CAM', existingCount: 0 });
      const service = new MemsCatalogService(prisma, photoUrlSignerStub);

      await service.createAsset({ modelId: 'model-1', serialNumber: 'SN-001' });

      expect(prisma.memsAsset.create.mock.calls[0][0].data.status).toBe('AVAILABLE');
    });

    it('chặn serial đã tồn tại và chỉ ra thiết bị trùng', async () => {
      const prisma = buildPrisma({ categoryCode: 'CAM', existingCount: 1, serialTaken: true });
      const service = new MemsCatalogService(prisma, photoUrlSignerStub);

      await expect(service.createAsset({ modelId: 'model-1', serialNumber: 'SN-999' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('mã QR sinh cùng lúc và trùng với mã thiết bị', async () => {
      const prisma = buildPrisma({ categoryCode: 'LEN', existingCount: 4 });
      const service = new MemsCatalogService(prisma, photoUrlSignerStub);

      const asset = await service.createAsset({ modelId: 'model-1', serialNumber: 'SN-777' });

      expect(asset.qr_code).toBe('MEMS:LEN-005');
    });
  });

  describe('MemsCatalogService.createAsset — tình trạng lúc nhập kho', () => {
    it('bỏ trống tình trạng thì hiểu là Tốt', () => {
      const prisma = buildPrisma({ categoryCode: 'CAM', existingCount: 0 });
      return new MemsCatalogService(prisma, photoUrlSignerStub)
        .createAsset({ modelId: 'model-1', serialNumber: 'SN-001' })
        .then(() => {
          expect(prisma.memsAsset.create.mock.calls[0][0].data.condition).toBe('GOOD');
        });
    });

    it('khai máy cũ có vết thì lưu đúng tình trạng đó', async () => {
      // Hàng đổi trả hay máy mua lại thường đã có vết; ép cứng là Tốt thì mọi lần đối chiếu
      // về sau đều lệch, và người mượn đầu tiên lãnh oan.
      const prisma = buildPrisma({ categoryCode: 'CAM', existingCount: 0 });
      await new MemsCatalogService(prisma, photoUrlSignerStub).createAsset({
        modelId: 'model-1',
        serialNumber: 'SN-002',
        condition: 'USED',
      });

      expect(prisma.memsAsset.create.mock.calls[0][0].data.condition).toBe('USED');
    });

    it('máy nhập về đã hỏng vẫn vào Chờ kiểm tra, không nhảy thẳng sang Hỏng', async () => {
      // BR-05 nói về TRẠNG THÁI quy trình, còn hỏng là TÌNH TRẠNG vật lý — hai trục khác nhau.
      const prisma = buildPrisma({ categoryCode: 'CAM', existingCount: 0 });
      await new MemsCatalogService(prisma, photoUrlSignerStub).createAsset({
        modelId: 'model-1',
        serialNumber: 'SN-003',
        condition: 'BROKEN',
      });

      const data = prisma.memsAsset.create.mock.calls[0][0].data;
      expect(data.status).toBe('PENDING_INSPECTION');
      expect(data.condition).toBe('BROKEN');
    });

    it('ghi mốc Nhập kho vào nhật ký vòng đời', async () => {
      // Thiếu mốc này thì màn chi tiết của máy chưa ai mượn trông như máy không có quá khứ.
      const prisma = buildPrisma({ categoryCode: 'CAM', existingCount: 0 });
      await new MemsCatalogService(prisma, photoUrlSignerStub).createAsset({
        modelId: 'model-1',
        serialNumber: 'SN-004',
        condition: 'USED',
        intakeNote: 'Hàng đổi trả, xước mặt lưng',
      });

      const ev = prisma.memsAssetEvent.create.mock.calls[0][0].data;
      expect(ev).toMatchObject({ kind: 'INTAKE', title: 'Nhập kho' });
      expect(ev.detail).toContain('tình trạng khi nhập USED');
      expect(ev.detail).toContain('Hàng đổi trả, xước mặt lưng');
    });

    it('không có ghi chú thì nhật ký vẫn nêu tình trạng, không để đuôi thừa', async () => {
      const prisma = buildPrisma({ categoryCode: 'CAM', existingCount: 0 });
      await new MemsCatalogService(prisma, photoUrlSignerStub).createAsset({
        modelId: 'model-1',
        serialNumber: 'SN-005',
      });

      expect(prisma.memsAssetEvent.create.mock.calls[0][0].data.detail).toBe('tình trạng khi nhập GOOD');
    });
  });

  describe('intakeStatusFor — tình trạng khai lúc nhập quyết định máy đi đâu', () => {
    it('máy tốt hoặc chỉ có dấu hiệu sử dụng thì vào kệ ngay', () => {
      expect(intakeStatusFor('GOOD')).toBe('AVAILABLE');
      expect(intakeStatusFor('USED')).toBe('AVAILABLE');
    });

    it('máy khai là hỏng đi Chờ kiểm tra', () => {
      // Hai trục khác nhau: `status` là vị trí quy trình, `condition` là chất lượng vật lý. Tình
      // trạng vẫn ghi đúng là BROKEN, nhưng để nó ở Sẵn sàng thì phép đếm khả dụng hứa với người
      // mượn kế tiếp một chiếc máy không dùng được, và không ai biết cho tới lúc bàn giao.
      expect(intakeStatusFor('BROKEN')).toBe('PENDING_INSPECTION');
    });

    it('máy cần kiểm tra hoặc đang sửa cũng đi Chờ kiểm tra', () => {
      expect(intakeStatusFor('NEEDS_CHECK')).toBe('PENDING_INSPECTION');
      expect(intakeStatusFor('IN_MAINTENANCE')).toBe('PENDING_INSPECTION');
    });
  });
});

describe('Tạo model', () => {
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
      await new MemsCatalogService(prisma, photoUrlSignerStub).createModel(DTO);

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
        new MemsCatalogService(prisma, photoUrlSignerStub).createModel(DTO),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('lọc trùng theo cả danh mục lẫn tên, không chỉ theo tên', async () => {
      // findFirst lọc theo cả category_id, nên tên giống ở danh mục khác không đụng nhau.
      const { prisma } = buildPrisma();
      await new MemsCatalogService(prisma, photoUrlSignerStub).createModel(DTO);

      expect(prisma.memsAssetModel.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { category_id: 'cat-1', name: 'Sony A7 IV' },
        }),
      );
    });

    it('không khai phụ kiện thì vẫn tạo được model', async () => {
      const { prisma, created } = buildPrisma();
      await new MemsCatalogService(prisma, photoUrlSignerStub).createModel({
        categoryId: 'cat-1',
        name: 'Manfrotto 055',
      });

      expect(created.args.data.accessories.create).toEqual([]);
    });

    it('bỏ trống hãng và giá thì lưu null, không lưu undefined', async () => {
      // Prisma bỏ qua undefined, cột sẽ giữ giá trị cũ khi dùng lại hàm này cho cập nhật sau này.
      const { prisma, created } = buildPrisma();
      await new MemsCatalogService(prisma, photoUrlSignerStub).createModel({
        categoryId: 'cat-1',
        name: 'Manfrotto 055',
      });

      expect(created.args.data.manufacturer).toBeNull();
      expect(created.args.data.reference_price).toBeNull();
    });
  });
});

describe('Xoá thiết bị', () => {
  /**
   * Chức năng: xoá một thiết bị khỏi kho.
   *
   * Vì sao đáng một file test riêng: đây là thao tác duy nhất đưa một chiếc máy ra khỏi mọi phép
   * đếm, và nó phải chặn đúng lúc. Chặn hụt thì máy đang ở ngoài công ty biến mất khỏi hệ thống —
   * không phiếu nào theo dõi nó nữa. Chặn thừa thì máy hỏng nằm lại kho vĩnh viễn.
   *
   * QĐ-07: không bao giờ xoá cứng. Bản ghi chỉ chuyển sang ngừng dùng để giữ trọn lịch sử mượn trả
   * và nhật ký vòng đời.
   */

  const ASSET = {
    id: 'asset-1',
    asset_code: 'CAM-001',
    status: 'AVAILABLE',
    reservations: [],
    handoverLines: [],
  };

  function buildDeps(over: Partial<any> = {}) {
    const asset = over.asset === undefined ? ASSET : over.asset;
    const tx = {
      memsAsset: { update: jest.fn(async ({ data }: any) => ({ ...asset, ...data })) },
      memsAssetEvent: { create: jest.fn(async ({ data }: any) => data) },
    };
    const prisma: any = {
      memsAsset: { findUnique: jest.fn(async (_args: any) => asset) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    return { service: new MemsCatalogService(prisma, photoUrlSignerStub), prisma, tx };
  }

  describe('MemsCatalogService.deleteAsset — khi nào chặn', () => {
    it('máy đang mượn thì không xoá được', async () => {
      // Xoá được thì chiếc đang nằm ngoài công ty biến khỏi hệ thống mà vẫn chưa ai mang về.
      const { service, tx } = buildDeps({ asset: { ...ASSET, status: 'ON_LOAN' } });

      await expect(service.deleteAsset('CAM-001')).rejects.toBeInstanceOf(ConflictException);
      expect(tx.memsAsset.update).not.toHaveBeenCalled();
    });

    it('máy còn giữ chỗ cho phiếu sắp tới thì không xoá được', async () => {
      // Xoá đi là phiếu đã duyệt mất máy mà không báo gì, kho chỉ phát hiện lúc đứng ra bàn giao.
      const { service, tx } = buildDeps({
        asset: { ...ASSET, reservations: [{ id: 'rsv-1', status: 'CONFIRMED' }] },
      });

      await expect(service.deleteAsset('CAM-001')).rejects.toBeInstanceOf(ConflictException);
      expect(tx.memsAsset.update).not.toHaveBeenCalled();
    });

    it('máy còn dòng bàn giao chưa khép của phiếu đang mượn thì không xoá được', async () => {
      const { service, tx } = buildDeps({
        asset: { ...ASSET, handoverLines: [{ id: 'hl-1' }] },
      });

      await expect(service.deleteAsset('CAM-001')).rejects.toBeInstanceOf(ConflictException);
      expect(tx.memsAsset.update).not.toHaveBeenCalled();
    });

    it('chỉ hỏi giữ chỗ còn hiệu lực, không tính giữ chỗ đã nhả', async () => {
      // Giữ chỗ của phiếu đã huỷ hay đã trả xong mang trạng thái RELEASED; tính cả chúng thì một
      // chiếc máy từng được mượn sẽ không bao giờ xoá được nữa.
      const { service, prisma } = buildDeps();
      await service.deleteAsset('CAM-001');

      const include = prisma.memsAsset.findUnique.mock.calls[0][0].include;
      expect(include.reservations.where.status.in).toEqual(['TENTATIVE', 'CONFIRMED']);
    });

    it('máy không tồn tại thì báo không tìm thấy', async () => {
      const { service } = buildDeps({ asset: null });

      await expect(service.deleteAsset('CAM-999')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('MemsCatalogService.deleteAsset — xoá mềm', () => {
    it('QĐ-07: đánh dấu ngừng dùng và thanh lý, KHÔNG xoá cứng bản ghi', async () => {
      // Xoá cứng là mất trọn lịch sử mượn trả của chiếc máy đó, kể cả những lượt đã quy trách nhiệm.
      const { service, tx } = buildDeps();

      await service.deleteAsset('CAM-001');

      expect(tx.memsAsset.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { is_disabled: true, status: 'DISPOSED' } }),
      );
    });

    it('để lại một mốc trong nhật ký vòng đời', async () => {
      // Máy biến khỏi bảng kho mà không có dòng nào giải thích thì lần kiểm kê sau không ai truy được.
      const { service, tx } = buildDeps();

      await service.deleteAsset('CAM-001');

      expect(tx.memsAssetEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ asset_id: 'asset-1', title: 'Xóa khỏi kho' }),
        }),
      );
    });

    it('máy hỏng vẫn xoá được — không chặn thừa', async () => {
      const { service, tx } = buildDeps({ asset: { ...ASSET, status: 'BROKEN' } });

      await service.deleteAsset('CAM-001');

      expect(tx.memsAsset.update).toHaveBeenCalled();
    });
  });
});

describe('Quản lý vị trí', () => {
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
});

describe('Sửa thiết bị', () => {
  /**
   * Sửa thông tin một máy đã nằm trong kho.
   *
   * Hai thứ được canh ở đây: serial vẫn phải duy nhất toàn hệ thống (BR-04), và mọi lần sửa
   * phải để lại vết trong nhật ký vòng đời — máy không có quá khứ thì mọi lần đối chiếu về sau
   * đều phải tin vào trí nhớ của người sửa.
   */

  const ASSET = {
    id: 'asset-1',
    asset_code: 'CAM-001',
    model_id: 'model-1',
    serial_number: 'SN-CU',
    location_id: 'loc-1',
    purchase_date: null,
    purchase_price: null,
    condition: 'GOOD',
    status: 'AVAILABLE',
  };

  function buildDeps(
    over: {
      asset?: any;
      duplicated?: any;
      activeReservations?: number;
      handoverCount?: number;
    } = {},
  ) {
    const asset = over.asset === undefined ? ASSET : over.asset;
    const tx = {
      memsAsset: { update: jest.fn(async ({ data }: any) => ({ ...asset, ...data })) },
      memsAssetEvent: { create: jest.fn(async ({ data }: any) => data) },
      memsMaintenance: {
        create: jest.fn(async ({ data }: any) => data),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const prisma: any = {
      memsAsset: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.serial_number ? (over.duplicated ?? null) : asset,
        ),
      },
      memsReservation: { count: jest.fn(async () => over.activeReservations ?? 0) },
      memsHandoverLine: { count: jest.fn(async () => over.handoverCount ?? 0) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    return { prisma, tx };
  }

  describe('MemsCatalogService.updateAsset', () => {
    it('không có máy mang mã đó thì báo không tìm thấy', async () => {
      const { prisma } = buildDeps({ asset: null });
      await expect(
        new MemsCatalogService(prisma, photoUrlSignerStub).updateAsset('CAM-999', {
          condition: 'GOOD',
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('BR-04: đổi sang serial đã thuộc máy khác thì chặn và nêu rõ máy đang giữ', async () => {
      // Câu báo lỗi phải chỉ thẳng vào máy đang trùng: kho hay nhập nhầm lô đổi trả, mà câu
      // "serial đã tồn tại" trống trơn thì không tra ra được máy nào.
      const { prisma, tx } = buildDeps({
        duplicated: { id: 'asset-2', asset_code: 'CAM-007', serial_number: 'SN-MOI' },
      });

      await expect(
        new MemsCatalogService(prisma, photoUrlSignerStub).updateAsset('CAM-001', {
          serialNumber: 'SN-MOI',
        } as any),
      ).rejects.toThrow(/CAM-007/);
      expect(tx.memsAsset.update).not.toHaveBeenCalled();
    });

    it('giữ nguyên serial cũ thì không bị chính mình chặn', async () => {
      // Sửa tình trạng máy mà vẫn gửi kèm serial cũ là chuyện thường của form; coi đó là trùng
      // thì không ai sửa được gì.
      const { prisma, tx } = buildDeps();
      await new MemsCatalogService(prisma, photoUrlSignerStub).updateAsset('CAM-001', {
        serialNumber: 'SN-CU',
        condition: 'FAIR',
      } as any);

      expect(tx.memsAsset.update).toHaveBeenCalled();
    });

    it('trường bỏ trống thì giữ nguyên giá trị cũ, không ghi đè thành null', async () => {
      const { prisma, tx } = buildDeps();
      await new MemsCatalogService(prisma, photoUrlSignerStub).updateAsset('CAM-001', {
        condition: 'FAIR',
      } as any);

      const data = tx.memsAsset.update.mock.calls[0][0].data;
      expect(data.condition).toBe('FAIR');
      expect(data.serial_number).toBe('SN-CU');
      expect(data.model_id).toBe('model-1');
      expect(data.location_id).toBe('loc-1');
    });

    it('mỗi lần sửa đều ghi một mốc vào nhật ký vòng đời', async () => {
      const { prisma, tx } = buildDeps();
      await new MemsCatalogService(prisma, photoUrlSignerStub).updateAsset('CAM-001', {
        condition: 'FAIR',
      } as any);

      expect(tx.memsAssetEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ asset_id: 'asset-1', title: 'Cập nhật thông tin' }),
        }),
      );
    });
  });

  describe('MemsCatalogService.updateAsset — đổi model khi máy đang được hứa cho ai đó', () => {
    it('máy còn giữ chỗ thì không đổi model được', async () => {
      // Giữ chỗ ghi ở MỨC MODEL (QĐ-01): phiếu đặt "một chiếc A7 IV" chứ không đặt đích danh máy.
      // Đổi model của một chiếc đang được ghim vào phiếu là rút chiếc đó khỏi phép đếm khả dụng
      // của model cũ mà không có lỗi nào báo — kho chỉ phát hiện vào đúng lúc đứng ra bàn giao.
      const { prisma, tx } = buildDeps({ activeReservations: 1 });

      await expect(
        new MemsCatalogService(prisma, photoUrlSignerStub).updateAsset('CAM-001', {
          modelId: 'model-2',
        } as any),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(tx.memsAsset.update).not.toHaveBeenCalled();
    });

    it('máy không còn giữ chỗ nào thì đổi model bình thường', async () => {
      const { prisma, tx } = buildDeps({ activeReservations: 0 });

      await new MemsCatalogService(prisma, photoUrlSignerStub).updateAsset('CAM-001', {
        modelId: 'model-2',
      } as any);

      expect(tx.memsAsset.update.mock.calls[0][0].data.model_id).toBe('model-2');
    });

    it('giữ nguyên model thì không bị chính luật này chặn', async () => {
      // Form sửa luôn gửi lại model hiện tại kèm mọi lần đổi vị trí hay giá mua. Chặn cứng thì
      // máy đang có phiếu không sửa nổi vị trí.
      const { prisma, tx } = buildDeps({ activeReservations: 3 });

      await new MemsCatalogService(prisma, photoUrlSignerStub).updateAsset('CAM-001', {
        modelId: 'model-1',
        locationId: 'loc-9',
      } as any);

      expect(tx.memsAsset.update).toHaveBeenCalled();
    });
  });

  describe('MemsCatalogService.updateAsset — trạng thái do quy trình sinh ra', () => {
    it.each(['ON_LOAN', 'POST_RETURN_CHECK'])('không đặt tay được sang %s', async (status) => {
      // Đặt tay ON_LOAN là đi vòng qua màn Bàn giao: máy thành "đang mượn" mà không có biên bản
      // nào, không ảnh, không ai ký — đúng thứ MEMS sinh ra để dẹp.
      const { prisma, tx } = buildDeps();
      await expect(
        new MemsCatalogService(prisma, photoUrlSignerStub).updateAsset('CAM-001', { status } as any),
      ).rejects.toThrow(/Bàn giao hoặc Nhận trả/);

      expect(tx.memsAsset.update).not.toHaveBeenCalled();
    });

    it('máy ĐANG ở trạng thái đó thì gửi lại chính nó vẫn được', async () => {
      // Ô select hiện trạng thái đang có làm lựa chọn đầu tiên, nên form sửa vị trí của một máy
      // đang mượn luôn gửi kèm ON_LOAN. Chặn cứng thì không sửa nổi vị trí máy đang ở ngoài.
      const { prisma, tx } = buildDeps({ asset: { ...ASSET, status: 'ON_LOAN' } });
      await new MemsCatalogService(prisma, photoUrlSignerStub).updateAsset('CAM-001', {
        status: 'ON_LOAN',
        locationId: 'loc-9',
      } as any);

      expect(tx.memsAsset.update.mock.calls[0][0].data.status).toBe('ON_LOAN');
    });

    it.each(['AVAILABLE', 'UNDER_MAINTENANCE', 'BROKEN'])(
      'máy đang mượn không đặt tay về %s được',
      async (status) => {
        // Luật cũ chỉ chặn chiều ĐI VÀO. Chiều đi ra bỏ ngỏ nên một chiếc máy đang ở ngoài có thể
        // bị sửa tay về Sẵn sàng: nó quay lại phép đếm khả dụng và danh sách máy gán được, trong
        // khi phiếu vẫn Đang mượn và chưa ai mang máy về. Máy chỉ rời ON_LOAN qua màn Nhận trả.
        const { prisma, tx } = buildDeps({ asset: { ...ASSET, status: 'ON_LOAN' } });

        await expect(
          new MemsCatalogService(prisma, photoUrlSignerStub).updateAsset('CAM-001', { status } as any),
        ).rejects.toThrow(/Nhận trả/);

        expect(tx.memsAsset.update).not.toHaveBeenCalled();
      },
    );

    it('máy đang mượn VẪN đánh dấu Mất được', async () => {
      // Lối thoát duy nhất và cần thiết: chiếc máy không bao giờ quay về thì phải ghi nhận được
      // ngay, không thể bắt chờ một biên bản nhận trả sẽ không bao giờ có. An toàn vì LOST nằm
      // trong nhóm không cho mượn, nên máy rời khỏi phép đếm khả dụng chứ không quay lại.
      //
      // Màn sửa thiết bị bên FE cũng chỉ chào đúng lựa chọn này khi máy đang mượn
      // (`manualStatusOptionsFor`), nên chặn nốt là hiện nút mà bấm vào ăn 400.
      const { prisma, tx } = buildDeps({ asset: { ...ASSET, status: 'ON_LOAN' } });

      await new MemsCatalogService(prisma, photoUrlSignerStub).updateAsset('CAM-001', {
        status: 'LOST',
      } as any);

      expect(tx.memsAsset.update.mock.calls[0][0].data.status).toBe('LOST');
    });

    it.each(['AVAILABLE', 'UNDER_MAINTENANCE', 'BROKEN'])(
      'máy chờ kiểm tra sau trả không đặt tay về %s được',
      async (status) => {
        // Cửa đúng để rời POST_RETURN_CHECK là màn Kiểm tra (`POST /mems/assets/:code/inspect`),
        // vì chỉ ở đó kết luận Bảo trì mới sinh kèm lệnh bảo trì — đổi mỗi cột trạng thái thì máy
        // nằm ở xưởng vẫn hiện là rảnh trong mọi khoảng tương lai.
        //
        // Chốt này từng phải để mở vì giao diện chưa dựng màn Kiểm tra; giờ màn đó đã có
        // (`/dashboard/equipment/inspection`) nên đóng lại được mà không nhốt máy.
        const { prisma, tx } = buildDeps({ asset: { ...ASSET, status: 'POST_RETURN_CHECK' } });

        await expect(
          new MemsCatalogService(prisma, photoUrlSignerStub).updateAsset('CAM-001', { status } as any),
        ).rejects.toThrow(/Kiểm tra/);

        expect(tx.memsAsset.update).not.toHaveBeenCalled();
      },
    );

    it('máy chờ kiểm tra sau trả VẪN đánh dấu Mất được', async () => {
      // Màn Kiểm tra chỉ chào ba kết luận Đạt/Bảo trì/Hỏng, không có Mất. Chặn nốt lối này thì
      // một chiếc biến mất khỏi bàn kiểm tra không ghi nhận được ở đâu cả.
      const { prisma, tx } = buildDeps({ asset: { ...ASSET, status: 'POST_RETURN_CHECK' } });

      await new MemsCatalogService(prisma, photoUrlSignerStub).updateAsset('CAM-001', {
        status: 'LOST',
      } as any);

      expect(tx.memsAsset.update.mock.calls[0][0].data.status).toBe('LOST');
    });

    it('máy ở trạng thái thường vẫn đổi trạng thái tay bình thường', async () => {
      // Không siết nhầm sang các trạng thái mà kho vẫn phải tự đặt được.
      const { prisma, tx } = buildDeps({ asset: { ...ASSET, status: 'AVAILABLE' } });

      await new MemsCatalogService(prisma, photoUrlSignerStub).updateAsset('CAM-001', {
        status: 'BROKEN',
      } as any);

      expect(tx.memsAsset.update.mock.calls[0][0].data.status).toBe('BROKEN');
    });
  });

  /**
   * BR-04 nói serial "không sửa được sau khi tạo", nhưng code lại cho sửa tự do — hai bên nói
   * ngược nhau và không ai để ý.
   *
   * Chốt ở đường giữa: serial là mốc truy trách nhiệm KỂ TỪ LÚC máy được ghi vào một biên bản bàn
   * giao. Trước đó nó mới chỉ là một ô nhập có thể gõ nhầm, khoá cứng thì lỗi chính tả lúc nhập
   * kho không bao giờ sửa được và người ta sẽ xoá máy đi tạo lại — mất luôn nhật ký vòng đời.
   */
  describe('MemsCatalogService.updateAsset — serial sau khi máy đã đi vào biên bản', () => {
    it('máy chưa từng bàn giao thì sửa serial được', async () => {
      const { prisma, tx } = buildDeps({ handoverCount: 0 });

      await new MemsCatalogService(prisma, photoUrlSignerStub).updateAsset('CAM-001', {
        serialNumber: 'SN-MOI',
      } as any);

      expect(tx.memsAsset.update.mock.calls[0][0].data.serial_number).toBe('SN-MOI');
    });

    it('máy đã từng bàn giao thì KHÔNG đổi serial được nữa', async () => {
      const { prisma, tx } = buildDeps({ handoverCount: 3 });

      await expect(
        new MemsCatalogService(prisma, photoUrlSignerStub).updateAsset('CAM-001', {
          serialNumber: 'SN-MOI',
        } as any),
      ).rejects.toThrow(/biên bản/);

      expect(tx.memsAsset.update).not.toHaveBeenCalled();
    });

    it('gửi lại đúng serial cũ thì không bị chặn dù máy đã bàn giao', async () => {
      // Form sửa luôn gửi kèm serial hiện tại khi người dùng chỉ đổi vị trí hay giá mua.
      const { prisma, tx } = buildDeps({ handoverCount: 3 });

      await new MemsCatalogService(prisma, photoUrlSignerStub).updateAsset('CAM-001', {
        serialNumber: 'SN-CU',
        locationId: 'loc-9',
      } as any);

      expect(tx.memsAsset.update).toHaveBeenCalled();
    });
  });
});

describe('Sửa thiết bị — bảo trì', () => {
  /**
   * Sửa thông tin một máy đã nằm trong kho.
   *
   * Hai thứ được canh ở đây: serial vẫn phải duy nhất toàn hệ thống (BR-04), và mọi lần sửa
   * phải để lại vết trong nhật ký vòng đời — máy không có quá khứ thì mọi lần đối chiếu về sau
   * đều phải tin vào trí nhớ của người sửa.
   */

  const ASSET = {
    id: 'asset-1',
    asset_code: 'CAM-001',
    model_id: 'model-1',
    serial_number: 'SN-CU',
    location_id: 'loc-1',
    purchase_date: null,
    purchase_price: null,
    condition: 'GOOD',
    status: 'AVAILABLE',
  };

  function buildDeps(
    over: {
      asset?: any;
      duplicated?: any;
    } = {},
  ) {
    const asset = over.asset === undefined ? ASSET : over.asset;
    const tx = {
      memsAsset: { update: jest.fn(async ({ data }: any) => ({ ...asset, ...data })) },
      memsAssetEvent: { create: jest.fn(async ({ data }: any) => data) },
      memsMaintenance: {
        create: jest.fn(async ({ data }: any) => data),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const prisma: any = {
      memsAsset: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.serial_number ? (over.duplicated ?? null) : asset,
        ),
      },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    return { prisma, tx };
  }

  /**
   * Bảo trì bị loại khỏi khả dụng qua bảng `MemsMaintenance`, KHÔNG qua cột trạng thái —
   * `UNDER_MAINTENANCE` cố ý không nằm trong `NOT_USABLE_STATUSES` để một chiếc máy không bị
   * trừ hai lần. Hệ quả: đổi mỗi cột trạng thái là chưa làm gì cả.
   */
  describe('MemsCatalogService.updateAsset — đưa máy vào và ra khỏi bảo trì', () => {
    it('chuyển sang Bảo trì thì sinh lệnh bảo trì bỏ ngỏ điểm kết thúc', async () => {
      // Chỉ đổi cột trạng thái thì phép đếm khả dụng vẫn thấy máy rảnh trong mọi khoảng tương
      // lai, và nó được gán cho phiếu tiếp theo trong khi đang nằm ở chỗ thợ.
      const { prisma, tx } = buildDeps();
      await new MemsCatalogService(prisma, photoUrlSignerStub).updateAsset('CAM-001', {
        status: 'UNDER_MAINTENANCE',
        note: 'Gửi hãng thay cảm biến',
      } as any);

      expect(tx.memsMaintenance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            asset_id: 'asset-1',
            reason: 'Gửi hãng thay cảm biến',
            to_time: null,
          }),
        }),
      );
    });

    it('rời khỏi Bảo trì thì đóng lệnh còn bỏ ngỏ', async () => {
      // Không đóng thì lệnh bỏ ngỏ giữ máy bận vĩnh viễn — máy về kho rồi mà không ai mượn được,
      // và nhìn vào cột trạng thái thì mọi thứ trông vẫn bình thường.
      const { prisma, tx } = buildDeps({
        asset: { ...ASSET, status: 'UNDER_MAINTENANCE' },
      });
      await new MemsCatalogService(prisma, photoUrlSignerStub).updateAsset('CAM-001', {
        status: 'AVAILABLE',
      } as any);

      expect(tx.memsMaintenance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { asset_id: 'asset-1', to_time: null },
          data: { to_time: expect.any(Date) },
        }),
      );
    });

    it('sửa thứ khác mà vẫn ở Bảo trì thì không đụng tới lệnh bảo trì', async () => {
      // Ô select luôn gửi lại trạng thái hiện tại kèm mọi lần sửa serial hay vị trí. Coi đó là
      // một lần "chuyển sang bảo trì" thì mỗi lần sửa lại đẻ thêm một lệnh trùng.
      const { prisma, tx } = buildDeps({ asset: { ...ASSET, status: 'UNDER_MAINTENANCE' } });
      await new MemsCatalogService(prisma, photoUrlSignerStub).updateAsset('CAM-001', {
        status: 'UNDER_MAINTENANCE',
        locationId: 'loc-9',
      } as any);

      expect(tx.memsMaintenance.create).not.toHaveBeenCalled();
      expect(tx.memsMaintenance.updateMany).not.toHaveBeenCalled();
    });
  });
});

describe('Dùng lại serial của máy đã xoá', () => {
  describe('MemsCatalogService — giải phóng và tái sử dụng số serial khi xoá thiết bị', () => {
    describe('deleteAsset — giải phóng serial của thiết bị bị xoá', () => {
      it('khi xoá máy (soft-delete), số serial được đổi hậu tố __deleted_ để nhường lại serial gốc', async () => {
        const asset = {
          id: 'asset-1',
          asset_code: 'CAM-001',
          serial_number: 'SN-CANON-001',
          status: 'AVAILABLE',
          reservations: [],
          handoverLines: [],
        };

        const tx = {
          memsAsset: {
            update: jest.fn(async ({ data }: any) => ({ ...asset, ...data })),
          },
          memsAssetEvent: {
            create: jest.fn(async ({ data }: any) => data),
          },
        };

        const prisma: any = {
          memsAsset: {
            findUnique: jest.fn(async () => asset),
          },
          $transaction: jest.fn(async (fn: any) => fn(tx)),
        };

        const service = new MemsCatalogService(prisma, photoUrlSignerStub);
        const res = await service.deleteAsset('CAM-001');

        expect(res.success).toBe(true);
        expect(tx.memsAsset.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'asset-1' },
            data: expect.objectContaining({
              is_disabled: true,
              status: 'DISPOSED',
              serial_number: expect.stringMatching(/^SN-CANON-001__deleted_/),
            }),
          }),
        );
      });
    });

    describe('createAsset — tái sử dụng serial của máy đã bị xoá', () => {
      it('chặn thêm máy mới nếu serial đang thuộc một máy đang hoạt động (is_disabled: false)', async () => {
        const prisma: any = {
          memsAsset: {
            findUnique: jest.fn(async () => ({
              id: 'active-asset',
              asset_code: 'CAM-002',
              is_disabled: false,
            })),
          },
        };

        const service = new MemsCatalogService(prisma, photoUrlSignerStub);

        await expect(
          service.createAsset({
            modelId: 'model-1',
            serialNumber: 'SN-CANON-001',
          }),
        ).rejects.toThrow(ConflictException);
      });

      it('cho phép thêm máy mới trùng serial với máy ĐÃ BỊ XOÁ (is_disabled: true), tự động giải phóng serial cũ', async () => {
        const deletedAssetId = 'deleted-asset-uuid-1234';
        const createdAsset = {
          id: 'new-asset-uuid',
          asset_code: 'CAM-003',
          serial_number: 'SN-CANON-001',
          status: 'AVAILABLE',
          condition: 'GOOD',
        };

        const tx = {
          $executeRawUnsafe: jest.fn(async () => 1),
          memsAsset: {
            update: jest.fn(async ({ data }: any) => data),
            count: jest.fn(async () => 2),
            create: jest.fn(async ({ data }: any) => ({ id: 'new-asset-uuid', ...data })),
          },
          memsAssetEvent: {
            create: jest.fn(async ({ data }: any) => data),
          },
        };

        const prisma: any = {
          memsAsset: {
            findUnique: jest.fn(async () => ({
              id: deletedAssetId,
              asset_code: 'CAM-001',
              is_disabled: true,
            })),
            count: jest.fn(async () => 2),
          },
          memsAssetModel: {
            findUniqueOrThrow: jest.fn(async () => ({
              id: 'model-1',
              category: { code: 'CAM' },
            })),
          },
          $transaction: jest.fn(async (fn: any) => fn(tx)),
        };

        const service = new MemsCatalogService(prisma, photoUrlSignerStub);
        const result = await service.createAsset({
          modelId: 'model-1',
          serialNumber: 'SN-CANON-001',
        });

        expect(result.serial_number).toBe('SN-CANON-001');
        // Đã giải phóng serial của máy cũ
        expect(tx.memsAsset.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: deletedAssetId },
            data: expect.objectContaining({
              serial_number: expect.stringMatching(/^SN-CANON-001__deleted_/),
            }),
          }),
        );
        // Tạo thành công máy mới với serial gốc
        expect(tx.memsAsset.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              serial_number: 'SN-CANON-001',
              status: 'AVAILABLE',
            }),
          }),
        );
      });
    });

    describe('updateAsset — đổi sang serial của máy đã bị xoá', () => {
      it('cho phép đổi serial của máy sang serial của máy đã bị xoá (is_disabled: true)', async () => {
        const activeAsset = {
          id: 'current-asset',
          asset_code: 'CAM-005',
          serial_number: 'SN-OLD',
          model_id: 'model-1',
          status: 'AVAILABLE',
          condition: 'GOOD',
        };

        const deletedAsset = {
          id: 'deleted-asset-uuid-5678',
          asset_code: 'CAM-001',
          is_disabled: true,
        };

        const tx = {
          memsAsset: {
            update: jest.fn(async ({ data }: any) => ({ ...activeAsset, ...data })),
          },
          memsAssetEvent: {
            create: jest.fn(async ({ data }: any) => data),
          },
          memsMaintenance: {
            updateMany: jest.fn(async () => ({ count: 0 })),
            create: jest.fn(async () => ({})),
          },
        };

        const prisma: any = {
          memsAsset: {
            findUnique: jest.fn(async ({ where }: any) => {
              if (where.asset_code) return activeAsset;
              if (where.serial_number === 'SN-TARGET') return deletedAsset;
              return null;
            }),
          },
          memsHandoverLine: {
            count: jest.fn(async () => 0),
          },
          $transaction: jest.fn(async (fn: any) => fn(tx)),
        };

        const service = new MemsCatalogService(prisma, photoUrlSignerStub);
        const res = await service.updateAsset('CAM-005', {
          serialNumber: 'SN-TARGET',
        });

        expect(tx.memsAsset.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'deleted-asset-uuid-5678' },
            data: expect.objectContaining({
              serial_number: expect.stringMatching(/^SN-TARGET__deleted_/),
            }),
          }),
        );
        expect(res.serial_number).toBe('SN-TARGET');
      });
    });
  });
});

describe('Nhập kho số lượng lớn', () => {
  describe('MemsCatalogService.createAsset — Nhập thiết bị số lượng lớn (Bulk Intake)', () => {
    it('tạo 2 máy cùng model với danh sách serial riêng biệt (123456 và 789012)', async () => {
      const createdList: any[] = [];
      const tx = {
        $executeRawUnsafe: jest.fn(async () => 1),
        memsAsset: {
          count: jest.fn(async () => 0),
          create: jest.fn(async ({ data }: any) => {
            const item = { id: `asset-${createdList.length + 1}`, ...data };
            createdList.push(item);
            return item;
          }),
        },
        memsAssetEvent: {
          create: jest.fn(async ({ data }: any) => data),
        },
      };

      const prisma: any = {
        memsAsset: {
          findUnique: jest.fn(async () => null),
        },
        memsAssetModel: {
          findUniqueOrThrow: jest.fn(async () => ({
            id: 'model-a7',
            category: { code: 'CAM' },
          })),
        },
        $transaction: jest.fn(async (fn: any) => fn(tx)),
      };

      const service = new MemsCatalogService(prisma, photoUrlSignerStub);
      const result: any = await service.createAsset({
        modelId: 'model-a7',
        serialNumbers: ['123456', '789012'],
        quantity: 2,
      });

      expect(result.totalCreated).toBe(2);
      expect(result.assets).toHaveLength(2);
      expect(result.assets[0].serial_number).toBe('123456');
      expect(result.assets[0].asset_code).toBe('CAM-001');
      expect(result.assets[1].serial_number).toBe('789012');
      expect(result.assets[1].asset_code).toBe('CAM-002');
    });

    it('nhập số lượng 3 với 1 serial cơ sở -> tự động sinh đuôi -01, -02, -03', async () => {
      const createdList: any[] = [];
      const tx = {
        $executeRawUnsafe: jest.fn(async () => 1),
        memsAsset: {
          count: jest.fn(async () => 5),
          create: jest.fn(async ({ data }: any) => {
            const item = { id: `asset-${createdList.length + 1}`, ...data };
            createdList.push(item);
            return item;
          }),
        },
        memsAssetEvent: {
          create: jest.fn(async ({ data }: any) => data),
        },
      };

      const prisma: any = {
        memsAsset: {
          findUnique: jest.fn(async () => null),
        },
        memsAssetModel: {
          findUniqueOrThrow: jest.fn(async () => ({
            id: 'model-trp',
            category: { code: 'TRP' },
          })),
        },
        $transaction: jest.fn(async (fn: any) => fn(tx)),
      };

      const service = new MemsCatalogService(prisma, photoUrlSignerStub);
      const result: any = await service.createAsset({
        modelId: 'model-trp',
        serialNumber: 'TRP-YUNTENG',
        quantity: 3,
      });

      expect(result.totalCreated).toBe(3);
      expect(result.assets[0].serial_number).toBe('TRP-YUNTENG-01');
      expect(result.assets[0].asset_code).toBe('TRP-006');
      expect(result.assets[1].serial_number).toBe('TRP-YUNTENG-02');
      expect(result.assets[1].asset_code).toBe('TRP-007');
      expect(result.assets[2].serial_number).toBe('TRP-YUNTENG-03');
      expect(result.assets[2].asset_code).toBe('TRP-008');
    });

    it('chặn nếu danh sách serial gửi lên có 2 số trùng nhau', async () => {
      const prisma: any = {};
      const service = new MemsCatalogService(prisma, photoUrlSignerStub);

      await expect(
        service.createAsset({
          modelId: 'model-1',
          serialNumbers: ['DUPLICATE-SN', 'DUPLICATE-SN'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('chặn nếu một trong các serial đang thuộc về máy khác đang hoạt động', async () => {
      const prisma: any = {
        memsAsset: {
          findUnique: jest.fn(async ({ where }: any) => {
            if (where.serial_number === 'TAKEN-SN') {
              return { id: 'other-id', asset_code: 'CAM-099', is_disabled: false };
            }
            return null;
          }),
        },
      };
      const service = new MemsCatalogService(prisma, photoUrlSignerStub);

      await expect(
        service.createAsset({
          modelId: 'model-1',
          serialNumbers: ['VALID-SN', 'TAKEN-SN'],
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});

describe('Xoá danh mục và model', () => {
  describe('MemsCatalogService — Xóa Danh mục & Model thiết bị', () => {
    describe('deleteModel', () => {
      it('xóa model thành công khi không có thiết bị hoạt động (0 máy)', async () => {
        const model = {
          id: 'model-1',
          name: 'Model Test',
          assets: [],
        };

        const prisma: any = {
          memsAssetModel: {
            findUnique: jest.fn(async () => model),
            update: jest.fn(async ({ data }: any) => ({ ...model, ...data })),
          },
        };

        const service = new MemsCatalogService(prisma, photoUrlSignerStub);
        const res = await service.deleteModel('model-1');

        expect(prisma.memsAssetModel.update).toHaveBeenCalledWith({
          where: { id: 'model-1' },
          data: { is_disabled: true },
        });
        expect(res.is_disabled).toBe(true);
      });

      it('chặn xóa model khi đang có thiết bị hoạt động trong kho', async () => {
        const model = {
          id: 'model-2',
          name: 'Sony A7 IV',
          assets: [{ id: 'a-1', asset_code: 'CAM-001' }],
        };

        const prisma: any = {
          memsAssetModel: {
            findUnique: jest.fn(async () => model),
          },
        };

        const service = new MemsCatalogService(prisma, photoUrlSignerStub);
        await expect(service.deleteModel('model-2')).rejects.toBeInstanceOf(ConflictException);
      });

      it('báo lỗi NotFoundException khi model không tồn tại', async () => {
        const prisma: any = {
          memsAssetModel: {
            findUnique: jest.fn(async () => null),
          },
        };

        const service = new MemsCatalogService(prisma, photoUrlSignerStub);
        await expect(service.deleteModel('unknown-model')).rejects.toBeInstanceOf(NotFoundException);
      });
    });

    describe('deleteCategory', () => {
      it('xóa danh mục thành công khi không có thiết bị hoạt động', async () => {
        const category = {
          id: 'cat-1',
          name: 'Danh mục Test',
          models: [{ id: 'm-1', assets: [] }],
        };

        const tx = {
          memsAssetModel: {
            updateMany: jest.fn(async () => ({ count: 1 })),
          },
          memsCategory: {
            update: jest.fn(async ({ data }: any) => ({ ...category, ...data })),
          },
        };

        const prisma: any = {
          memsCategory: {
            findUnique: jest.fn(async () => category),
          },
          $transaction: jest.fn(async (fn: any) => fn(tx)),
        };

        const service = new MemsCatalogService(prisma, photoUrlSignerStub);
        const res = await service.deleteCategory('cat-1');

        expect(tx.memsAssetModel.updateMany).toHaveBeenCalledWith({
          where: { category_id: 'cat-1' },
          data: { is_disabled: true },
        });
        expect(tx.memsCategory.update).toHaveBeenCalledWith({
          where: { id: 'cat-1' },
          data: { is_disabled: true },
        });
        expect(res.is_disabled).toBe(true);
      });

      it('chặn xóa danh mục khi có thiết bị hoạt động trong các model con', async () => {
        const category = {
          id: 'cat-2',
          name: 'Camera',
          models: [{ id: 'm-2', assets: [{ id: 'a-2', asset_code: 'CAM-002' }] }],
        };

        const prisma: any = {
          memsCategory: {
            findUnique: jest.fn(async () => category),
          },
        };

        const service = new MemsCatalogService(prisma, photoUrlSignerStub);
        await expect(service.deleteCategory('cat-2')).rejects.toBeInstanceOf(ConflictException);
      });

      it('báo lỗi NotFoundException khi danh mục không tồn tại', async () => {
        const prisma: any = {
          memsCategory: {
            findUnique: jest.fn(async () => null),
          },
        };

        const service = new MemsCatalogService(prisma, photoUrlSignerStub);
        await expect(service.deleteCategory('unknown-cat')).rejects.toBeInstanceOf(NotFoundException);
      });
    });
  });
});
