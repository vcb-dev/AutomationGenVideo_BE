import { buildCreateDeps, oneLine } from './support/mems-borrow-fixtures';
import { ApprovalService } from '../src/modules/mems-borrow/approval.service';
import { MemsCatalogService } from '../src/modules/mems-catalog/mems-catalog.service';
import { AvailabilityService } from '../src/modules/mems-borrow/availability.service';

describe('MEMS Workflow v2 — Ghi chú, Ảnh đính kèm, Tự sinh serial và Lọc máy quá hạn', () => {
  describe('Tạo phiếu kèm ảnh đính kèm và ghi chú', () => {
    it('lưu ghi chú và danh sách ảnh đính kèm của người mượn vào phiếu mượn', async () => {
      const { service, created } = buildCreateDeps();

      await service.create('user-1', {
        ...oneLine(),
        note: 'Cần mượn thêm chân đèn nếu có',
        photos: ['https://storage.googleapis.com/test-bucket/req1.jpg'],
      });

      expect(created.request.note).toBeDefined();
      const parsed = JSON.parse(created.request.note);
      expect(parsed.text).toBe('Cần mượn thêm chân đèn nếu có');
      expect(parsed.photos).toEqual(['https://storage.googleapis.com/test-bucket/req1.jpg']);
    });

    it('nếu không có ghi chú và ảnh thì note lưu null', async () => {
      const { service, created } = buildCreateDeps();

      await service.create('user-1', oneLine());

      expect(created.request.note).toBeNull();
    });

    it('ApprovalService.decorate trích xuất đúng note và photos từ chuỗi JSON', () => {
      const prismaMock: any = {};
      const service = new ApprovalService(prismaMock);

      const decorated = (service as any).decorate({
        id: 'req-1',
        owner_id: 'user-1',
        lines: [],
        approvals: [],
        from_time: new Date(),
        to_time: new Date(),
        place: 'Studio',
        note: JSON.stringify({
          text: 'Ghi chú cho leader',
          photos: ['http://example.com/p1.png', 'http://example.com/p2.png'],
        }),
      });

      expect(decorated.note).toBe('Ghi chú cho leader');
      expect(decorated.photos).toEqual([
        'http://example.com/p1.png',
        'http://example.com/p2.png',
      ]);
    });
  });

  describe('Tự sinh serial khi nhập kho thiết bị', () => {
    it('tự động sinh serial định dạng SN-[PREFIX]-[SUFFIX] nếu người dùng để trống serial', async () => {
      let createdAssetData: any = null;
      const prismaMock: any = {
        memsAssetModel: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'model-trp',
            category: { code: 'TRP' },
          }),
        },
        memsAsset: {
          findUnique: jest.fn().mockResolvedValue(null),
          count: jest.fn().mockResolvedValue(5),
          create: jest.fn().mockImplementation((args) => {
            createdAssetData = args.data;
            return { id: 'asset-1', ...args.data };
          }),
        },
        memsAssetEvent: {
          create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
        },
        $transaction: jest.fn().mockImplementation(async (cb) => {
          return cb({
            $executeRawUnsafe: jest.fn(),
            memsAsset: prismaMock.memsAsset,
            memsAssetEvent: prismaMock.memsAssetEvent,
          });
        }),
      };

      const photoUrlsMock: any = { signAll: jest.fn(), sign: jest.fn() };
      const catalogService = new MemsCatalogService(prismaMock, photoUrlsMock);

      const result: any = await catalogService.createAsset({
        modelId: 'model-trp',
        serialNumber: '', // để trống
        quantity: 1,
      });

      expect(result).toBeDefined();
      expect(createdAssetData.serial_number).toMatch(/^SN-TRP-/);
      expect(createdAssetData.asset_code).toBe('TRP-006');
    });
  });

  describe('freeAssets — Lọc máy đang quá hạn trả', () => {
    it('loại trừ các máy nằm trong handover quá hạn chưa trả', async () => {
      const prismaMock: any = {
        memsAssetModel: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'model-1',
            category: { buffer_minutes: 0 },
          }),
        },
        memsAsset: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'asset-good', asset_code: 'CAM-001', condition: 'GOOD' },
            { id: 'asset-overdue', asset_code: 'CAM-002', condition: 'GOOD' },
          ]),
        },
        memsReservation: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        memsMaintenance: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        memsHandoverLine: {
          findMany: jest.fn().mockResolvedValue([
            { asset_id: 'asset-overdue' },
          ]),
        },
      };

      const availabilityService = new AvailabilityService(prismaMock);
      const free = await availabilityService.freeAssets({
        modelId: 'model-1',
        fromTime: new Date('2026-10-19T10:00:00Z'),
        toTime: new Date('2026-10-19T18:00:00Z'),
      });

      expect(free.map((a) => a.id)).toEqual(['asset-good']);
      expect(free.find((a) => a.id === 'asset-overdue')).toBeUndefined();
    });
  });
});
