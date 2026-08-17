import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth.service';
import { UsersService } from '../../users/users.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

function hashSha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

describe('AuthService - Forgot & Reset Password', () => {
  let authService: AuthService;
  let mockPrisma: any;
  let mockUsersService: any;
  let mockJwtService: any;
  let mockConfigService: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    mockUsersService = {};
    mockJwtService = {};
    mockConfigService = {
      get: jest.fn(),
    };

    authService = new AuthService(
      mockUsersService as UsersService,
      mockJwtService as JwtService,
      mockConfigService as ConfigService,
      mockPrisma as PrismaService,
    );
  });

  describe('forgotPassword', () => {
    it('email không tồn tại → vẫn trả thông báo chung (bảo mật, không làm lộ email)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const result = await authService.forgotPassword({ email: 'unknown@vcb.vn' });

      expect(result.message).toContain('Nếu email tồn tại trong hệ thống');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('email tồn tại → sinh OTP 6 số, lưu SHA-256 hash và hạn 15 phút', async () => {
      const user = { id: 'u-123', email: 'user@vcb.vn' };
      mockPrisma.user.findFirst.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue(user);

      const result = await authService.forgotPassword({ email: 'user@vcb.vn' });

      expect(result.message).toContain('Mã xác thực OTP đặt lại mật khẩu đã được gửi');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-123' },
          data: expect.objectContaining({
            reset_token_hash: expect.any(String),
            reset_token_expires: expect.any(Date),
          }),
        }),
      );

      const updateData = mockPrisma.user.update.mock.calls[0][0].data;
      const expiry = updateData.reset_token_expires.getTime();
      const now = Date.now();
      expect(expiry - now).toBeGreaterThan(14 * 60 * 1000); // Khoảng 15 phút
      expect(expiry - now).toBeLessThanOrEqual(15 * 60 * 1000 + 5000);
    });
  });

  describe('resetPassword', () => {
    it('user không tồn tại hoặc chưa từng yêu cầu reset → BadRequestException', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        authService.resetPassword({
          email: 'user@vcb.vn',
          otp: '123456',
          newPassword: 'newPassword123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('user không có reset_token_hash → BadRequestException', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'u-123',
        email: 'user@vcb.vn',
        reset_token_hash: null,
        reset_token_expires: null,
      });

      await expect(
        authService.resetPassword({
          email: 'user@vcb.vn',
          otp: '123456',
          newPassword: 'newPassword123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('OTP đã hết hạn → BadRequestException', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'u-123',
        email: 'user@vcb.vn',
        reset_token_hash: hashSha256('123456'),
        reset_token_expires: new Date(Date.now() - 1000), // Đã hết hạn 1s trước
      });

      await expect(
        authService.resetPassword({
          email: 'user@vcb.vn',
          otp: '123456',
          newPassword: 'newPassword123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('OTP không chính xác → BadRequestException', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'u-123',
        email: 'user@vcb.vn',
        reset_token_hash: hashSha256('123456'),
        reset_token_expires: new Date(Date.now() + 10 * 60 * 1000),
      });

      await expect(
        authService.resetPassword({
          email: 'user@vcb.vn',
          otp: '999999', // Sai OTP
          newPassword: 'newPassword123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('OTP hợp lệ → đổi mật khẩu mới, xóa reset_token và refresh_token_hash', async () => {
      const validOtp = '123456';
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'u-123',
        email: 'user@vcb.vn',
        reset_token_hash: hashSha256(validOtp),
        reset_token_expires: new Date(Date.now() + 10 * 60 * 1000),
      });
      mockPrisma.user.update.mockResolvedValue({ id: 'u-123' });

      const result = await authService.resetPassword({
        email: 'user@vcb.vn',
        otp: validOtp,
        newPassword: 'myNewStrongPassword123',
      });

      expect(result.message).toContain('Đặt lại mật khẩu thành công');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-123' },
          data: expect.objectContaining({
            reset_token_hash: null,
            reset_token_expires: null,
            refresh_token_hash: null,
          }),
        }),
      );

      const updateData = mockPrisma.user.update.mock.calls[0][0].data;
      const isNewPasswordValid = await bcrypt.compare(
        'myNewStrongPassword123',
        updateData.password_hash,
      );
      expect(isNewPasswordValid).toBe(true);
    });
  });
});
