import { NotFoundException } from '@nestjs/common';
import { TaskAutoTeamsService } from '../teams.service';

/**
 * listTeamContents — sentinel "__unassigned__" cho content_line_id (giống catalog.service.ts) +
 * fallback tuyến hiệu lực qua source_editor_content khi TeamContent chưa được copy content_line_id
 * riêng (record tạo trước khi copyEditorContentToTeam được sửa để copy sẵn tuyến).
 * findOneTeamContent — bản đầy đủ (có body/script) của 1 TeamContent, dùng cho modal xem chi
 * tiết/sửa vì listTeamContents (dạng phân trang) chủ động bớt body/script để nhẹ payload board.
 */
describe('TaskAutoTeamsService — lọc content theo tuyến + chi tiết TeamContent', () => {
  function build() {
    const findManyCalls: any[] = [];
    const prisma: any = {
      team: { findUnique: jest.fn(async () => ({ id: 'team-1' })) },
      teamContent: {
        findMany: jest.fn(async (args: any) => {
          findManyCalls.push(args);
          return [];
        }),
        findUnique: jest.fn(async () => null),
      },
    };
    const service = new TaskAutoTeamsService(prisma);
    return { service, prisma, getWhere: () => findManyCalls[0]?.where };
  }

  describe('listTeamContents — sentinel __unassigned__', () => {
    it('content_line_id="__unassigned__" → lọc content_line_id null của chính record VÀ (chưa có bản gốc HOẶC bản gốc cũng chưa gán tuyến)', async () => {
      const { service, getWhere } = build();

      await service.listTeamContents('team-1', undefined, undefined, undefined, {
        content_line_id: '__unassigned__',
      });

      expect(getWhere().AND).toEqual([
        { content_line_id: null },
        {
          OR: [
            { source_editor_content_id: null },
            { source_editor_content: { content_line_id: null } },
          ],
        },
      ]);
    });

    it('content_line_id thường → lọc theo tuyến của chính record HOẶC (record null nhưng bản gốc thuộc đúng tuyến đó)', async () => {
      const { service, getWhere } = build();

      await service.listTeamContents('team-1', undefined, undefined, undefined, {
        content_line_id: 'line-a1',
      });

      expect(getWhere().AND).toEqual([
        {
          OR: [
            { content_line_id: 'line-a1' },
            {
              AND: [
                { content_line_id: null },
                { source_editor_content: { content_line_id: 'line-a1' } },
              ],
            },
          ],
        },
      ]);
    });

    it('không truyền content_line_id → không lọc theo tuyến (không có AND)', async () => {
      const { service, getWhere } = build();

      await service.listTeamContents('team-1');

      expect(getWhere().AND).toBeUndefined();
    });
  });

  describe('findOneTeamContent', () => {
    it('trả về đầy đủ bản ghi (có body/script) khi tồn tại', async () => {
      const { service, prisma } = build();
      prisma.teamContent.findUnique.mockResolvedValueOnce({
        id: 'tc-1',
        body: 'nội dung đầy đủ',
        script: 'kịch bản đầy đủ',
      });

      const result = await service.findOneTeamContent('tc-1');

      expect(result).toEqual({ id: 'tc-1', body: 'nội dung đầy đủ', script: 'kịch bản đầy đủ' });
      expect(prisma.teamContent.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'tc-1' } }),
      );
    });

    it('không tồn tại → NotFoundException', async () => {
      const { service } = build();

      await expect(service.findOneTeamContent('tc-x')).rejects.toThrow(NotFoundException);
    });
  });
});
