import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { CookieAuthService } from '../cookie-auth.service';

// Toàn bộ quyết định nghiệp vụ (thông điệp lỗi, ?token=, khi nào cấp phiên) đã chuyển xuống
// AuthService.resolveGoogleLogin/googleErrorRedirect — xem auth-service.spec.ts. File này chỉ còn
// kiểm tra phần orchestration của controller: gọi đúng service, áp dụng đúng cookie/redirect.

type Redirect = { url: string };

function fakeResponse() {
  const redirects: Redirect[] = [];
  const res: any = {
    redirect: (url: string) => redirects.push({ url }),
  };
  return { res, redirects };
}

function fakeRequest(user: any) {
  return { user } as any;
}

function buildController(
  opts: {
    resolveGoogleLogin?: jest.Mock;
    googleErrorRedirect?: jest.Mock;
  } = {},
) {
  const setAuthCookies = jest.fn();
  const resolveGoogleLogin =
    opts.resolveGoogleLogin ??
    jest.fn(async () => ({
      redirectUrl: 'http://localhost:3001/auth/google/callback?token=jwt.access.value',
      session: { accessToken: 'jwt.access.value', refreshToken: 'refresh-raw-value' },
    }));
  const googleErrorRedirect =
    opts.googleErrorRedirect ?? jest.fn(() => 'http://localhost:3001/login?error=fallback');

  const controller = new AuthController(
    { resolveGoogleLogin, googleErrorRedirect } as unknown as AuthService,
    { setAuthCookies } as unknown as CookieAuthService,
  );

  return { controller, setAuthCookies, resolveGoogleLogin, googleErrorRedirect };
}

describe('googleAuthRedirect — AuthService trả session (đăng nhập thành công)', () => {
  it('đặt cookie từ session AuthService trả về, rồi redirect đúng URL đó', async () => {
    const { controller, setAuthCookies } = buildController();
    const { res, redirects } = fakeResponse();

    await controller.googleAuthRedirect(fakeRequest({ id: 'u1' }), res);

    expect(setAuthCookies).toHaveBeenCalledWith(res, {
      accessToken: 'jwt.access.value',
      refreshToken: 'refresh-raw-value',
    });
    expect(redirects).toEqual([
      { url: 'http://localhost:3001/auth/google/callback?token=jwt.access.value' },
    ]);
  });

  it('chuyển đúng user vừa xác thực qua Google cho resolveGoogleLogin', async () => {
    const { controller, resolveGoogleLogin } = buildController();
    const { res } = fakeResponse();

    await controller.googleAuthRedirect(fakeRequest({ id: 'u1' }), res);

    expect(resolveGoogleLogin).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }));
  });
});

describe('googleAuthRedirect — AuthService KHÔNG trả session (tài khoản inactive/mới)', () => {
  it('KHÔNG đặt cookie, chỉ redirect theo URL AuthService trả về', async () => {
    const { controller, setAuthCookies } = buildController({
      resolveGoogleLogin: jest.fn(async () => ({
        redirectUrl: 'http://localhost:3001/login?error=abc',
      })),
    });
    const { res, redirects } = fakeResponse();

    await controller.googleAuthRedirect(fakeRequest({ isInactiveUser: true }), res);

    expect(setAuthCookies).not.toHaveBeenCalled();
    expect(redirects).toEqual([{ url: 'http://localhost:3001/login?error=abc' }]);
  });
});

describe('googleAuthRedirect — khi AuthService ném lỗi', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Controller KHÔNG được tự dựng URL lỗi từ err (dễ lộ message/stack ra response) — phải luôn đi
  // qua googleErrorRedirect(), vốn cố ý không nhận tham số lỗi.
  it('redirect theo URL cố định của googleErrorRedirect(), không lồng nội dung lỗi gốc', async () => {
    const boom = new Error('kết nối DB hỏng');
    const { controller, googleErrorRedirect } = buildController({
      resolveGoogleLogin: jest.fn(async () => {
        throw boom;
      }),
    });
    const { res, redirects } = fakeResponse();

    await controller.googleAuthRedirect(fakeRequest({ id: 'u1' }), res);

    expect(googleErrorRedirect).toHaveBeenCalled();
    expect(redirects).toEqual([{ url: 'http://localhost:3001/login?error=fallback' }]);
  });

  // Stack vẫn phải còn để điều tra — chỉ khác chỗ: trong log server, không phải trong response.
  it('vẫn ghi lỗi đầy đủ vào log server', async () => {
    const boom = new Error('kết nối DB hỏng');
    const { controller } = buildController({
      resolveGoogleLogin: jest.fn(async () => {
        throw boom;
      }),
    });
    const { res } = fakeResponse();

    await controller.googleAuthRedirect(fakeRequest({ id: 'u1' }), res);

    expect(console.error).toHaveBeenCalledWith('[GoogleCallback] CRITICAL ERROR:', boom);
  });
});
