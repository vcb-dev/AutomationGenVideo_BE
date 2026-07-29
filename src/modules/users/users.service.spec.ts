import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';

/**
 * Regression test for BUG-01: update() must persist the *sanitized* payload
 * (password -> password_hash, role -> roles, no raw `password`/`role` columns)
 * instead of spreading the raw DTO into Prisma.
 */
describe('UsersService.update (BUG-01)', () => {
  function buildService() {
    const existingUser = {
      id: 'u1',
      email: 'old@example.com',
      full_name: 'Old Name',
      team: 'A',
      roles: ['MEMBER'],
    };

    let capturedUpdateData: any = null;

    const tx = {
      user: {
        update: jest.fn(async ({ data }: any) => {
          capturedUpdateData = data;
          return { id: 'u1', email: existingUser.email, full_name: existingUser.full_name };
        }),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      larkReport: { updateMany: jest.fn() },
      larkReportKPI: { updateMany: jest.fn() },
      larkListTask: { updateMany: jest.fn() },
      larkKPI: { updateMany: jest.fn() },
    };

    const prisma: any = {
      user: { findUnique: jest.fn(async () => existingUser), findFirst: jest.fn(async () => null) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const cacheService: any = { invalidate: jest.fn() };
    const googleDrive: any = {};

    const service = new UsersService(prisma, cacheService, googleDrive);
    return { service, get capturedUpdateData() { return capturedUpdateData; } };
  }

  it('hashes password into password_hash and drops the raw `password` field', async () => {
    const ctx = buildService();
    await ctx.service.update('u1', { password: 'NewPassw0rd!' } as any);

    const data = ctx.capturedUpdateData;
    expect(data).toBeTruthy();
    expect(data.password).toBeUndefined();
    expect(typeof data.password_hash).toBe('string');
    await expect(bcrypt.compare('NewPassw0rd!', data.password_hash)).resolves.toBe(true);
  });

  it('converts legacy `role` to `roles` and never passes raw `role` to Prisma', async () => {
    const ctx = buildService();
    await ctx.service.update('u1', { role: 'ADMIN' } as any);

    const data = ctx.capturedUpdateData;
    expect(data.role).toBeUndefined();
    expect(data.roles).toEqual(['ADMIN']);
  });
});
