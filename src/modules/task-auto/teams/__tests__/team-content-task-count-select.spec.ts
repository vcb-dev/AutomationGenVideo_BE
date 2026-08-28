import { TaskAutoTeamsService } from '../teams.service';

/**
 * "Số lần được làm" của 1 team content = số task đã tạo trực tiếp từ nó (đếm sống, giảm khi task
 * bị xoá). BE trả qua `_count.tasks`; cả 2 hình dạng select dùng khi trả team content —
 * `teamContentInclude` (chi tiết/sửa) và `teamContentListSelect` (list rút gọn) — đều phải kèm
 * `_count: { select: { tasks: true } }`, nếu không FE mất badge ở list nhưng vẫn có ở modal (lệch).
 */
describe('TaskAutoTeamsService — select team content kèm _count.tasks', () => {
  const service = new TaskAutoTeamsService({} as any, {} as any) as any;

  it('teamContentInclude có _count.tasks', () => {
    expect(service.teamContentInclude._count).toEqual({ select: { tasks: true } });
  });

  it('teamContentListSelect có _count.tasks', () => {
    expect(service.teamContentListSelect._count).toEqual({ select: { tasks: true } });
  });
});
