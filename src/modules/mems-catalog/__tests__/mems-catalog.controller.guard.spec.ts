import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { MemsMediaLeaderGuard } from '../../../common/guards/mems-media-leader.guard';
import { MemsCatalogController } from '../mems-catalog.controller';

/**
 * Chức năng: mọi route GHI vào kho thiết bị phải đi qua cửa canh Team Media.
 *
 * Vì sao đáng một file test riêng: `@Roles(LEADER, MANAGER, ADMIN)` chỉ nói "phải có chức", không
 * nói "thuộc bộ phận nào". Thiếu guard thì leader bộ phận khác XOÁ được thiết bị của kho Media —
 * mà nhìn code thì route trông vẫn có vẻ được bảo vệ.
 *
 * Nguy hơn bên mượn trả: ở đây có thao tác không hoàn tác được (xoá thiết bị, xoá ảnh).
 */

/** Nest lưu danh sách guard của `@UseGuards` dưới khoá metadata này trên từng phương thức. */
const GUARDS_KEY = '__guards__';

const methodsOf = (controller: any): string[] =>
  Object.getOwnPropertyNames(controller.prototype).filter((name) => name !== 'constructor');

const rolesOf = (controller: any, method: string) =>
  Reflect.getMetadata(ROLES_KEY, controller.prototype[method]);

const guardsOf = (controller: any, method: string): any[] =>
  Reflect.getMetadata(GUARDS_KEY, controller.prototype[method]) ?? [];

describe('MemsCatalogController — cửa canh Team Media', () => {
  const methods = methodsOf(MemsCatalogController);

  it('mọi route có @Roles đều kèm MemsMediaLeaderGuard', () => {
    const thieuGuard = methods.filter(
      (m) =>
        rolesOf(MemsCatalogController, m) &&
        !guardsOf(MemsCatalogController, m).includes(MemsMediaLeaderGuard),
    );

    expect(thieuGuard).toEqual([]);
  });

  it('đúng những thao tác ghi vào kho được canh, không sót cái nào', () => {
    // Liệt kê đích danh để thêm route ghi mới mà quên guard là test đỏ ngay, chứ không lọt vì
    // phép đếm vẫn khớp.
    const daCanh = methods.filter((m) =>
      guardsOf(MemsCatalogController, m).includes(MemsMediaLeaderGuard),
    );

    expect(daCanh.sort()).toEqual(
      [
        'createAsset',
        'createCategory',
        'createLocation',
        'createModel',
        'deleteAsset',
        'deleteLocation',
        'inspect',
        'pendingInspection',
        'removePhoto',
        'setPrimaryPhoto',
        'updateAsset',
        'updateLocation',
        'uploadPhoto',
      ].sort(),
    );
  });

  it('route ĐỌC kho không bị canh — cả công ty phải tra được thiết bị', () => {
    // Canh nhầm vào đây là người muốn mượn máy không xem nổi kho có gì.
    for (const method of [
      'listAssets',
      'assetDetail',
      'listCategories',
      'listModels',
      'listLocations',
      'listPhotos',
    ]) {
      expect(guardsOf(MemsCatalogController, method)).not.toContain(MemsMediaLeaderGuard);
      expect(rolesOf(MemsCatalogController, method)).toBeUndefined();
    }
  });

  it('route phục vụ ảnh vẫn công khai — thẻ img không gửi được header xác thực', () => {
    expect(guardsOf(MemsCatalogController, 'servePhoto')).not.toContain(MemsMediaLeaderGuard);
  });
});
