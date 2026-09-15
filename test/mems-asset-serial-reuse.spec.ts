import { ConflictException } from '@nestjs/common';
import { MemsCatalogService } from '../src/modules/mems-catalog/mems-catalog.service';
import { photoUrlSignerStub } from '../src/common/mems/__tests__/photo-url-signer.stub';

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
