import { of, throwError } from 'rxjs';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { TransformStatus } from '@prisma/client';
import { PaastService } from '../paast.service';

/**
 * PaastService — bản tách ra khỏi AiIntegrationService (xem comment gốc tại paast.service.ts).
 * CHƯA được đăng ký làm provider/dùng ở đâu, nhưng vẫn nằm trong src/*.ts nên vẫn cần test riêng
 * theo luật CI. Cùng bộ hành vi đã khoá ở AiIntegrationService — PAAST
 * (../../__tests__/paast.service.spec.ts): findLatestByContent không lọc theo user,
 * getPaastHistoryDetail chặn xem lịch sử người khác, upgradeAnalysis chỉ nâng cấp bản đã xong.
 */
describe('PaastService', () => {
  function build(prismaOverrides: Record<string, any> = {}) {
    const httpService: any = {
      post: jest.fn(() => of({ data: {} })),
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
    it('không lọc theo user_id — chỉ theo nội dung + trạng thái SUCCESS', async () => {
      const { service, prisma } = build();

      await service.findLatestByContent('nội dung abc');

      expect(prisma.paastAnalysisHistory.findFirst).toHaveBeenCalledWith({
        where: { input_text: 'nội dung abc', status: TransformStatus.SUCCESS },
        orderBy: { created_at: 'desc' },
      });
    });
  });

  describe('analyzeContent', () => {
    it('gọi AI service thành công → lưu SUCCESS kèm điểm/verdict', async () => {
      const { service, prisma, httpService } = build();
      httpService.post.mockReturnValueOnce(
        of({ data: { layers: { action: {} }, total_score: 85, verdict: 'PASS', cta_warning: null } }),
      );

      await service.analyzeContent('user-1', { content: 'nội dung dài đủ 100 ký tự...' } as any);

      expect(prisma.paastAnalysisHistory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: TransformStatus.SUCCESS, total_score: 85 }),
        }),
      );
    });

    it('AI service lỗi → lưu FAILED kèm error_message, không throw', async () => {
      const { service, prisma, httpService } = build();
      httpService.post.mockReturnValueOnce(
        throwError(() => ({ message: 'AI service down', response: undefined })),
      );

      await service.analyzeContent('user-1', { content: 'nội dung' } as any);

      expect(prisma.paastAnalysisHistory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: TransformStatus.FAILED, error_message: 'AI service down' }),
        }),
      );
    });
  });

  describe('getPaastHistoryDetail', () => {
    it('báo NotFoundException nếu bản ghi không tồn tại', async () => {
      const { service } = build();

      await expect(service.getPaastHistoryDetail('missing-id', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('báo NotFoundException nếu bản ghi thuộc user khác (không lộ là có tồn tại)', async () => {
      const { service } = build({
        paastAnalysisHistory: { findUnique: jest.fn(async () => ({ id: 'h1', user_id: 'owner-1' })) },
      });

      await expect(service.getPaastHistoryDetail('h1', 'someone-else')).rejects.toThrow(
        NotFoundException,
      );
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

      await expect(service.upgradeAnalysis('user-1', 'missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('báo BadRequestException nếu bản gốc chưa phân tích xong', async () => {
      const { service } = build({
        paastAnalysisHistory: {
          findUnique: jest.fn(async () => ({ id: 'h1', status: 'PENDING', analysis_result: null })),
        },
      });

      await expect(service.upgradeAnalysis('user-1', 'h1')).rejects.toThrow(BadRequestException);
    });

    it('chỉ trích tiêu chí đang miss từ 4 layer, gửi đúng missing_elements cho AI service', async () => {
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
    });
  });
});
