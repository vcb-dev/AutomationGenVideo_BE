import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { TaskAutoCatalogService } from '../catalog.service';
import {
  CreateContentDto,
  CreateTeamContentDto,
  CreateEditorContentDto,
} from '../dto/catalog.dto';

/**
 * Gói test cho TaskAutoCatalogService. Mỗi describe cấp cao là một chức năng độc lập; helper
 * `build()` cố tình bọc trong từng describe để state prisma-mock không rò rỉ giữa các nhóm.
 *
 * Các chức năng được phủ:
 *  - sentinel "__unassigned__" cho content_line_id (findAllContents/findAllEditorContents)
 *  - Content Translations (get/upsert/delete/aiTranslate)
 *  - listTeamPushRequests — editor_content select đủ field kịch bản
 *  - findOneContent/findOneEditorContent — select kèm _count.tasks
 *  - DTO tạo content — bắt buộc nhập tiêu đề
 */

/**
 * findAllContents/findAllEditorContents — sentinel "__unassigned__" cho content_line_id, dùng ở
 * board lọc theo tuyến (FE) để lọc content CHƯA gán tuyến nào. Query string không truyền được
 * content_line_id=null nên cần 1 giá trị đặc biệt riêng, khác hẳn nhánh lọc theo 1 tuyến cụ thể.
 */
describe('TaskAutoCatalogService — sentinel __unassigned__ cho content_line_id', () => {
  function build() {
    const findManyCalls: any[] = [];
    const prisma: any = {
      content: {
        findMany: jest.fn(async (args: any) => {
          findManyCalls.push(args);
          return [];
        }),
        count: jest.fn(async () => 0),
      },
      editorContent: {
        findMany: jest.fn(async (args: any) => {
          findManyCalls.push(args);
          return [];
        }),
        count: jest.fn(async () => 0),
      },
    };
    const service = new TaskAutoCatalogService(prisma, {} as any, {} as any, {} as any);
    return { service, getWhere: () => findManyCalls[0]?.where };
  }

  describe('findAllContents (kho tổng)', () => {
    it('content_line_id="__unassigned__" → lọc content_line_id = null', async () => {
      const { service, getWhere } = build();

      await service.findAllContents({ content_line_id: '__unassigned__' } as any);

      expect(getWhere().content_line_id).toBeNull();
    });

    it('content_line_id thường → lọc đúng tuyến đó, không phải null', async () => {
      const { service, getWhere } = build();

      await service.findAllContents({ content_line_id: 'line-a1' } as any);

      expect(getWhere().content_line_id).toBe('line-a1');
    });

    it('không truyền content_line_id → không lọc theo tuyến', async () => {
      const { service, getWhere } = build();

      await service.findAllContents({} as any);

      expect(getWhere().content_line_id).toBeUndefined();
    });
  });

  describe('findAllEditorContents (kho cá nhân)', () => {
    it('content_line_id="__unassigned__" → lọc content_line_id = null', async () => {
      const { service, getWhere } = build();

      await service.findAllEditorContents('user-1', { content_line_id: '__unassigned__' } as any);

      expect(getWhere().content_line_id).toBeNull();
    });

    it('content_line_id thường → lọc đúng tuyến đó', async () => {
      const { service, getWhere } = build();

      await service.findAllEditorContents('user-1', { content_line_id: 'line-a1' } as any);

      expect(getWhere().content_line_id).toBe('line-a1');
    });
  });
});

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

/**
 * listTeamPushRequests() (leader duyệt push request) — trước đây `pushRequestInclude.editor_content`
 * select hẹp chỉ lấy title, khiến ContentViewModal ở FE (TeamPushRequestsTab.tsx) không hiện được
 * kịch bản. Giờ select đủ body/script/voice_url/file_content_url để leader xem trước khi duyệt.
 */
describe('TaskAutoCatalogService.listTeamPushRequests — editor_content select đủ field kịch bản', () => {
  function build(opts: { team?: any } = {}) {
    const findManyCalls: any[] = [];
    const prisma: any = {
      team: {
        findUnique: jest.fn(async () =>
          opts.team === undefined
            ? { id: 'team-1', leader_id: 'leader-1' }
            : opts.team,
        ),
      },
      teamPushRequest: {
        findMany: jest.fn(async (args: any) => {
          findManyCalls.push(args);
          return [];
        }),
      },
    };
    const service = new TaskAutoCatalogService(prisma, {} as any, {} as any, {} as any);
    return { service, prisma, findManyCalls };
  }

  it('select editor_content kèm code/market/status/body/script/voice_url/file_content_url', async () => {
    const { service, findManyCalls } = build();

    await service.listTeamPushRequests('team-1', undefined, 'leader-1', ['LEADER']);

    expect(findManyCalls).toHaveLength(1);
    const editorContentSelect = findManyCalls[0].include.editor_content.select;
    expect(editorContentSelect).toEqual(
      expect.objectContaining({
        code: true,
        title: true,
        market: true,
        status: true,
        body: true,
        script: true,
        voice_url: true,
        file_content_url: true,
      }),
    );
  });

  it('editor_product vẫn giữ select hẹp (không có body/script — Product không có field kịch bản)', async () => {
    const { service, findManyCalls } = build();

    await service.listTeamPushRequests('team-1', undefined, 'leader-1', ['LEADER']);

    const editorProductSelect = findManyCalls[0].include.editor_product.select;
    expect(editorProductSelect).not.toHaveProperty('body');
    expect(editorProductSelect).not.toHaveProperty('script');
  });
});

// findOneContent + findOneEditorContent phải select kèm `_count: { tasks: true }`.
describe('TaskAutoCatalogService — select content kèm _count.tasks', () => {
  function build() {
    const calls: Record<string, any> = {};
    const prisma: any = {
      content: {
        findUnique: jest.fn(async (args: any) => {
          calls.content = args;
          return { id: 'c-1', _count: { tasks: 3 } };
        }),
      },
      editorContent: {
        findUnique: jest.fn(async (args: any) => {
          calls.editorContent = args;
          return { id: 'e-1', _count: { tasks: 0 } };
        }),
      },
    };
    const service = new TaskAutoCatalogService(prisma, {} as any, {} as any, {} as any);
    return { service, calls };
  }

  it('findOneContent select _count.tasks', async () => {
    const { service, calls } = build();
    await service.findOneContent('c-1');
    expect(calls.content.include._count).toEqual({ select: { tasks: true } });
  });

  it('findOneEditorContent select _count.tasks', async () => {
    const { service, calls } = build();
    await service.findOneEditorContent('e-1');
    expect(calls.editorContent.include._count).toEqual({ select: { tasks: true } });
  });
});

// CreateContentDto: title bắt buộc. Team/Editor: bắt buộc khi tạo mới (không có source_content_id).
describe('DTO tạo content — bắt buộc nhập tiêu đề', () => {
  const errorsOn = async (dto: object, field: string) => {
    const errs = await validate(dto);
    return errs.some((e) => e.property === field);
  };

  describe('CreateContentDto (kho tổng)', () => {
    it('thiếu title → lỗi validate ở field title', async () => {
      const dto = plainToInstance(CreateContentDto, { brand_type: 'DO_DA' });
      expect(await errorsOn(dto, 'title')).toBe(true);
    });

    it('title rỗng "" → lỗi validate ở field title', async () => {
      const dto = plainToInstance(CreateContentDto, { brand_type: 'DO_DA', title: '' });
      expect(await errorsOn(dto, 'title')).toBe(true);
    });

    it('có title → không còn lỗi ở field title', async () => {
      const dto = plainToInstance(CreateContentDto, { brand_type: 'DO_DA', title: 'Kịch bản A' });
      expect(await errorsOn(dto, 'title')).toBe(false);
    });
  });

  describe.each([
    ['CreateTeamContentDto', CreateTeamContentDto],
    ['CreateEditorContentDto', CreateEditorContentDto],
  ] as const)('%s (có nguồn hoặc tạo mới)', (_name, Dto) => {
    it('tạo mới (không source_content_id) mà thiếu title → lỗi validate ở field title', async () => {
      const dto = plainToInstance(Dto, { brand_type: 'DO_DA' });
      expect(await errorsOn(dto, 'title')).toBe(true);
    });

    it('copy từ kho khác (có source_content_id) mà thiếu title → KHÔNG lỗi ở field title', async () => {
      const dto = plainToInstance(Dto, { brand_type: 'DO_DA', source_content_id: 'src-1' });
      expect(await errorsOn(dto, 'title')).toBe(false);
    });

    it('tạo mới kèm title → không lỗi ở field title', async () => {
      const dto = plainToInstance(Dto, { brand_type: 'DO_DA', title: 'Kịch bản A' });
      expect(await errorsOn(dto, 'title')).toBe(false);
    });
  });
});
