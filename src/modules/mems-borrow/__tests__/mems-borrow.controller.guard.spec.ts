import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { MemsMediaLeaderGuard } from '../../../common/guards/mems-media-leader.guard';
import { MemsBorrowController } from '../mems-borrow.controller';

/**
 * Chức năng: mọi route ĐIỀU PHỐI kho phải đi qua cửa canh Team Media.
 *
 * Vì sao đáng một file test riêng: `@Roles(LEADER, MANAGER, ADMIN)` một mình chỉ nói "phải có
 * chức", không nói "phải thuộc bộ phận nào". Thiếu guard thì leader của Team K1 hay Team ADS
 * duyệt được phiếu mượn, gán máy và lập biên bản bàn giao cho kho Media — mà nhìn code thì mọi
 * thứ trông vẫn có vẻ được bảo vệ.
 *
 * Đây cũng là loại lỗi âm thầm quay lại: người thêm route quản trị mới rất dễ chép `@Roles` từ
 * route bên cạnh mà quên guard. Test này đọc metadata của Nest nên bắt được ngay ca đó.
 */

/** Nest lưu danh sách guard của `@UseGuards` dưới khoá metadata này trên từng phương thức. */
const GUARDS_KEY = '__guards__';

const methodsOf = (controller: any): string[] =>
  Object.getOwnPropertyNames(controller.prototype).filter((name) => name !== 'constructor');

const rolesOf = (controller: any, method: string) =>
  Reflect.getMetadata(ROLES_KEY, controller.prototype[method]);

const guardsOf = (controller: any, method: string): any[] =>
  Reflect.getMetadata(GUARDS_KEY, controller.prototype[method]) ?? [];

describe('MemsBorrowController — cửa canh Team Media', () => {
  const methods = methodsOf(MemsBorrowController);

  it('mọi route có @Roles đều kèm MemsMediaLeaderGuard', () => {
    const thieuGuard = methods.filter(
      (m) => rolesOf(MemsBorrowController, m) && !guardsOf(MemsBorrowController, m).includes(MemsMediaLeaderGuard),
    );

    expect(thieuGuard).toEqual([]);
  });

  it('đúng những thao tác điều phối được canh, không sót cái nào', () => {
    // Liệt kê đích danh: thêm route điều phối mới mà quên guard thì test đỏ, chứ không lặng lẽ
    // lọt vì phép đếm vẫn khớp.
    const daCanh = methods.filter((m) =>
      guardsOf(MemsBorrowController, m).includes(MemsMediaLeaderGuard),
    );

    expect(daCanh.sort()).toEqual(
      [
        'approve',
        'assign',
        'assignable',
        'borrowHistoryLog',
        'handover',
        'handoverSheet',
        'pendingReturns',
        'receiveReturn',
        'reject',
      ].sort(),
    );
  });

  it('route đọc và route tạo phiếu KHÔNG bị canh — ai cũng phải mượn được máy', () => {
    // Canh nhầm vào đây là cả công ty mất quyền xin mượn thiết bị.
    for (const method of ['check', 'create', 'listRequests', 'requestDetail', 'assetBorrowHistory']) {
      expect(guardsOf(MemsBorrowController, method)).not.toContain(MemsMediaLeaderGuard);
      expect(rolesOf(MemsBorrowController, method)).toBeUndefined();
    }
  });
});
