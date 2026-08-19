import { TaskAutoTeamsService } from '../teams.service';

/**
 * getMyEditorApproval() — cho phép BẤT KỲ user nào (kể cả MEMBER thường) tự tra cứu trạng thái
 * duyệt editor của chính mình, không cần role ADMIN/MANAGER/LEADER như endpoint list
 * (GET /task-auto/editor-approvals). Tránh lộ danh sách approval của người khác cho Member.
 */
describe('TaskAutoTeamsService.getMyEditorApproval', () => {
  function build(opts: { approval?: any } = {}) {
    const prisma: any = {
      editorApproval: {
        findFirst: jest.fn(async () => (opts.approval === undefined ? null : opts.approval)),
      },
    };
    const service = new TaskAutoTeamsService(prisma);
    return { service, prisma };
  }

  it('user chưa từng yêu cầu duyệt → status null', async () => {
    const { service, prisma } = build();

    const result = await service.getMyEditorApproval('user-1');

    expect(result).toEqual({ status: null });
    expect(prisma.editorApproval.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: 'user-1' } }),
    );
  });

  it('user đã được duyệt → status APPROVED', async () => {
    const { service } = build({ approval: { status: 'APPROVED' } });

    const result = await service.getMyEditorApproval('user-1');

    expect(result).toEqual({ status: 'APPROVED' });
  });

  it('user đang chờ duyệt → status PENDING', async () => {
    const { service } = build({ approval: { status: 'PENDING' } });

    const result = await service.getMyEditorApproval('user-1');

    expect(result).toEqual({ status: 'PENDING' });
  });

  it('chỉ trả về bản ghi mới nhất của chính user đó, không lộ dữ liệu người khác', async () => {
    const { service, prisma } = build({ approval: { status: 'REJECTED' } });

    await service.getMyEditorApproval('user-2');

    expect(prisma.editorApproval.findFirst).toHaveBeenCalledWith({
      where: { user_id: 'user-2' },
      orderBy: { created_at: 'desc' },
      select: { status: true },
    });
  });
});
