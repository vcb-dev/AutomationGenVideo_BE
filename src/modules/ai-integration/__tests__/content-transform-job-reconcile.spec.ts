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
 *  2. Job not_found / error / cancelled → FAILED kèm message tương ứng, guard status=PENDING.
 *  3. Job 'completed' + kind 'upgrade' (FE đã rời) → tự ghi kết quả (finalizeUpgradeJob).
 *  4. Job vẫn queued/running → ĐỂ NGUYÊN.
 *  5. Poll 1 bản ghi lỗi → bỏ qua, vẫn xử lý bản còn lại.
 *  6. Không có bản ghi kẹt → không gọi AI service.
 *  7. Guard chống chạy chồng.
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
    const findFirst = jest.fn((_args: any) => Promise.resolve(null));
    const findUnique = jest.fn((_args: any) => Promise.resolve({ id: 'x', score_result: null }));
    const create = jest.fn((_args: any) => Promise.resolve({ id: 'new' }));
    const update = jest.fn((_args: any) => Promise.resolve({}));
    const prisma: any = {
      contentTransformHistory: { findMany, updateMany, findFirst, findUnique, create, update },
      paastAnalysisHistory: { findFirst: jest.fn(async () => null) },
    };
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

  it('job không còn trên AI (404) → FAILED "mất dấu", guard status=PENDING', async () => {
    const { service, httpService, updateMany } = buildService([
      { id: 'rec-1', user_id: 'u1', ai_job_id: 'job-1', ai_job_kind: 'transcribe' },
    ]);
    httpService.get.mockReturnValueOnce(throwError(() => ({ response: { status: 404 } })));

    await service.reconcileStuckContentTransformJobs();

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'rec-1', status: TransformStatus.PENDING },
      data: {
        status: TransformStatus.FAILED,
        error_message: expect.stringContaining('mất dấu'),
      },
    });
  });

  it('job đã error trên AI → FAILED kèm message lỗi thật', async () => {
    const { service, httpService, updateMany } = buildService([
      { id: 'rec-2', user_id: 'u1', ai_job_id: 'job-2', ai_job_kind: 'upgrade' },
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

  it('job completed + kind upgrade (FE đã rời) → tự ghi kết quả, KHÔNG đánh FAILED', async () => {
    const { service, httpService, updateMany } = buildService([
      { id: 'rec-u', user_id: 'u1', ai_job_id: 'job-u', ai_job_kind: 'upgrade', character: { id: 'c1' } },
    ]);
    httpService.get.mockReturnValueOnce(
      of({
        data: {
          status: 'completed',
          kind: 'upgrade',
          client_context: { source_history_id: 'src-1' },
          result: { output_text: 'kịch bản mới', score: { total_score: 90 }, score_error: null, usage: {}, model_used: 'x' },
        },
      }),
    );

    await service.reconcileStuckContentTransformJobs();

    // finalizeUpgradeJob dùng updateMany chuyển PENDING → SUCCESS (không phải FAILED)
    const calls = updateMany.mock.calls.map((c: any[]) => c[0]);
    expect(calls.some((c) => c.data?.status === TransformStatus.SUCCESS)).toBe(true);
    expect(calls.some((c) => c.data?.status === TransformStatus.FAILED)).toBe(false);
  });

  it('job vẫn running trên AI mà bản ghi đã PENDING quá 15 phút → FAILED (coi như treo)', async () => {
    const { service, httpService, updateMany } = buildService([
      { id: 'rec-3', user_id: 'u1', ai_job_id: 'job-3', ai_job_kind: 'upgrade' },
    ]);
    httpService.get.mockReturnValueOnce(of({ data: { status: 'running', message: 'Đang xử lý...' } }));

    await service.reconcileStuckContentTransformJobs();

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rec-3', status: TransformStatus.PENDING },
        data: expect.objectContaining({ status: TransformStatus.FAILED, error_message: expect.stringContaining('treo') }),
      }),
    );
  });

  it('job completed + kind upgrade vẫn được finalize (không bị nhánh "treo" chặn)', async () => {
    const findFirst = jest.fn(async () => ({ id: 'rec-c', user_id: 'u1', ai_job_id: 'job-c', character: {} }));
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const findUnique = jest.fn(async () => ({ id: 'rec-c', output_text: 'x', score_result: null, character: {} }));
    const { service, httpService } = buildService([
      { id: 'rec-c', user_id: 'u1', ai_job_id: 'job-c', ai_job_kind: 'upgrade', character: {} },
    ]);
    (service as any).prisma.contentTransformHistory.findFirst = findFirst;
    (service as any).prisma.contentTransformHistory.updateMany = updateMany;
    (service as any).prisma.contentTransformHistory.findUnique = findUnique;
    jest.spyOn(service, 'getContentTransformHistoryDetail').mockResolvedValue({ output_text: 'cũ', scoreResult: null } as any);
    httpService.get.mockReturnValueOnce(
      of({ data: { status: 'completed', kind: 'upgrade', client_context: {}, result: { output_text: 'x', score: null, score_error: null, usage: {}, model_used: 'm' } } }),
    );

    await service.reconcileStuckContentTransformJobs();

    const calls = updateMany.mock.calls.map((c: any[]) => c[0]);
    expect(calls.some((c) => c.data?.status === TransformStatus.SUCCESS)).toBe(true);
  });

  it('poll 1 bản ghi lỗi → bỏ qua bản đó, vẫn xử lý bản còn lại', async () => {
    const { service, httpService, updateMany } = buildService([
      { id: 'rec-5', user_id: 'u1', ai_job_id: 'job-5', ai_job_kind: 'transcribe' },
      { id: 'rec-6', user_id: 'u1', ai_job_id: 'job-6', ai_job_kind: 'transcribe' },
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
