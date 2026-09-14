import { of, throwError } from 'rxjs';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { TransformStatus } from '@prisma/client';
import { PaastService } from '../paast.service';
import { PAAST_LOGIC_VERSION } from '../../interfaces/paast-analysis.interface';

/**
 * PAAST Analyzer — tách khỏi AiIntegrationService thành PaastService riêng, được AiIntegrationModule
 * đăng ký làm provider @Global; AiIntegrationController và OwnedScriptService inject thẳng service này.
 *
 * Các quyết định nghiệp vụ được khoá ở đây:
 * - findLatestByContent KHÔNG lọc theo user (điểm chỉ phụ thuộc nội dung), và chỉ nhận bản đúng
 *   PAAST_LOGIC_VERSION hiện hành — bản chấm bằng công thức đời trước không tái dùng.
 * - resolvePaastContent: có `content` dán thẳng thì dùng luôn; chỉ có `fileUrl` thì nhờ AI service
 *   trích text (content dài hay được đính kèm dưới dạng link Google Docs).
 * - getPaastHistoryDetail chặn xem lịch sử người khác (404 thay vì 403 để không lộ record tồn tại).
 * - upgradeAnalysis chỉ nâng cấp được bản đã phân tích xong, trích đúng tiêu chí `miss`.
 */
describe('PaastService', () => {
  function build(prismaOverrides: Record<string, any> = {}) {
    const httpService: any = {
      post: jest.fn(() => of({ data: {} })),
      get: jest.fn(() => of({ data: [] })),
    };
    const configService: any = {
      get: jest.fn((key: string, def?: string) =>
        key === 'AI_SERVICE_URL' ? 'http://localhost:8001' : def,
      ),
    };
    const prisma: any = {
      paastAnalysisHistory: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        create: jest.fn(async (args: any) => ({ id: 'new-history-id', ...args.data })),
        update: jest.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
        ...prismaOverrides.paastAnalysisHistory,
      },
    };
    const service = new PaastService(httpService, configService, prisma);
    return { service, prisma, httpService };
  }

  describe('findLatestByContent', () => {
    it('không lọc theo user_id — chỉ theo nội dung + trạng thái SUCCESS, lấy tối đa 5 bản gần nhất', async () => {
      const { service, prisma } = build();

      await service.findLatestByContent('nội dung abc');

      const arg = prisma.paastAnalysisHistory.findMany.mock.calls[0][0];
      expect(arg.where).not.toHaveProperty('user_id');
      expect(arg.where).toEqual({ input_text: 'nội dung abc', status: TransformStatus.SUCCESS });
      expect(arg.take).toBe(5);
    });

    it('bỏ qua bản ghi có logic_version khác/không có, trả bản khớp version hiện hành', async () => {
      const stale = { id: 'old', analysis_result: { logic_version: 'v1' } };
      const legacy = { id: 'legacy', analysis_result: {} };
      const current = { id: 'current', analysis_result: { logic_version: PAAST_LOGIC_VERSION } };
      const { service } = build({
        paastAnalysisHistory: { findMany: jest.fn(async () => [stale, legacy, current]) },
      });

      await expect(service.findLatestByContent('nội dung abc')).resolves.toEqual(current);
    });

    it('không bản nào khớp version hiện hành thì trả null (buộc chấm lại)', async () => {
      const { service } = build({
        paastAnalysisHistory: { findMany: jest.fn(async () => [{ id: 'old', analysis_result: { logic_version: 'v1' } }]) },
      });

      await expect(service.findLatestByContent('nội dung abc')).resolves.toBeNull();
    });
  });

  describe('resolvePaastContent', () => {
    it('có content dán thẳng thì trả nguyên (đã trim), KHÔNG gọi AI service', async () => {
      const { service, httpService } = build();

      const text = await service.resolvePaastContent({ content: '  nội dung dán thẳng đủ dài  ' } as any);

      expect(text).toBe('nội dung dán thẳng đủ dài');
      expect(httpService.post).not.toHaveBeenCalled();
    });

    it('chỉ có fileUrl thì gọi /api/ai/paast/extract-text/ và trả text trích được', async () => {
      const { service, httpService } = build();
      const extracted = 'x'.repeat(250);
      httpService.post.mockReturnValueOnce(of({ data: { success: true, text: extracted, char_count: 250 } }));

      const text = await service.resolvePaastContent({ fileUrl: 'https://docs.google.com/document/d/abc/edit' } as any);

      expect(text).toBe(extracted);
      const [url, body] = httpService.post.mock.calls[0];
      expect(url).toBe('http://localhost:8001/api/ai/paast/extract-text/');
      expect(body).toEqual({ file_url: 'https://docs.google.com/document/d/abc/edit' });
    });

    it('text trích được < 100 ký tự (file scan/ảnh) thì báo BadRequestException', async () => {
      const { service, httpService } = build();
      httpService.post.mockReturnValueOnce(of({ data: { text: 'quá ngắn' } }));

      await expect(
        service.resolvePaastContent({ fileUrl: 'https://drive.google.com/file/d/abc/view' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('AI service trả lỗi thì bọc lại message của nó trong BadRequestException', async () => {
      const { service, httpService } = build();
      httpService.post.mockReturnValueOnce(
        throwError(() => ({ response: { data: { error: 'Không đọc được nội dung từ file' } } })),
      );

      await expect(
        service.resolvePaastContent({ fileUrl: 'https://docs.google.com/document/d/abc/edit' } as any),
      ).rejects.toThrow('Không đọc được nội dung từ file');
    });

    it('không có cả content lẫn fileUrl thì báo BadRequestException', async () => {
      const { service } = build();

      await expect(service.resolvePaastContent({} as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('analyzeContent', () => {
    it('gọi AI service thành công → lưu SUCCESS kèm điểm/verdict/video_realism/score_band + logic_version', async () => {
      const { service, prisma, httpService } = build();
      httpService.post.mockReturnValueOnce(
        of({
          data: {
            layers: { action: {} },
            video_realism: { opening_beat: 'x' },
            total_score: 85,
            score_band: 'ready',
            verdict: 'PASS',
            cta_warning: null,
          },
        }),
      );

      await service.analyzeContent('user-1', { content: 'n'.repeat(120) } as any);

      const data = prisma.paastAnalysisHistory.update.mock.calls[0][0].data;
      expect(data.status).toBe(TransformStatus.SUCCESS);
      expect(data.total_score).toBe(85);
      expect(data.analysis_result).toMatchObject({
        score_band: 'ready',
        video_realism: { opening_beat: 'x' },
        logic_version: PAAST_LOGIC_VERSION,
      });
    });

    it('AI service lỗi → lưu FAILED kèm error_message, không throw', async () => {
      const { service, prisma, httpService } = build();
      httpService.post.mockReturnValueOnce(throwError(() => ({ message: 'AI service down' })));

      await service.analyzeContent('user-1', { content: 'n'.repeat(120) } as any);

      expect(prisma.paastAnalysisHistory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: TransformStatus.FAILED, error_message: 'AI service down' }),
        }),
      );
    });
  });

  describe('analyzeContentV2', () => {
    it('lưu SUCCESS với total_score để null + khoá phien_ban trong JSON (dấu hiệu phân biệt bản 2)', async () => {
      const { service, prisma, httpService } = build();
      httpService.post.mockReturnValueOnce(
        of({ data: { verdict: { passed: true }, layers: {}, ctaWarning: null, phien_ban: 2 } }),
      );

      await service.analyzeContentV2('user-1', 'n'.repeat(200));

      const data = prisma.paastAnalysisHistory.update.mock.calls[0][0].data;
      expect(data.status).toBe(TransformStatus.SUCCESS);
      expect(data.total_score).toBeUndefined();
      expect(data.analysis_result).toMatchObject({ phien_ban: 2 });
    });
  });

  describe('getPaastHistoryDetail', () => {
    it('báo NotFoundException nếu bản ghi không tồn tại', async () => {
      const { service } = build();

      await expect(service.getPaastHistoryDetail('missing-id', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('báo NotFoundException nếu bản ghi thuộc user khác (không lộ là có tồn tại)', async () => {
      const { service } = build({
        paastAnalysisHistory: { findUnique: jest.fn(async () => ({ id: 'h1', user_id: 'owner-1' })) },
      });

      await expect(service.getPaastHistoryDetail('h1', 'someone-else')).rejects.toThrow(NotFoundException);
    });

    it('trả về bản ghi nếu đúng chủ sở hữu', async () => {
      const record = { id: 'h1', user_id: 'owner-1', total_score: 80 };
      const { service } = build({
        paastAnalysisHistory: { findUnique: jest.fn(async () => record) },
      });

      await expect(service.getPaastHistoryDetail('h1', 'owner-1')).resolves.toEqual(record);
    });
  });

  describe('upgradeAnalysis', () => {
    it('báo NotFoundException nếu bản phân tích gốc không tồn tại', async () => {
      const { service } = build();

      await expect(service.upgradeAnalysis('user-1', 'missing-id')).rejects.toThrow(NotFoundException);
    });

    it('báo BadRequestException nếu bản gốc chưa phân tích xong', async () => {
      const { service } = build({
        paastAnalysisHistory: {
          findUnique: jest.fn(async () => ({ id: 'h1', status: 'PENDING', analysis_result: null })),
        },
      });

      await expect(service.upgradeAnalysis('user-1', 'h1')).rejects.toThrow(BadRequestException);
    });

    it('chỉ trích tiêu chí đang miss từ 4 layer, gửi đúng missing_elements + link upgraded_from_id', async () => {
      const original = {
        id: 'h1',
        user_id: 'user-1',
        input_text: 'nội dung gốc',
        status: TransformStatus.SUCCESS,
        analysis_result: {
          layers: {
            action: { criteria: [{ code: 'A1', status: 'miss', evidence: 'thiếu CTA' }] },
            acknowledge: { criteria: [{ code: 'K1', status: 'na' }] },
            stick: { criteria: [{ code: 'S1', status: 'miss', evidence: 'thiếu điểm neo' }] },
            trust: { criteria: [{ code: 'T1', status: 'pass' }] },
          },
        },
      };
      const { service, prisma, httpService } = build({
        paastAnalysisHistory: { findUnique: jest.fn(async () => original) },
      });
      httpService.post.mockReturnValueOnce(
        of({
          data: {
            upgraded: 'nội dung mới',
            changes_added: [],
            new_analysis: { layers: {}, cta_warning: null, verdict: 'PASS', total_score: 90 },
          },
        }),
      );

      await service.upgradeAnalysis('user-1', 'h1');

      const [, body] = httpService.post.mock.calls[0];
      expect(body.missing_elements).toEqual([
        { layer: 'action', criterion: 'A1', suggestion: 'thiếu CTA' },
        { layer: 'stick', criterion: 'S1', suggestion: 'thiếu điểm neo' },
      ]);
      expect(prisma.paastAnalysisHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ upgraded_from_id: 'h1' }) }),
      );
    });
  });

  describe('getPaastUserHistory', () => {
    it('kẹp limit trong khoảng [1, 100], page tối thiểu 1', async () => {
      const { service, prisma } = build();

      await service.getPaastUserHistory('user-1', { page: 0, limit: 500 } as any);

      const findManyArg = prisma.paastAnalysisHistory.findMany.mock.calls[0][0];
      expect(findManyArg.take).toBe(100);
      expect(findManyArg.skip).toBe(0);

      const countArg = prisma.paastAnalysisHistory.count.mock.calls[0][0];
      expect(countArg.where).toEqual({ user_id: 'user-1' });
    });

    it('chỉ thêm điều kiện status khi query có truyền status', async () => {
      const { service, prisma } = build();

      await service.getPaastUserHistory('user-1', { status: 'SUCCESS' } as any);

      const findManyArg = prisma.paastAnalysisHistory.findMany.mock.calls[0][0];
      expect(findManyArg.where).toEqual({ user_id: 'user-1', status: 'SUCCESS' });
    });
  });
});
