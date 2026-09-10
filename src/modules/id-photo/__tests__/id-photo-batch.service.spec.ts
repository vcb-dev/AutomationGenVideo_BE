import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IdPhotoBatchStatus, IdPhotoStatus } from '@prisma/client';
import { IdPhotoBatchService } from '../id-photo-batch.service';
import { ID_PHOTO_BATCH_MAX_PEOPLE } from '../dto/create-id-photo-batch.dto';

/**
 * Chức năng: tầng điều phối "Tạo ảnh thẻ hàng loạt" (IdPhotoBatchService).
 *
 * Khoá các quyết định:
 *  1. Chặn cứng ≤ 20 người NGAY Ở BE (không tin FE) + chặn danh sách rỗng.
 *  2. Tạo 1 job cha + N item con PENDING, trả batchJobId NGAY rồi đẩy worker, KHÔNG chờ xử lý.
 *  3. 1 uploadId hỏng → 400, chưa tạo job nào.
 *  4. Poll: 404 khi không có job; trả trạng thái tổng + mảng từng người + counts.
 *  5. Thử lại: chỉ cho người FAILED thuộc đúng batch; đặt lại PENDING + kéo job cha về
 *     PROCESSING + đẩy worker; KHÔNG chạy lại cả batch.
 */

function buildService(overrides: any = {}) {
  const consumed: string[] = [];
  const idPhotoService: any = {
    consumeRawImageForBatch: jest.fn((uploadId: string) => {
      if (uploadId.startsWith('bad')) throw new Error('uploadId đã hết hạn');
      consumed.push(uploadId);
      return `data:image/png;base64,RAW-${uploadId}`;
    }),
    buildBatchPdfBuffer: jest.fn(async (rows: any[]) => Buffer.from(`PDF(${rows.length})`)),
  };
  const worker: any = { enqueue: jest.fn() };
  const prisma: any = {
    idPhotoBatchJob: {
      create: jest.fn(async ({ data }: any) => ({ id: 'batch-1', status: data.status, ...data })),
      findUnique: jest.fn(async () => null),
      update: jest.fn(async () => ({})),
    },
    idPhotoHistory: {
      create: jest.fn(async () => ({})),
      findUnique: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      update: jest.fn(async () => ({})),
    },
    ...overrides.prisma,
  };
  const service = new IdPhotoBatchService(prisma, idPhotoService, worker);
  return { service, prisma, idPhotoService, worker, consumed };
}

function person(i: number, uploadId = `u${i}`) {
  return {
    uploadId,
    employeeName: `NV ${i}`,
    employeeTeam: 'Team A',
    employeeId: `ID-${i}`,
    position: 'STAFF_OVER_3M' as any,
  };
}

describe('IdPhotoBatchService', () => {
  describe('createBatch', () => {
    it('danh sách rỗng → BadRequest, không tạo job', async () => {
      const { service, prisma } = buildService();
      await expect(service.createBatch('u1', { people: [] } as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.idPhotoBatchJob.create).not.toHaveBeenCalled();
    });

    it(`quá ${ID_PHOTO_BATCH_MAX_PEOPLE} người → BadRequest, không tạo job (chặn cứng ở BE)`, async () => {
      const { service, prisma } = buildService();
      const people = Array.from({ length: ID_PHOTO_BATCH_MAX_PEOPLE + 1 }, (_, i) => person(i));
      await expect(service.createBatch('u1', { people } as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.idPhotoBatchJob.create).not.toHaveBeenCalled();
    });

    it('1 uploadId hỏng → BadRequest, chưa tạo job cha nào', async () => {
      const { service, prisma } = buildService();
      const people = [person(1), { ...person(2), uploadId: 'bad-x' }, person(3)];
      await expect(service.createBatch('u1', { people } as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.idPhotoBatchJob.create).not.toHaveBeenCalled();
    });

    it('happy path: tạo job cha + N item con PENDING, trả batchJobId NGAY, đẩy worker', async () => {
      const { service, prisma, worker } = buildService();
      const people = [person(1), person(2), person(3)];

      const res = await service.createBatch('user-9', { people } as any);

      expect(res).toEqual({ batchJobId: 'batch-1', totalCount: 3, status: IdPhotoBatchStatus.PENDING });
      expect(prisma.idPhotoBatchJob.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ created_by: 'user-9', total_count: 3 }) }),
      );
      expect(prisma.idPhotoHistory.create).toHaveBeenCalledTimes(3);
      expect(prisma.idPhotoHistory.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            batch_job_id: 'batch-1',
            status: IdPhotoStatus.PENDING,
            raw_image_data: 'data:image/png;base64,RAW-u3',
          }),
        }),
      );
      expect(worker.enqueue).toHaveBeenCalledWith('batch-1');
    });

    it('lỗi tạo item con → job cha bị đánh FAILED, worker KHÔNG được đẩy', async () => {
      const { service, prisma, worker } = buildService();
      prisma.idPhotoHistory.create = jest.fn(async () => {
        throw new Error('db down');
      });
      await expect(service.createBatch('u1', { people: [person(1)] } as any)).rejects.toBeDefined();
      expect(prisma.idPhotoBatchJob.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: IdPhotoBatchStatus.FAILED } }),
      );
      expect(worker.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('getBatchStatus', () => {
    it('không có job → NotFound', async () => {
      const { service } = buildService();
      await expect(service.getBatchStatus('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('trả trạng thái tổng + từng người + counts', async () => {
      const { service, prisma } = buildService();
      prisma.idPhotoBatchJob.findUnique = jest.fn(async () => ({
        id: 'b1',
        status: IdPhotoBatchStatus.PROCESSING,
        total_count: 3,
        created_at: new Date('2026-09-09'),
        updated_at: new Date('2026-09-09'),
      }));
      prisma.idPhotoHistory.findMany = jest.fn(async () => [
        { id: 'h1', status: IdPhotoStatus.SUCCESS },
        { id: 'h2', status: IdPhotoStatus.FAILED },
        { id: 'h3', status: IdPhotoStatus.PROCESSING },
      ]);

      const res = await service.getBatchStatus('b1');

      expect(res.status).toBe(IdPhotoBatchStatus.PROCESSING);
      expect(res.totalCount).toBe(3);
      expect(res.counts).toEqual({ pending: 0, processing: 1, success: 1, failed: 1 });
      expect(res.people).toHaveLength(3);
    });
  });

  describe('exportBatchPdf', () => {
    it('không có job → NotFound', async () => {
      const { service } = buildService();
      await expect(service.exportBatchPdf('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('không có người SUCCESS nào → BadRequest, không dựng PDF', async () => {
      const { service, prisma, idPhotoService } = buildService();
      prisma.idPhotoBatchJob.findUnique = jest.fn(async () => ({ id: 'b1', total_count: 3 }));
      prisma.idPhotoHistory.findMany = jest.fn(async () => []);
      await expect(service.exportBatchPdf('b1')).rejects.toBeInstanceOf(BadRequestException);
      expect(idPhotoService.buildBatchPdfBuffer).not.toHaveBeenCalled();
    });

    it('chỉ lấy SUCCESS + có ảnh, đúng thứ tự created_at; trả exported/total/skipped', async () => {
      const { service, prisma, idPhotoService } = buildService();
      prisma.idPhotoBatchJob.findUnique = jest.fn(async () => ({ id: 'b1', total_count: 5 }));
      const findMany = jest.fn(async () => [
        { employee_name: 'A', employee_team: 'T', employee_id: '1', position: 'LEADER', processed_image_data: 'data:...' },
        { employee_name: 'B', employee_team: 'T', employee_id: '2', position: 'BOD', processed_image_data: 'data:...' },
        { employee_name: 'C', employee_team: 'T', employee_id: '3', position: 'MANAGER', processed_image_data: 'data:...' },
      ]);
      prisma.idPhotoHistory.findMany = findMany;

      const res = await service.exportBatchPdf('b1');

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            batch_job_id: 'b1',
            status: IdPhotoStatus.SUCCESS,
            processed_image_data: { not: null },
          }),
          orderBy: { created_at: 'asc' },
        }),
      );
      expect(idPhotoService.buildBatchPdfBuffer).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ employee_name: 'A' })]));
      expect(res.exported).toBe(3);
      expect(res.total).toBe(5);
      expect(res.skipped).toBe(2); // 5 total, 3 SUCCESS → 2 bỏ qua
      expect(res.buffer.toString()).toBe('PDF(3)');
    });
  });

  describe('retryPerson', () => {
    function withBatchAndPerson(personRow: any) {
      const { service, prisma, worker } = buildService();
      prisma.idPhotoBatchJob.findUnique = jest.fn(async () => ({ id: 'b1', status: IdPhotoBatchStatus.COMPLETED }));
      prisma.idPhotoHistory.findUnique = jest.fn(async () => personRow);
      return { service, prisma, worker };
    }

    it('người không thuộc batch → NotFound', async () => {
      const { service } = withBatchAndPerson({ id: 'h1', batch_job_id: 'OTHER', status: IdPhotoStatus.FAILED });
      await expect(service.retryPerson('b1', 'h1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('người đang PENDING/PROCESSING → BadRequest', async () => {
      const { service } = withBatchAndPerson({
        id: 'h1',
        batch_job_id: 'b1',
        status: IdPhotoStatus.PROCESSING,
        raw_image_data: 'x',
      });
      await expect(service.retryPerson('b1', 'h1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('người SUCCESS → BadRequest (chỉ thử lại người FAILED)', async () => {
      const { service } = withBatchAndPerson({
        id: 'h1',
        batch_job_id: 'b1',
        status: IdPhotoStatus.SUCCESS,
        raw_image_data: 'x',
      });
      await expect(service.retryPerson('b1', 'h1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('người FAILED → đặt lại PENDING, kéo job cha về PROCESSING, đẩy worker', async () => {
      const { service, prisma, worker } = withBatchAndPerson({
        id: 'h1',
        batch_job_id: 'b1',
        status: IdPhotoStatus.FAILED,
        raw_image_data: 'data:image/png;base64,RAW',
      });

      const res = await service.retryPerson('b1', 'h1');

      expect(prisma.idPhotoHistory.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'h1' }, data: expect.objectContaining({ status: IdPhotoStatus.PENDING }) }),
      );
      expect(prisma.idPhotoBatchJob.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'b1' }, data: { status: IdPhotoBatchStatus.PROCESSING } }),
      );
      expect(worker.enqueue).toHaveBeenCalledWith('b1');
      expect(res).toEqual({ batchJobId: 'b1', historyId: 'h1', status: IdPhotoStatus.PENDING });
    });
  });

  describe('remergePerson (ghép áo lại cho người đã SUCCESS)', () => {
    function withBatchAndPerson(personRow: any) {
      const { service, prisma, worker } = buildService();
      prisma.idPhotoBatchJob.findUnique = jest.fn(async () => ({ id: 'b1', status: IdPhotoBatchStatus.COMPLETED }));
      prisma.idPhotoHistory.findUnique = jest.fn(async () => personRow);
      return { service, prisma, worker };
    }

    it('người FAILED → BadRequest (FAILED phải dùng "Thử lại", không phải "Ghép áo lại")', async () => {
      const { service } = withBatchAndPerson({
        id: 'h1',
        batch_job_id: 'b1',
        status: IdPhotoStatus.FAILED,
        raw_image_data: 'x',
      });
      await expect(service.remergePerson('b1', 'h1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('người không thuộc batch → NotFound', async () => {
      const { service } = withBatchAndPerson({ id: 'h1', batch_job_id: 'OTHER', status: IdPhotoStatus.SUCCESS });
      await expect(service.remergePerson('b1', 'h1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('người SUCCESS → đặt lại PENDING (xoá ảnh + pdf_url cũ), job cha PROCESSING, đẩy worker', async () => {
      const { service, prisma, worker } = withBatchAndPerson({
        id: 'h1',
        batch_job_id: 'b1',
        status: IdPhotoStatus.SUCCESS,
        raw_image_data: 'data:image/png;base64,RAW',
        processed_image_data: 'data:image/png;base64,OLD',
        pdf_url: '/id-photo/h1/pdf-file',
      });

      const res = await service.remergePerson('b1', 'h1');

      expect(prisma.idPhotoHistory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'h1' },
          data: expect.objectContaining({
            status: IdPhotoStatus.PENDING,
            processed_image_data: null,
            pdf_url: null,
          }),
        }),
      );
      expect(prisma.idPhotoBatchJob.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'b1' }, data: { status: IdPhotoBatchStatus.PROCESSING } }),
      );
      expect(worker.enqueue).toHaveBeenCalledWith('b1');
      expect(res).toEqual({ batchJobId: 'b1', historyId: 'h1', status: IdPhotoStatus.PENDING });
    });
  });
});
