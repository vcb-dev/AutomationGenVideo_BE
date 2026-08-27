import { of, throwError } from 'rxjs';
import { TransformStatus } from '@prisma/client';
import { AiIntegrationService } from '../ai-integration.service';

/**
 * Chức năng: cron dọn bản ghi ContentTransformHistory kẹt PENDING vì job nền "mất dấu"
 * (AI/BE restart giữa chừng, hoặc FE đóng tab không poll nữa).
 * AiIntegrationService#reconcileStuckContentTransformJobs.
 *
 * Khoá các quyết định:
 *  1. Chỉ quét bản ghi PENDING + có ai_job_id + updated_at quá 15 phút.
 *  2. Job không còn trên AI (not_found) → FAILED kèm message "mất dấu" + xoá ai_job_id.
 *  3. Job đã 'error'/'cancelled' → FAILED kèm message tương ứng.
 *  4. Job vẫn 'queued'/'running'/'completed' → ĐỂ NGUYÊN (PR1 chưa ghi kết quả completed).
 *  5. Ghi có guard status=PENDING (updateMany) — không đè lên bản ghi FE vừa poll xong.
 *  6. Không có bản ghi kẹt → không gọi AI service lần nào.
 */
describe('AiIntegrationService — reconcile stuck content-transform jobs', () => {
  function buildService(stuckRows: any[]) {
    const httpService: any = { get: jest.fn(() => of({ data: {} })), post: jest.fn(() => of({ data: {} })) };
    const configService: any = {
      get: jest.fn((key: string, def?: string) => (key === 'AI_SERVICE_URL' ? 'http://ai.test:8001' : def)),
    };
    const jwtService: any = { sign: jest.fn(() => 'jwt') };
    const updateMany = jest.fn((_args: any) => Promise.resolve({ count: 1 }));
    const findMany = jest.fn((_args: any) => Promise.resolve(stuckRows));
    const prisma: any = { contentTransformHistory: { findMany, updateMany } };
    const service = new AiIntegrationService(httpService, configService, jwtService, prisma, {} as any, {} as any);
    return { service, httpService, findMany, updateMany };
  }

  it('không có bản ghi kẹt → không gọi AI service, không update', async () => {
    const { service, httpService, updateMany } = buildService([]);

    await service.reconcileStuckContentTransformJobs();

    expect(httpService.get).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('chỉ quét PENDING + có ai_job_id + updated_at quá hạn', async () => {
    const { service, findMany } = buildService([]);

    await service.reconcileStuckContentTransformJobs();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: TransformStatus.PENDING,
          ai_job_id: { not: null },
          updated_at: expect.objectContaining({ lt: expect.any(Date) }),
        }),
      }),
    );
  });

  it('job không còn trên AI (404) → FAILED "mất dấu" + xoá ai_job_id, guard status=PENDING', async () => {
    const { service, httpService, updateMany } = buildService([
      { id: 'rec-1', ai_job_id: 'job-1', ai_job_kind: 'transcribe' },
    ]);
    httpService.get.mockReturnValueOnce(throwError(() => ({ response: { status: 404 } })));

    await service.reconcileStuckContentTransformJobs();

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'rec-1', status: TransformStatus.PENDING },
      data: {
        status: TransformStatus.FAILED,
        error_message: expect.stringContaining('mất dấu'),
        ai_job_id: null,
      },
    });
  });

  it('job đã error trên AI → FAILED kèm message lỗi thật', async () => {
    const { service, httpService, updateMany } = buildService([
      { id: 'rec-2', ai_job_id: 'job-2', ai_job_kind: 'upgrade' },
    ]);
    httpService.get.mockReturnValueOnce(
      of({ data: { status: 'error', message: 'DeepSeek đang lỗi ở phía nhà cung cấp.', error: 'DeepSeek đang lỗi ở phía nhà cung cấp.' } }),
    );

    await service.reconcileStuckContentTransformJobs();

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TransformStatus.FAILED,
          error_message: 'DeepSeek đang lỗi ở phía nhà cung cấp.',
        }),
      }),
    );
  });

  it('job vẫn running/completed trên AI → KHÔNG động vào (PR1 chưa ghi kết quả completed)', async () => {
    const { service, httpService, updateMany } = buildService([
      { id: 'rec-3', ai_job_id: 'job-3', ai_job_kind: 'transcribe' },
      { id: 'rec-4', ai_job_id: 'job-4', ai_job_kind: 'upgrade' },
    ]);
    httpService.get
      .mockReturnValueOnce(of({ data: { status: 'running', message: 'Đang xử lý...' } }))
      .mockReturnValueOnce(of({ data: { status: 'completed', result: { transcript: 'x' } } }));

    await service.reconcileStuckContentTransformJobs();

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('poll 1 bản ghi lỗi → bỏ qua bản đó, vẫn xử lý bản còn lại', async () => {
    const { service, httpService, updateMany } = buildService([
      { id: 'rec-5', ai_job_id: 'job-5', ai_job_kind: 'transcribe' },
      { id: 'rec-6', ai_job_id: 'job-6', ai_job_kind: 'transcribe' },
    ]);
    httpService.get
      .mockReturnValueOnce(throwError(() => ({ response: { status: 502 }, message: 'down' })))
      .mockReturnValueOnce(throwError(() => ({ response: { status: 404 } })));

    await service.reconcileStuckContentTransformJobs();

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'rec-6' }) }),
    );
  });

  it('guard chống chạy chồng: lần gọi thứ 2 khi lần 1 chưa xong → return sớm', async () => {
    const { service, findMany } = buildService([]);
    (service as any).reconcileContentTransformRunning = true;

    await service.reconcileStuckContentTransformJobs();

    expect(findMany).not.toHaveBeenCalled();
  });
});
