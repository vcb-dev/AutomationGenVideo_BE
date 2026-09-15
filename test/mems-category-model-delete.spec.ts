import { ConflictException, NotFoundException } from '@nestjs/common';
import { MemsCatalogService } from '../src/modules/mems-catalog/mems-catalog.service';
import { photoUrlSignerStub } from '../src/common/mems/__tests__/photo-url-signer.stub';

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
        models: [
          { id: 'm-1', assets: [] },
        ],
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
        models: [
          { id: 'm-2', assets: [{ id: 'a-2', asset_code: 'CAM-002' }] },
        ],
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
