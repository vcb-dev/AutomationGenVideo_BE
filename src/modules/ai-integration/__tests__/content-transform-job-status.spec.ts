import { of, throwError } from 'rxjs';
import { HttpException } from '@nestjs/common';
import { AiIntegrationService } from '../ai-integration.service';

/**
 * Chức năng: BE proxy trạng thái job nền content-transform (transcribe/upgrade) từ AI service.
 * AiIntegrationService#getContentTransformJobStatus + #cancelContentTransformJob.
 *
 * Khoá 3 quyết định:
 *  1. Chuẩn hoá status của AI về đúng shape FE/reconciliation cùng đọc; status lạ → coi là
 *     'running' (poll tiếp) chứ không kết luận sai.
 *  2. job_id không còn trên AI (404) → { status: 'not_found' }, KHÔNG ném 502 — bên gọi cần
 *     phân biệt "mất dấu" với "AI service sập".
 *  3. Huỷ là best-effort: 404 khi huỷ = job đã xong/không còn, không phải lỗi.
 */
describe('AiIntegrationService — content-transform job status/cancel', () => {
  function buildService() {
    const httpService: any = {
      get: jest.fn(() => of({ data: {} })),
      post: jest.fn(() => of({ data: {} })),
    };
    const configService: any = {
      get: jest.fn((key: string, def?: string) => (key === 'AI_SERVICE_URL' ? 'http://ai.test:8001' : def)),
    };
    const jwtService: any = { sign: jest.fn(() => 'fake.jwt') };
    const prisma: any = {};
    const service = new AiIntegrationService(httpService, configService, jwtService, prisma, {} as any, {} as any);
    return { service, httpService };
  }

  describe('getContentTransformJobStatus', () => {
    it('queued/running → giữ nguyên status + kèm kind, message', async () => {
      const { service, httpService } = buildService();
      httpService.get.mockReturnValueOnce(
        of({ data: { status: 'running', kind: 'transcribe', message: 'Đang nghe...' } }),
      );

      const res = await service.getContentTransformJobStatus('job-1');

      expect(res).toMatchObject({ status: 'running', kind: 'transcribe', message: 'Đang nghe...' });
    });

    it('completed → kèm result nguyên vẹn', async () => {
      const { service, httpService } = buildService();
      httpService.get.mockReturnValueOnce(
        of({ data: { status: 'completed', kind: 'transcribe', message: 'Hoàn tất.', result: { transcript: 'abc', char_count: 3 } } }),
      );

      const res = await service.getContentTransformJobStatus('job-1');

      expect(res).toMatchObject({ status: 'completed', result: { transcript: 'abc', char_count: 3 } });
    });

    it('error → lấy error, fallback về message khi AI không gửi field error', async () => {
      const { service, httpService } = buildService();
      httpService.get.mockReturnValueOnce(
        of({ data: { status: 'error', kind: 'upgrade', message: 'DeepSeek không trả lời kịp.' } }),
      );

      const res = await service.getContentTransformJobStatus('job-1');

      expect(res).toMatchObject({ status: 'error', error: 'DeepSeek không trả lời kịp.' });
    });

    it('status lạ từ AI → chuẩn hoá về "running" để poll tiếp, không kết luận sai', async () => {
      const { service, httpService } = buildService();
      httpService.get.mockReturnValueOnce(of({ data: { status: 'weird', kind: null, message: null } }));

      const res = await service.getContentTransformJobStatus('job-1');

      expect(res.status).toBe('running');
    });

    it('AI trả 404 → { status: "not_found" }, KHÔNG ném lỗi', async () => {
      const { service, httpService } = buildService();
      httpService.get.mockReturnValueOnce(throwError(() => ({ response: { status: 404, data: { error: 'job not found' } } })));

      const res = await service.getContentTransformJobStatus('job-mat-dau');

      expect(res).toEqual({ status: 'not_found' });
    });

    it('AI service sập (5xx / lỗi mạng) → ném HttpException, không nuốt thành not_found', async () => {
      const { service, httpService } = buildService();
      httpService.get.mockReturnValueOnce(throwError(() => ({ response: { status: 502 }, message: 'socket hang up' })));

      await expect(service.getContentTransformJobStatus('job-1')).rejects.toBeInstanceOf(HttpException);
    });
  });

  describe('cancelContentTransformJob', () => {
    it('huỷ thành công → trả status từ AI', async () => {
      const { service, httpService } = buildService();
      httpService.post.mockReturnValueOnce(of({ data: { success: true, status: 'cancelled' } }));

      expect(await service.cancelContentTransformJob('job-1')).toEqual({ status: 'cancelled' });
    });

    it('404 khi huỷ = job đã xong/không còn → { status: "not_found" }, không ném', async () => {
      const { service, httpService } = buildService();
      httpService.post.mockReturnValueOnce(throwError(() => ({ response: { status: 404 } })));

      expect(await service.cancelContentTransformJob('job-1')).toEqual({ status: 'not_found' });
    });

    it('lỗi khác → { status: "error" }, không làm hỏng luồng gọi', async () => {
      const { service, httpService } = buildService();
      httpService.post.mockReturnValueOnce(throwError(() => ({ message: 'timeout' })));

      expect(await service.cancelContentTransformJob('job-1')).toEqual({ status: 'error' });
    });
  });
});
