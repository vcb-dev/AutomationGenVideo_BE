import { HttpException } from '@nestjs/common';
import { IdPhotoBatchStatus, IdPhotoStatus } from '@prisma/client';
import { IdPhotoBatchWorker } from '../id-photo-batch.worker';

/**
 * Chức năng: worker nền "Tạo ảnh thẻ hàng loạt" (IdPhotoBatchWorker).
 *
 * Khoá các quyết định:
 *  1. Xử lý TUẦN TỰ từng người theo thứ tự created_at, không song song.
 *  2. Giữa 2 lượt gọi Gemini ép nghỉ tối thiểu (MIN_GEMINI_GAP_MS).
 *  3. Lỗi 429/503 (rate limit) → backoff theo RATE_LIMIT_BACKOFF_MS + retry tối đa 3 lần cho
 *     đúng người đó.
 *  4. Lỗi khác / hết retry → người đó FAILED kèm error_message, batch KHÔNG dừng, xử lý người kế.
 *  5. Sau mỗi người → bump heartbeat (updated_at) của job cha.
 *  6. Xong toàn bộ (kể cả có người FAILED) → job cha COMPLETED.
 *  7. Cron reconcile: job cha/con PENDING/PROCESSING quá hạn heartbeat & không thuộc hàng đợi
 *     instance này → FAILED. Job đang trong hàng đợi (isTracking) thì bỏ qua. Guard chống chạy chồng.
 */

type Child = {
  id: string;
  batch_job_id: string;
  status: IdPhotoStatus;
  raw_image_data: string | null;
  processed_image_data: string | null;
  error_message: string | null;
  created_at: Date;
};

type Batch = {
  id: string;
  status: IdPhotoBatchStatus;
  total_count: number;
  updated_at: Date;
};

function matchesStatus(where: any, current: string): boolean {
  if (!where.status) return true;
  if (where.status.in) return where.status.in.includes(current);
  return where.status === current;
}

function makeFakePrisma(batches: Batch[], children: Child[]) {
  const batchUpdate = jest.fn(async ({ where, data }: any) => {
    const b = batches.find((x) => x.id === where.id);
    if (b) Object.assign(b, data, { updated_at: new Date() });
    return b;
  });
  const historyUpdate = jest.fn(async ({ where, data }: any) => {
    const c = children.find((x) => x.id === where.id);
    if (c) Object.assign(c, data);
    return c;
  });
  return {
    _batchUpdate: batchUpdate,
    _historyUpdate: historyUpdate,
    idPhotoBatchJob: {
      findUnique: jest.fn(async ({ where }: any) => batches.find((b) => b.id === where.id) ?? null),
      update: batchUpdate,
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const b of batches) {
          if (b.id !== where.id || !matchesStatus(where, b.status)) continue;
          Object.assign(b, data);
          count++;
        }
        return { count };
      }),
      findMany: jest.fn(async ({ where }: any) =>
        batches.filter(
          (b) =>
            matchesStatus(where, b.status) &&
            (!where.updated_at?.lt || b.updated_at < where.updated_at.lt),
        ),
      ),
    },
    idPhotoHistory: {
      findFirst: jest.fn(async ({ where }: any) =>
        children
          .filter((c) => c.batch_job_id === where.batch_job_id && matchesStatus(where, c.status))
          .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())[0] ?? null,
      ),
      update: historyUpdate,
      count: jest.fn(async ({ where }: any) =>
        children.filter(
          (c) => c.batch_job_id === where.batch_job_id && matchesStatus(where, c.status),
        ).length,
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const c of children) {
          if (c.batch_job_id !== where.batch_job_id || !matchesStatus(where, c.status)) continue;
          Object.assign(c, data);
          count++;
        }
        return { count };
      }),
    },
  };
}

function buildWorker(batches: Batch[], children: Child[]) {
  const prisma = makeFakePrisma(batches, children);
  const idPhotoService: any = {
    runMergeOutfitOnRawImageData: jest.fn(),
    // Bước ghép khung + dựng PDF — mặc định OK; test riêng ép lỗi để kiểm nhánh FAILED.
    exportPdf: jest.fn(async () => ({ pdfUrl: '/id-photo/x/pdf-file' })),
  };
  const worker = new IdPhotoBatchWorker(prisma as any, idPhotoService);
  const sleep = jest.fn().mockResolvedValue(undefined);
  (worker as any).sleep = sleep;
  return { worker, prisma, idPhotoService, sleep };
}

/** Xử lý hết hàng đợi cho id, chờ xong hẳn (deterministic, không phụ thuộc setImmediate). */
async function runQueue(worker: IdPhotoBatchWorker, id: string): Promise<void> {
  (worker as any).queue.push(id);
  await (worker as any).drain();
}

function child(id: string, order: number, batchId = 'b1'): Child {
  return {
    id,
    batch_job_id: batchId,
    status: IdPhotoStatus.PENDING,
    raw_image_data: `data:image/png;base64,AAAA-${id}`,
    processed_image_data: null,
    error_message: null,
    created_at: new Date(2026, 0, 1, 0, 0, order),
  };
}

function batch(id = 'b1', total = 1): Batch {
  return { id, status: IdPhotoBatchStatus.PENDING, total_count: total, updated_at: new Date() };
}

describe('IdPhotoBatchWorker', () => {
  it('xử lý tuần tự từng người theo thứ tự created_at, mỗi người 1 lượt Gemini', async () => {
    const b = batch('b1', 3);
    const kids = [child('p3', 3), child('p1', 1), child('p2', 2)];
    const { worker, idPhotoService } = buildWorker([b], kids);
    const order: string[] = [];
    idPhotoService.runMergeOutfitOnRawImageData.mockImplementation(async (raw: string) => {
      order.push(raw);
      return 'data:image/png;base64,OUT';
    });

    await runQueue(worker, 'b1');

    expect(order).toEqual([
      'data:image/png;base64,AAAA-p1',
      'data:image/png;base64,AAAA-p2',
      'data:image/png;base64,AAAA-p3',
    ]);
    expect(kids.every((k) => k.status === IdPhotoStatus.SUCCESS)).toBe(true);
    expect(kids.every((k) => k.processed_image_data === 'data:image/png;base64,OUT')).toBe(true);
    expect(b.status).toBe(IdPhotoBatchStatus.COMPLETED);
  });

  it('mỗi người đi đủ ghép áo → ghép khung + dựng PDF (exportPdf) → SUCCESS', async () => {
    const b = batch('b1', 2);
    const kids = [child('p1', 1), child('p2', 2)];
    const { worker, idPhotoService } = buildWorker([b], kids);
    idPhotoService.runMergeOutfitOnRawImageData.mockResolvedValue('data:image/png;base64,OUT');

    await runQueue(worker, 'b1');

    // exportPdf (ghép khung màu + PDF) được gọi đúng 1 lần / người, SAU khi có ảnh ghép áo.
    expect(idPhotoService.exportPdf).toHaveBeenCalledTimes(2);
    expect(idPhotoService.exportPdf).toHaveBeenCalledWith('p1');
    expect(idPhotoService.exportPdf).toHaveBeenCalledWith('p2');
    expect(kids.every((k) => k.status === IdPhotoStatus.SUCCESS)).toBe(true);
  });

  it('ghép áo OK nhưng dựng khung/PDF lỗi → người đó FAILED (không phải SUCCESS)', async () => {
    const b = batch('b1', 2);
    const kids = [child('p1', 1), child('p2', 2)];
    const { worker, idPhotoService } = buildWorker([b], kids);
    idPhotoService.runMergeOutfitOnRawImageData.mockResolvedValue('data:image/png;base64,OUT');
    idPhotoService.exportPdf.mockImplementation(async (id: string) => {
      if (id === 'p1') throw new Error('ảnh hỏng, không dựng được PDF');
      return { pdfUrl: '/x' };
    });

    await runQueue(worker, 'b1');

    expect(kids[0].status).toBe(IdPhotoStatus.FAILED);
    expect(kids[0].error_message).toMatch(/khung màu|PDF/);
    expect(kids[1].status).toBe(IdPhotoStatus.SUCCESS); // người sau vẫn chạy
    expect(b.status).toBe(IdPhotoBatchStatus.COMPLETED);
  });

  it('ép nghỉ tối thiểu giữa 2 lượt gọi Gemini (người thứ 2 trở đi)', async () => {
    const { worker, idPhotoService, sleep } = buildWorker(
      [batch('b1', 2)],
      [child('p1', 1), child('p2', 2)],
    );
    idPhotoService.runMergeOutfitOnRawImageData.mockResolvedValue('out');

    await runQueue(worker, 'b1');

    const gap = (worker as any).MIN_GEMINI_GAP_MS;
    const waited = sleep.mock.calls.map((c) => c[0]);
    expect(waited.some((ms) => ms > 0 && ms <= gap)).toBe(true);
  });

  it('lỗi 429 → backoff theo RATE_LIMIT_BACKOFF_MS rồi retry, thành công thì SUCCESS', async () => {
    const kid = child('p1', 1);
    const { worker, idPhotoService, sleep } = buildWorker([batch('b1', 1)], [kid]);
    idPhotoService.runMergeOutfitOnRawImageData
      .mockRejectedValueOnce(new HttpException('rate limit', 429))
      .mockResolvedValueOnce('data:image/png;base64,OUT');

    await runQueue(worker, 'b1');

    expect(idPhotoService.runMergeOutfitOnRawImageData).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith((worker as any).RATE_LIMIT_BACKOFF_MS[0]);
    expect(kid.status).toBe(IdPhotoStatus.SUCCESS);
  });

  it('429 liên tục → retry đúng 3 lần rồi FAILED, batch vẫn COMPLETED', async () => {
    const b = batch('b1', 1);
    const kid = child('p1', 1);
    const { worker, idPhotoService, sleep } = buildWorker([b], [kid]);
    idPhotoService.runMergeOutfitOnRawImageData.mockRejectedValue(
      new HttpException('quota exceeded', 503),
    );

    await runQueue(worker, 'b1');

    // 1 lần đầu + 3 lần retry = 4 lượt gọi; đủ 3 mốc backoff.
    expect(idPhotoService.runMergeOutfitOnRawImageData).toHaveBeenCalledTimes(4);
    for (const ms of (worker as any).RATE_LIMIT_BACKOFF_MS) expect(sleep).toHaveBeenCalledWith(ms);
    expect(kid.status).toBe(IdPhotoStatus.FAILED);
    expect(kid.error_message).toBeTruthy();
    expect(b.status).toBe(IdPhotoBatchStatus.COMPLETED);
  });

  it('1 người lỗi (không phải rate limit) → FAILED ngay, KHÔNG dừng batch', async () => {
    const b = batch('b1', 3);
    const kids = [child('p1', 1), child('p2', 2), child('p3', 3)];
    const { worker, idPhotoService } = buildWorker([b], kids);
    idPhotoService.runMergeOutfitOnRawImageData.mockImplementation(async (raw: string) => {
      if (raw.endsWith('p2')) throw new HttpException('Gemini không nhận diện được khuôn mặt', 502);
      return 'data:image/png;base64,OUT';
    });

    await runQueue(worker, 'b1');

    expect(kids[0].status).toBe(IdPhotoStatus.SUCCESS);
    expect(kids[1].status).toBe(IdPhotoStatus.FAILED);
    expect(kids[1].error_message).toContain('khuôn mặt');
    expect(kids[2].status).toBe(IdPhotoStatus.SUCCESS);
    expect(idPhotoService.runMergeOutfitOnRawImageData).toHaveBeenCalledTimes(3);
    expect(b.status).toBe(IdPhotoBatchStatus.COMPLETED);
  });

  it('bump heartbeat (status=PROCESSING) của job cha sau mỗi người', async () => {
    const { worker, prisma, idPhotoService } = buildWorker(
      [batch('b1', 2)],
      [child('p1', 1), child('p2', 2)],
    );
    idPhotoService.runMergeOutfitOnRawImageData.mockResolvedValue('out');

    await runQueue(worker, 'b1');

    const processingWrites = (prisma._batchUpdate as jest.Mock).mock.calls.filter(
      (c) => c[0].data.status === IdPhotoBatchStatus.PROCESSING,
    );
    // 1 lần set PROCESSING lúc bắt đầu + 1 lần heartbeat / người (2) = 3.
    expect(processingWrites.length).toBeGreaterThanOrEqual(3);
  });

  it('ghép áo lại 1 người (đã bị service đặt về PENDING) → chỉ người đó chạy lại, người khác giữ nguyên', async () => {
    const b: Batch = { id: 'b1', status: IdPhotoBatchStatus.COMPLETED, total_count: 3, updated_at: new Date() };
    const kids = [
      { ...child('p1', 1), status: IdPhotoStatus.SUCCESS, processed_image_data: 'data:image/png;base64,KEEP1' },
      // p2: service vừa reset (remerge) → PENDING, ảnh + pdf đã xoá
      { ...child('p2', 2), status: IdPhotoStatus.PENDING, processed_image_data: null },
      { ...child('p3', 3), status: IdPhotoStatus.SUCCESS, processed_image_data: 'data:image/png;base64,KEEP3' },
    ];
    const { worker, idPhotoService } = buildWorker([b], kids);
    idPhotoService.runMergeOutfitOnRawImageData.mockResolvedValue('data:image/png;base64,NEW2');

    await runQueue(worker, 'b1');

    // Chỉ p2 được ghép áo lại + dựng khung/PDF lại.
    expect(idPhotoService.runMergeOutfitOnRawImageData).toHaveBeenCalledTimes(1);
    expect(idPhotoService.runMergeOutfitOnRawImageData).toHaveBeenCalledWith('data:image/png;base64,AAAA-p2', expect.any(String));
    expect(idPhotoService.exportPdf).toHaveBeenCalledTimes(1);
    expect(idPhotoService.exportPdf).toHaveBeenCalledWith('p2');
    expect(kids[1].processed_image_data).toBe('data:image/png;base64,NEW2');
    expect(kids[1].status).toBe(IdPhotoStatus.SUCCESS);
    // p1, p3 không bị đụng.
    expect(kids[0].processed_image_data).toBe('data:image/png;base64,KEEP1');
    expect(kids[2].processed_image_data).toBe('data:image/png;base64,KEEP3');
    expect(b.status).toBe(IdPhotoBatchStatus.COMPLETED);
  });

  it('item con kẹt PROCESSING từ lần chạy trước → reset về PENDING rồi xử lại', async () => {
    const b = batch('b1', 1);
    const kid = { ...child('p1', 1), status: IdPhotoStatus.PROCESSING };
    const { worker, idPhotoService } = buildWorker([b], [kid]);
    idPhotoService.runMergeOutfitOnRawImageData.mockResolvedValue('out');

    await runQueue(worker, 'b1');

    expect(idPhotoService.runMergeOutfitOnRawImageData).toHaveBeenCalledTimes(1);
    expect(kid.status).toBe(IdPhotoStatus.SUCCESS);
  });

  describe('reconcileStuckIdPhotoBatchJobs (watchdog)', () => {
    it('job cha quá hạn heartbeat & không thuộc hàng đợi → job cha + item con non-terminal FAILED', async () => {
      const stale: Batch = {
        id: 'b-old',
        status: IdPhotoBatchStatus.PROCESSING,
        total_count: 2,
        updated_at: new Date(Date.now() - 60 * 60_000),
      };
      const kids: Child[] = [
        { ...child('k1', 1, 'b-old'), status: IdPhotoStatus.PROCESSING },
        { ...child('k2', 2, 'b-old'), status: IdPhotoStatus.SUCCESS },
      ];
      const { worker } = buildWorker([stale], kids);

      await worker.reconcileStuckIdPhotoBatchJobs();

      expect(stale.status).toBe(IdPhotoBatchStatus.FAILED);
      expect(kids[0].status).toBe(IdPhotoStatus.FAILED);
      expect(kids[0].error_message).toContain('Mất dấu');
      expect(kids[1].status).toBe(IdPhotoStatus.SUCCESS); // đã xong thì không đụng
    });

    it('job cha còn tươi heartbeat → KHÔNG đụng', async () => {
      const fresh: Batch = {
        id: 'b-fresh',
        status: IdPhotoBatchStatus.PROCESSING,
        total_count: 1,
        updated_at: new Date(),
      };
      const { worker } = buildWorker([fresh], [{ ...child('k1', 1, 'b-fresh'), status: IdPhotoStatus.PENDING }]);

      await worker.reconcileStuckIdPhotoBatchJobs();

      expect(fresh.status).toBe(IdPhotoBatchStatus.PROCESSING);
    });

    it('job cha quá hạn nhưng đang trong hàng đợi instance này (isTracking) → BỎ QUA', async () => {
      const stale: Batch = {
        id: 'b1',
        status: IdPhotoBatchStatus.PROCESSING,
        total_count: 1,
        updated_at: new Date(Date.now() - 60 * 60_000),
      };
      const kid = { ...child('k1', 1, 'b1'), status: IdPhotoStatus.PENDING };
      const { worker, idPhotoService } = buildWorker([stale], [kid]);
      let release: () => void = () => undefined;
      idPhotoService.runMergeOutfitOnRawImageData.mockImplementation(
        () => new Promise((r) => (release = () => r('out'))),
      );
      (worker as any).queue.push('b1');
      const draining = (worker as any).drain();
      await new Promise((r) => setImmediate(r));

      expect(worker.isTracking('b1')).toBe(true);
      await worker.reconcileStuckIdPhotoBatchJobs();
      expect(stale.status).toBe(IdPhotoBatchStatus.PROCESSING);

      release();
      await draining;
    });

    it('guard chống chạy chồng: lần 2 khi lần 1 chưa xong → return sớm', async () => {
      const { worker, prisma } = buildWorker([], []);
      (worker as any).reconcileRunning = true;

      await worker.reconcileStuckIdPhotoBatchJobs();

      expect(prisma.idPhotoBatchJob.findMany).not.toHaveBeenCalled();
    });
  });
});
