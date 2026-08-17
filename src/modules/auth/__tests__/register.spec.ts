import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth.service';
import { UsersService } from '../../users/users.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RegisterDto } from '../dto/register.dto';

describe('AuthService.register', () => {
  let authService: AuthService;
  let mockPrisma: any;
  let mockUsersService: any;
  let mockJwtService: any;
  let mockConfigService: any;
  let mockCacheService: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };
    mockUsersService = {};
    mockJwtService = {};
    mockConfigService = {
      get: jest.fn(),
    };

    mockCacheService = {
      invalidate: jest.fn(),
      get: jest.fn(),
    };

    authService = new AuthService(
      mockUsersService as UsersService,
      mockJwtService as JwtService,
      mockConfigService as ConfigService,
      mockPrisma as PrismaService,
      mockCacheService as any,
    );
  });

  it('email đã tồn tại → ném ConflictException', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'existing-id', email: 'test@vcb.vn' });

    const dto: RegisterDto = {
      name: 'Nguyen Van A',
      email: 'test@vcb.vn',
      password: 'password123',
    };

    await expect(authService.register(dto)).rejects.toThrow(ConflictException);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('đăng ký thành công → tạo user với is_active=false (chờ admin duyệt)', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockImplementation(async (args: any) => ({
      id: 'new-user-id',
      email: args.data.email,
      full_name: args.data.full_name,
      roles: args.data.roles,
      team: args.data.team,
      is_active: args.data.is_active,
      created_at: new Date(),
    }));

    const dto: RegisterDto = {
      name: 'Nguyen Van A',
      email: 'newuser@vcb.vn',
      password: 'password123',
      team: 'Marketing',
    };

    const result = await authService.register(dto);

    expect(result.message).toContain('CHỜ ADMIN PHÊ DUYỆT');
    expect(result.user.id).toBe('new-user-id');
    expect(result.user.email).toBe('newuser@vcb.vn');
    expect(result.user.is_active).toBe(false);

    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          full_name: 'Nguyen Van A',
          email: 'newuser@vcb.vn',
          is_active: false,
          team: 'Marketing',
        }),
      }),
    );

    // Kiểm tra password đã được hash
    const createCallData = mockPrisma.user.create.mock.calls[0][0].data;
    expect(createCallData.password_hash).toBeTruthy();
    expect(createCallData.password_hash).not.toBe('password123');
    const isMatch = await bcrypt.compare('password123', createCallData.password_hash);
    expect(isMatch).toBe(true);
  });
});
