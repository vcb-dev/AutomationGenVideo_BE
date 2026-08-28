import { of } from 'rxjs';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AiIntegrationService } from '../ai-integration.service';
import { PAAST_LOGIC_VERSION } from '../interfaces/paast-analysis.interface';

/**
 * PAAST sau khi dời từ PaastAnalyzerService sang AiIntegrationService (gộp module vì cùng là
 * orchestration gọi AI service). Khoá lại các quyết định nghiệp vụ đã có từ trước khi dời:
 * - findLatestByContent KHÔNG lọc theo user (kết quả chỉ phụ thuộc nội dung).
 * - getPaastHistoryDetail chặn xem lịch sử của người khác (404 thay vì 403 để không lộ record tồn tại).
 * - upgradeAnalysis chỉ nâng cấp được bản đã phân tích xong, trích đúng tiêu chí `miss`.
 */
describe('AiIntegrationService — PAAST', () => {
  function buildService(prismaOverrides: Record<string, any> = {}) {
    const httpService: any = {
      post: jest.fn(() => of({ data: {} })),
      get: jest.fn(() => of({ data: [] })),
    };
    const configService: any = {
      get: jest.fn((key: string, def?: string) =>
        key === 'AI_SERVICE_URL' ? 'http://localhost:8001' : def,
      ),
    };
    const jwtService: any = { sign: jest.fn(() => 'fake.jwt.token') };
    const driveStorage: any = {};
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
    const service = new AiIntegrationService(httpService, configService, jwtService, prisma, driveStorage, {} as any);
    return { service, prisma, httpService };
  }

  describe('findLatestByContent', () => {
    it('không lọc theo user_id — chỉ theo nội dung + trạng thái SUCCESS, lấy tối đa 5 bản ghi gần nhất', async () => {
      const { service, prisma } = buildService();

      await service.findLatestByContent('nội dung abc');

      const arg = prisma.paastAnalysisHistory.findMany.mock.calls[0][0];
      expect(arg.where).not.toHaveProperty('user_id');
      expect(arg.where).toEqual({ input_text: 'nội dung abc', status: 'SUCCESS' });
      expect(arg.take).toBe(5);
    });

    it('bỏ qua bản ghi có logic_version khác/không có, trả bản ghi khớp đúng version hiện hành', async () => {
      const stale = { id: 'old', analysis_result: { logic_version: 'v1' } };
      const legacy = { id: 'legacy', analysis_result: {} }; // trước cả khi có cơ chế version
      const current = { id: 'current', analysis_result: { logic_version: PAAST_LOGIC_VERSION } };
      const { service } = buildService({
        paastAnalysisHistory: { findMany: jest.fn(async () => [stale, legacy, current]) },
      });

      const result = await service.findLatestByContent('nội dung abc');

      expect(result).toEqual(current);
    });

    it('không có bản ghi nào khớp version hiện hành thì trả null (buộc chấm lại)', async () => {
      const { service } = buildService({
        paastAnalysisHistory: { findMany: jest.fn(async () => [{ id: 'old', analysis_result: { logic_version: 'v1' } }]) },
      });

      const result = await service.findLatestByContent('nội dung abc');

      expect(result).toBeNull();
    });
  });

  describe('getPaastHistoryDetail', () => {
    it('báo NotFoundException nếu bản ghi không tồn tại', async () => {
      const { service } = buildService();

      await expect(service.getPaastHistoryDetail('missing-id', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('báo NotFoundException nếu bản ghi tồn tại nhưng thuộc user khác (không lộ là có tồn tại)', async () => {
      const { service } = buildService({
        paastAnalysisHistory: {
          findUnique: jest.fn(async () => ({ id: 'h1', user_id: 'owner-1' })),
        },
      });

      await expect(service.getPaastHistoryDetail('h1', 'someone-else')).rejects.toThrow(NotFoundException);
    });

    it('trả về bản ghi nếu đúng chủ sở hữu', async () => {
      const record = { id: 'h1', user_id: 'owner-1', total_score: 80 };
      const { service } = buildService({
        paastAnalysisHistory: { findUnique: jest.fn(async () => record) },
      });

      await expect(service.getPaastHistoryDetail('h1', 'owner-1')).resolves.toEqual(record);
    });
  });

  describe('getPaastUserHistory', () => {
    it('kẹp limit trong khoảng [1, 100], page tối thiểu 1', async () => {
      const { service, prisma } = buildService();

      await service.getPaastUserHistory('user-1', { page: 0, limit: 500 } as any);

      const findManyArg = prisma.paastAnalysisHistory.findMany.mock.calls[0][0];
      expect(findManyArg.take).toBe(100);
      expect(findManyArg.skip).toBe(0); // page kẹp về 1 → skip = 0

      const countArg = prisma.paastAnalysisHistory.count.mock.calls[0][0];
      expect(countArg.where).toEqual({ user_id: 'user-1' });
    });

    it('chỉ thêm điều kiện status khi query có truyền status', async () => {
      const { service, prisma } = buildService();

      await service.getPaastUserHistory('user-1', { status: 'SUCCESS' } as any);

      expect(prisma.paastAnalysisHistory.count.mock.calls[0][0].where).toEqual({
        user_id: 'user-1',
        status: 'SUCCESS',
      });
    });
  });

  describe('upgradeAnalysis', () => {
    it('báo NotFoundException nếu bản phân tích gốc không tồn tại', async () => {
      const { service } = buildService();

      await expect(service.upgradeAnalysis('user-1', 'missing-id')).rejects.toThrow(NotFoundException);
    });

    it('báo BadRequestException nếu bản gốc chưa phân tích xong', async () => {
      const { service } = buildService({
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
        status: 'SUCCESS',
        analysis_result: {
          layers: {
            action: { criteria: [{ code: 'A1', status: 'miss', evidence: 'thiếu CTA' }, { code: 'A2', status: 'pass' }] },
            acknowledge: { criteria: [{ code: 'K1', status: 'na' }] },
            stick: { criteria: [{ code: 'S1', status: 'miss', evidence: 'thiếu điểm neo' }] },
            trust: { criteria: [{ code: 'T1', status: 'pass' }] },
          },
        },
      };
      const { service, prisma, httpService } = buildService({
        paastAnalysisHistory: { findUnique: jest.fn(async () => original) },
      });
      httpService.post.mockReturnValueOnce(of({
        data: { upgraded: 'nội dung mới', changes_added: [], new_analysis: { layers: {}, cta_warning: null, verdict: 'PASS', total_score: 90 } },
      }));

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
});
