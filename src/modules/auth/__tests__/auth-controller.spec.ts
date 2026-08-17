import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { CookieAuthService } from '../cookie-auth.service';
import { COOKIE_REFRESH } from '../cookie.constants';
import type { LoginDto } from '../dto/login.dto';

function fakeResponse() {
  return {} as any;
}

function fakeRequest(rawToken?: string) {
  return {
    cookies: rawToken === undefined ? {} : { [COOKIE_REFRESH]: rawToken },
  } as any;
}

describe('POST /auth/login', () => {
  it('gọi AuthService.login, đặt cả bộ cookie, trả tokenResponse trong body', async () => {
    const login = jest.fn(async () => ({
      tokenResponse: { access_token: 'jwt.new.value' },
      refreshToken: 'refresh-new',
    }));
    const setAuthCookies = jest.fn();
    const controller = new AuthController(
      { login } as unknown as AuthService,
      { setAuthCookies } as unknown as CookieAuthService,
    );
    const loginDto: LoginDto = { email: 'a@b.vn', password: 'x' } as LoginDto;
    const res = fakeResponse();

    const result = await controller.login(loginDto, res);

    expect(login).toHaveBeenCalledWith(loginDto);
    expect(setAuthCookies).toHaveBeenCalledWith(res, {
      accessToken: 'jwt.new.value',
      refreshToken: 'refresh-new',
    });
    expect(result).toEqual({ access_token: 'jwt.new.value' });
  });
});

function buildRefreshController(opts: { refreshTokens?: jest.Mock } = {}) {
  const setAuthCookies = jest.fn();
  const clearIfUnauthorized = jest.fn();

  const refreshTokens =
    opts.refreshTokens ??
    jest.fn(async () => ({
      tokenResponse: { access_token: 'jwt.new.value' },
      refreshToken: 'refresh-new',
    }));

  const controller = new AuthController(
    { refreshTokens } as unknown as AuthService,
    { setAuthCookies, clearIfUnauthorized } as unknown as CookieAuthService,
  );

  return { controller, setAuthCookies, clearIfUnauthorized, refreshTokens };
}

describe('POST /auth/refresh — đường thành công', () => {
  it('xoay vòng token rồi đặt lại cả bộ cookie', async () => {
    const { controller, setAuthCookies } = buildRefreshController();
    const res = fakeResponse();

    const result = await controller.refresh(fakeRequest('refresh-old'), res);

    expect(result).toEqual({ access_token: 'jwt.new.value' });
    expect(setAuthCookies).toHaveBeenCalledWith(res, {
      accessToken: 'jwt.new.value',
      refreshToken: 'refresh-new',
    });
  });
});

// Quyết định "lỗi nào thì xoá cookie" nay sống ở CookieAuthService.clearIfUnauthorized (xem
// cookie-auth.spec.ts) — controller chỉ cần chuyển NGUYÊN lỗi cho nó rồi ném lại, không tự quyết.
describe('POST /auth/refresh — lỗi từ AuthService', () => {
  it('service ném lỗi bất kỳ → chuyển cho clearIfUnauthorized rồi ném lại đúng lỗi đó, không set cookie', async () => {
    const boom = new Error('Connection terminated unexpectedly');
    const { controller, clearIfUnauthorized, setAuthCookies } = buildRefreshController({
      refreshTokens: jest.fn(async () => {
        throw boom;
      }),
    });
    const res = fakeResponse();

    await expect(controller.refresh(fakeRequest('refresh-old'), res)).rejects.toBe(boom);
    expect(clearIfUnauthorized).toHaveBeenCalledWith(res, boom);
    expect(setAuthCookies).not.toHaveBeenCalled();
  });
});

describe('POST /auth/logout', () => {
  it('chuyển cookie refresh cho AuthService.logoutFromRefreshToken rồi luôn dọn cookie', async () => {
    const logoutFromRefreshToken = jest.fn(async () => {});
    const clearAuthCookies = jest.fn();
    const controller = new AuthController(
      { logoutFromRefreshToken } as unknown as AuthService,
      { clearAuthCookies } as unknown as CookieAuthService,
    );
    const res = fakeResponse();

    const result = await controller.logout(fakeRequest('refresh-old'), res);

    expect(logoutFromRefreshToken).toHaveBeenCalledWith('refresh-old');
    expect(clearAuthCookies).toHaveBeenCalledWith(res);
    expect(result).toEqual({ success: true });
  });

  // Không có cookie vẫn phải trả success — người dùng chỉ muốn thoát, kể cả khi chưa từng có phiên.
  it('không có cookie refresh → vẫn gọi logoutFromRefreshToken(undefined), vẫn trả success', async () => {
    const logoutFromRefreshToken = jest.fn(async () => {});
    const clearAuthCookies = jest.fn();
    const controller = new AuthController(
      { logoutFromRefreshToken } as unknown as AuthService,
      { clearAuthCookies } as unknown as CookieAuthService,
    );
    const res = fakeResponse();

    const result = await controller.logout(fakeRequest(), res);

    expect(logoutFromRefreshToken).toHaveBeenCalledWith(undefined);
    expect(clearAuthCookies).toHaveBeenCalledWith(res);
    expect(result).toEqual({ success: true });
  });
});

describe('POST /auth/register', () => {
  it('gọi AuthService.register và trả kết quả', async () => {
    const register = jest.fn(async () => ({
      message: 'Đăng ký thành công',
      user: { id: 'u1', email: 'test@vcb.vn' },
    }));
    const controller = new AuthController(
      { register } as unknown as AuthService,
      {} as unknown as CookieAuthService,
    );

    const dto = { name: 'Test', email: 'test@vcb.vn', password: '123' };
    const result = await controller.register(dto);

    expect(register).toHaveBeenCalledWith(dto);
    expect(result).toEqual({
      message: 'Đăng ký thành công',
      user: { id: 'u1', email: 'test@vcb.vn' },
    });
  });
});

describe('POST /auth/forgot-password', () => {
  it('gọi AuthService.forgotPassword và trả thông báo', async () => {
    const forgotPassword = jest.fn(async () => ({
      message: 'OTP đã được gửi',
    }));
    const controller = new AuthController(
      { forgotPassword } as unknown as AuthService,
      {} as unknown as CookieAuthService,
    );

    const dto = { email: 'test@vcb.vn' };
    const result = await controller.forgotPassword(dto);

    expect(forgotPassword).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ message: 'OTP đã được gửi' });
  });
});

describe('POST /auth/reset-password', () => {
  it('gọi AuthService.resetPassword và trả thông báo', async () => {
    const resetPassword = jest.fn(async () => ({
      message: 'Đặt lại mật khẩu thành công',
    }));
    const controller = new AuthController(
      { resetPassword } as unknown as AuthService,
      {} as unknown as CookieAuthService,
    );

    const dto = { email: 'test@vcb.vn', otp: '123456', newPassword: 'new123Password' };
    const result = await controller.resetPassword(dto);

    expect(resetPassword).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ message: 'Đặt lại mật khẩu thành công' });
  });
});

