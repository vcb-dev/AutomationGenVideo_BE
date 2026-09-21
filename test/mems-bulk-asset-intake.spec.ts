import { BadRequestException, ConflictException } from '@nestjs/common';
import { MemsCatalogService } from '../src/modules/mems-catalog/mems-catalog.service';
import { photoUrlSignerStub } from '../src/common/mems/__tests__/photo-url-signer.stub';

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
