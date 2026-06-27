import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function makeContext(user: any, requiredRoles?: UserRole[]) {
  const reflector = {
    getAllAndOverride: () => requiredRoles,
  } as unknown as Reflector;

  const ctx = {
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;

  return { guard: new RolesGuard(reflector), ctx };
}

describe('RolesGuard', () => {
  it('allows when no roles are required', () => {
    const { guard, ctx } = makeContext(undefined, undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('BUG-03: returns false (not a TypeError) when user is missing', () => {
    const { guard, ctx } = makeContext(undefined, [UserRole.ADMIN]);
    expect(() => guard.canActivate(ctx)).not.toThrow();
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('denies when user lacks the required role', () => {
    const { guard, ctx } = makeContext({ roles: [UserRole.MEMBER] }, [UserRole.ADMIN]);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('allows when user has a required role', () => {
    const { guard, ctx } = makeContext({ roles: [UserRole.ADMIN] }, [UserRole.ADMIN]);
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
