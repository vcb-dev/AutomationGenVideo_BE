import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';

describe('RolesGuard — ADMIN và MANAGER tương đương (đều là 1)', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  function createMockContext(userRoles: UserRole[] | null, requiredRoles: UserRole[] | null): ExecutionContext {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(requiredRoles);

    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          user: userRoles ? { roles: userRoles } : null,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it('cho phép route không yêu cầu role (public / no requiredRoles)', () => {
    const context = createMockContext(null, null);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('từ chối khi user chưa đăng nhập (user = null) trên route có bảo vệ role', () => {
    const context = createMockContext(null, [UserRole.ADMIN]);
    expect(guard.canActivate(context)).toBe(false);
  });

  it('user có role MANAGER được phép truy cập route chỉ định @Roles(UserRole.ADMIN)', () => {
    const context = createMockContext([UserRole.MANAGER], [UserRole.ADMIN]);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('user có role ADMIN được phép truy cập route chỉ định @Roles(UserRole.MANAGER)', () => {
    const context = createMockContext([UserRole.ADMIN], [UserRole.MANAGER]);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('user có role MEMBER bị CHẶN khi truy cập route yêu cầu ADMIN', () => {
    const context = createMockContext([UserRole.MEMBER], [UserRole.ADMIN]);
    expect(guard.canActivate(context)).toBe(false);
  });

  it('user có role MEMBER bị CHẶN khi truy cập route yêu cầu MANAGER', () => {
    const context = createMockContext([UserRole.MEMBER], [UserRole.MANAGER]);
    expect(guard.canActivate(context)).toBe(false);
  });

  it('user có role LEADER bị CHẶN khi route yêu cầu ADMIN và LEADER không nằm trong danh sách', () => {
    const context = createMockContext([UserRole.LEADER], [UserRole.ADMIN]);
    expect(guard.canActivate(context)).toBe(false);
  });

  it('cả ADMIN và MANAGER đều qua được route yêu cầu [ADMIN, LEADER]', () => {
    const contextAdmin = createMockContext([UserRole.ADMIN], [UserRole.ADMIN, UserRole.LEADER]);
    const contextManager = createMockContext([UserRole.MANAGER], [UserRole.ADMIN, UserRole.LEADER]);
    expect(guard.canActivate(contextAdmin)).toBe(true);
    expect(guard.canActivate(contextManager)).toBe(true);
  });
});
