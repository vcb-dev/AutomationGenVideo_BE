import { TaskAutoCatalogService } from '../catalog.service';

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
