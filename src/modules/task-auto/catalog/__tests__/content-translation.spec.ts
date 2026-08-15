import { TaskAutoCatalogService } from '../catalog.service';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Content Translations — bản dịch content theo thị trường (1 bản/market, xem
 * ContentTranslation trong schema.prisma). aiTranslateContent() chỉ trả bản NHÁP,
 * không ghi DB — người dùng phải bấm lưu riêng qua upsertContentTranslation().
 */
describe('TaskAutoCatalogService — Content Translations', () => {
  function notFoundError() {
    return new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '5.22.0',
    });
  }

  function build(opts: {
    content?: any;
    translateImpl?: (params: any) => Promise<any>;
  } = {}) {
    const upsertCalls: any[] = [];
    const deleteCalls: any[] = [];
    const prisma: any = {
      content: {
        findUnique: jest.fn(async () =>
          opts.content === undefined
            ? { id: 'content-1', title: 'Tiêu đề gốc', body: 'Nội dung gốc', script: null }
            : opts.content,
        ),
      },
      contentTranslation: {
        findMany: jest.fn(async () => []),
        upsert: jest.fn(async (args: any) => {
          upsertCalls.push(args);
          return { id: 'tr-1', ...args.create };
        }),
        delete: jest.fn(async (args: any) => {
          deleteCalls.push(args);
          return { id: 'tr-1' };
        }),
      },
    };
    const teamsService: any = {};
    const push: any = {};
    const aiIntegration: any = {
      translateVideoScript: jest.fn(
        opts.translateImpl ??
          (async (params: any) => ({ content: `[${params.market}] ${params.content}` })),
      ),
    };
    const service = new TaskAutoCatalogService(prisma, teamsService, push, aiIntegration);
    return { service, prisma, aiIntegration, upsertCalls, deleteCalls };
  }

  afterEach(() => jest.clearAllMocks());

  describe('getContentTranslations', () => {
    it('content không tồn tại → NotFoundException', async () => {
      const { service } = build({ content: null });

      await expect(service.getContentTranslations('missing')).rejects.toThrow(NotFoundException);
    });

    it('content tồn tại → trả danh sách từ DB', async () => {
      const { service, prisma } = build();

      await service.getContentTranslations('content-1');

      expect(prisma.contentTranslation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { content_id: 'content-1' } }),
      );
    });
  });

  describe('upsertContentTranslation', () => {
    const dto = { market: 'INDONESIA', title: 'Judul', body: 'Isi', script: null } as any;

    it('content không tồn tại → NotFoundException, không upsert', async () => {
      const { service, upsertCalls } = build({ content: null });

      await expect(service.upsertContentTranslation('missing', dto, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(upsertCalls).toHaveLength(0);
    });

    it('upsert đúng composite key content_id_market và gán translated_by_id theo người gọi', async () => {
      const { service, upsertCalls } = build();

      await service.upsertContentTranslation('content-1', dto, 'user-1');

      expect(upsertCalls[0].where).toEqual({
        content_id_market: { content_id: 'content-1', market: 'INDONESIA' },
      });
      expect(upsertCalls[0].create.translated_by_id).toBe('user-1');
      expect(upsertCalls[0].update.translated_by_id).toBe('user-1');
    });
  });

  describe('deleteContentTranslation', () => {
    it('xoá đúng composite key', async () => {
      const { service, deleteCalls } = build();

      await service.deleteContentTranslation('content-1', 'JAPAN');

      expect(deleteCalls[0].where).toEqual({
        content_id_market: { content_id: 'content-1', market: 'JAPAN' },
      });
    });

    it('bản dịch không tồn tại (P2025) → NotFoundException', async () => {
      const prisma: any = {
        contentTranslation: {
          delete: jest.fn(async () => {
            throw notFoundError();
          }),
        },
      };
      const service = new TaskAutoCatalogService(prisma, {} as any, {} as any, {} as any);

      await expect(service.deleteContentTranslation('content-1', 'JAPAN')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('aiTranslateContent', () => {
    it('content không tồn tại → NotFoundException', async () => {
      const { service } = build({ content: null });

      await expect(service.aiTranslateContent('missing', 'THAILAND')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('dịch cả title/body, bỏ qua field null (script) — KHÔNG gọi AI cho field rỗng', async () => {
      const { service, aiIntegration } = build();

      const result = await service.aiTranslateContent('content-1', 'THAILAND');

      expect(result).toEqual({
        market: 'THAILAND',
        title: '[THAILAND] Tiêu đề gốc',
        body: '[THAILAND] Nội dung gốc',
        script: null,
      });
      // title + body = 2 lần gọi, script null thì không gọi AI cho field đó.
      expect(aiIntegration.translateVideoScript).toHaveBeenCalledTimes(2);
    });

    it('CHỈ trả bản nháp — không ghi gì vào contentTranslation', async () => {
      const { service, prisma } = build();

      await service.aiTranslateContent('content-1', 'THAILAND');

      expect(prisma.contentTranslation.upsert).not.toHaveBeenCalled();
    });
  });
});
