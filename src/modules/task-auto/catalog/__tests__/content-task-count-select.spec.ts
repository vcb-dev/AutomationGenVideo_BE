import { TaskAutoCatalogService } from '../catalog.service';

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
