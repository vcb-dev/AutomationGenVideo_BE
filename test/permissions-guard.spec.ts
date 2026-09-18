import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PermissionsGuard, checkPermissionMatch } from '../src/modules/auth/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../src/modules/auth/decorators/permissions.decorator';

/**
 * Unit test cho PermissionsGuard và hàm kiểm tra quyền checkPermissionMatch
 * Đảm bảo cơ chế phân quyền đa tầng: ADMIN bypass, so khớp chính xác, và kế thừa qua "all" / wildcard.
 */
describe('PermissionsGuard & checkPermissionMatch — Phân quyền đa tầng chi tiết', () => {
  describe('checkPermissionMatch()', () => {
    it('trả về true khi user có quyền khớp chính xác', () => {
      expect(checkPermissionMatch(['social:external:tiktok'], 'social:external:tiktok')).toBe(true);
      expect(checkPermissionMatch(['social:external:facebook', 'social:external:tiktok'], 'social:external:facebook')).toBe(true);
    });

    it('trả về false khi user không có quyền tương ứng', () => {
      expect(checkPermissionMatch(['social:external:tiktok'], 'social:external:douyin')).toBe(false);
      expect(checkPermissionMatch([], 'social:external:tiktok')).toBe(false);
    });

    it('trả về true khi user có quyền "all" cấp cha (ví dụ: social:external:all mở khoá tiktok, douyin, v.v.)', () => {
      const userPerms = ['social:external:all'];
      expect(checkPermissionMatch(userPerms, 'social:external:tiktok')).toBe(true);
      expect(checkPermissionMatch(userPerms, 'social:external:douyin')).toBe(true);
      expect(checkPermissionMatch(userPerms, 'social:external:facebook')).toBe(true);
      expect(checkPermissionMatch(userPerms, 'social:external:xiaohongshu')).toBe(true);
      // Quyền thuộc phân hệ khác không được mở
      expect(checkPermissionMatch(userPerms, 'portal:hr:manage')).toBe(false);
    });

    it('từ chối quyền cào tay crawl_all khi user chỉ có social:external:all (không thừa hưởng ngầm)', () => {
      const userPerms = ['social:external:all'];
      expect(checkPermissionMatch(userPerms, 'social:external:crawl_all')).toBe(false);
      // Chỉ cho phép khi có đích danh quyền cào tay hoặc wildcard *
      expect(checkPermissionMatch(['social:external:crawl_all'], 'social:external:crawl_all')).toBe(true);
      expect(checkPermissionMatch(['*'], 'social:external:crawl_all')).toBe(true);
    });

    it('trả về true khi user có wildcard "*"', () => {
      expect(checkPermissionMatch(['*'], 'social:external:tiktok')).toBe(true);
      expect(checkPermissionMatch(['social:*'], 'social:external:tiktok')).toBe(true);
    });
  });

  describe('PermissionsGuard.canActivate()', () => {
    let guard: PermissionsGuard;
    let reflector: Reflector;

    beforeEach(() => {
      reflector = new Reflector();
      guard = new PermissionsGuard(reflector);
    });

    const createMockContext = (user: any): ExecutionContext => {
      return {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({ user }),
        }),
      } as unknown as ExecutionContext;
    };

    it('cho phép qua khi endpoint không yêu cầu @RequirePermissions', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const context = createMockContext({ roles: [UserRole.MEMBER], permissions: [] });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('tài khoản ADMIN luôn được PASS mọi quyền (Admin Bypass)', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['social:external:douyin']);
      const adminContext = createMockContext({
        roles: [UserRole.ADMIN],
        permissions: [], // không cần gán permission tay
      });
      expect(guard.canActivate(adminContext)).toBe(true);
    });

    it('cho phép user thường khi có đúng quyền yêu cầu', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['social:external:tiktok']);
      const userContext = createMockContext({
        roles: [UserRole.MEMBER],
        permissions: ['social:external:tiktok'],
      });
      expect(guard.canActivate(userContext)).toBe(true);
    });

    it('cho phép user khi có quyền "all" của nhóm nền tảng', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['social:external:kuaishou']);
      const userContext = createMockContext({
        roles: [UserRole.MEMBER],
        permissions: ['social:external:all'],
      });
      expect(guard.canActivate(userContext)).toBe(true);
    });

    it('từ chối (trả về false) khi user không có quyền', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['social:external:douyin']);
      const userContext = createMockContext({
        roles: [UserRole.MEMBER],
        permissions: ['social:external:tiktok', 'social:external:facebook'],
      });
      expect(guard.canActivate(userContext)).toBe(false);
    });

    it('từ chối khi không có user trong request', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['social:external:tiktok']);
      const noUserContext = createMockContext(null);
      expect(guard.canActivate(noUserContext)).toBe(false);
    });
  });
});
