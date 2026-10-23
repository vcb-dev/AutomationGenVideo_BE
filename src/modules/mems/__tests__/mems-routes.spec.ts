import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MemsMediaLeaderGuard } from '../../../common/guards/mems-media-leader.guard';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { MemsModule } from '../mems.module';

/** Gốc của mọi route MEMS. */
const ROOT_MODULES: any[] = [MemsModule];

/** Nest lưu danh sách guard của `@UseGuards` dưới khoá này. */
const GUARDS_KEY = '__guards__';

/** [method đường-dẫn tên-handler, có canh Team Media hay không] */
const EXPECTED_ROUTES: [string, boolean][] = [
  ['GET mems/availability check', false],
  ['POST mems/requests create', false],
  ['GET mems/requests listRequests', false],
  ['GET mems/requests/:id requestDetail', false],
  ['POST mems/requests/:id/cancel cancel', false],
  ['POST mems/requests/:id/approve approve', true],
  ['POST mems/requests/:id/reject reject', true],
  ['GET mems/request-lines/:lineId/assignable-assets assignable', true],
  ['POST mems/requests/:id/assign assign', true],
  ['GET mems/requests/:id/handover-sheet handoverSheet', true],
  ['POST mems/requests/:id/handover handover', true],
  ['GET mems/requests/:id/pending-returns pendingReturns', true],
  ['POST mems/requests/:id/return receiveReturn', true],
  ['GET mems/borrow-history borrowHistoryLog', true],
  ['GET mems/assets/:id/borrow-history assetBorrowHistory', false],
  ['GET mems/assets listAssets', false],
  ['POST mems/assets createAsset', true],
  ['GET mems/assets/:assetCode assetDetail', false],
  ['PATCH mems/assets/:assetCode updateAsset', true],
  ['DELETE mems/assets/:assetCode deleteAsset', true],
  ['GET mems/categories listCategories', false],
  ['POST mems/categories createCategory', true],
  ['DELETE mems/categories/:id deleteCategory', true],
  ['GET mems/models listModels', false],
  ['POST mems/models createModel', true],
  ['DELETE mems/models/:id deleteModel', true],
  ['GET mems/locations listLocations', false],
  ['POST mems/locations createLocation', true],
  ['PATCH mems/locations/:id updateLocation', true],
  ['DELETE mems/locations/:id deleteLocation', true],
  ['GET mems/assets/:assetCode/photos listPhotos', false],
  ['POST mems/assets/:assetCode/photos uploadPhoto', true],
  ['POST mems/request-photos uploadRequestPhoto', false],
  ['POST mems/photos/:photoId/primary setPrimaryPhoto', true],
  ['DELETE mems/photos/:photoId removePhoto', true],
  ['GET mems/photos/:filename servePhoto', false],
  ['GET mems/pending-inspection pendingInspection', true],
  ['POST mems/assets/:assetCode/inspect inspect', true],
];

/** Gom controller của module và mọi module con nó import. */
function controllersOf(moduleClass: any, seen = new Set<any>()): any[] {
  if (typeof moduleClass !== 'function' || seen.has(moduleClass)) return [];
  seen.add(moduleClass);
  const own = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, moduleClass) ?? [];
  const imported = Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleClass) ?? [];
  return [...own, ...imported.flatMap((m: any) => controllersOf(m, seen))];
}

function routesOf(controllers: any[]) {
  return controllers.flatMap((controller) => {
    const base = Reflect.getMetadata(PATH_METADATA, controller);
    return Object.getOwnPropertyNames(controller.prototype)
      .filter((name) => name !== 'constructor' && Reflect.hasMetadata(METHOD_METADATA, controller.prototype[name]))
      .map((name) => {
        const handler = controller.prototype[name];
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)];
        return {
          key: `${method} ${base}/${Reflect.getMetadata(PATH_METADATA, handler)} ${name}`,
          name,
          guarded: (Reflect.getMetadata(GUARDS_KEY, handler) ?? []).includes(MemsMediaLeaderGuard),
          hasRoles: Reflect.getMetadata(ROLES_KEY, handler) !== undefined,
          isPublic: Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true,
        };
      });
  });
}

describe('Bảng route MEMS', () => {
  const seen = new Set<any>();
  const routes = routesOf(ROOT_MODULES.flatMap((m) => controllersOf(m, seen)));

  it('đúng method, đường dẫn, tên handler — tách module không được đổi URL', () => {
    expect(routes.map((r) => r.key).sort()).toEqual(EXPECTED_ROUTES.map(([key]) => key).sort());
  });

  it('đúng những route điều phối được canh Team Media', () => {
    expect(routes.filter((r) => r.guarded).map((r) => r.key).sort()).toEqual(
      EXPECTED_ROUTES.filter(([, guarded]) => guarded).map(([key]) => key).sort(),
    );
  });

  it('mọi route có @Roles đều kèm MemsMediaLeaderGuard', () => {
    expect(routes.filter((r) => r.hasRoles && !r.guarded).map((r) => r.key)).toEqual([]);
  });

  it('mọi route có MemsMediaLeaderGuard đều kèm @Roles', () => {
    expect(routes.filter((r) => r.guarded && !r.hasRoles).map((r) => r.key)).toEqual([]);
  });

  it('route phục vụ ảnh vẫn công khai — thẻ img không gửi được header xác thực', () => {
    expect(routes.find((r) => r.name === 'servePhoto')?.isPublic).toBe(true);
  });
});
