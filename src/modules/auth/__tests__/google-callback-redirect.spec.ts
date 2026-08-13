import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { CookieAuthService } from '../cookie-auth.service';
import { RefreshTokenService } from '../refresh-token.service';
import { UsersService } from '../../users/users.service';

const FRONTEND = 'http://localhost:3001';

// Jest tái sử dụng worker process giữa các file test, nên env đổi ở đây rò sang file chạy sau
// trong cùng worker — kiểu hỏng chỉ hiện ra khi đổi thứ tự chạy, cực khó lần.
const ORIGINAL_FRONTEND_URL = process.env.FRONTEND_URL;
afterAll(() => {
  if (ORIGINAL_FRONTEND_URL === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = ORIGINAL_FRONTEND_URL;
});

type Redirect = { url: string };

function fakeResponse() {
  const redirects: Redirect[] = [];
  const jsonBodies: any[] = [];
  let statusCode: number | null = null;
  const res: any = {
    redirect: (url: string) => redirects.push({ url }),
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (body: any) => jsonBodies.push(body),
  };
  return { res, redirects, jsonBodies, getStatus: () => statusCode };
}

function buildController(overrides: {
  issueSession?: jest.Mock;
} = {}) {
  const setAuthCookies = jest.fn();
  const issueSession =
    overrides.issueSession ??
    jest.fn(async () => ({
      tokenResponse: { access_token: 'jwt.access.value' },
      refreshToken: 'refresh-raw-value',
    }));

  const controller = new AuthController(
    { issueSession } as unknown as AuthService,
    { setAuthCookies } as unknown as CookieAuthService,
    {} as unknown as RefreshTokenService,
    {} as unknown as UsersService,
  );

  return { controller, setAuthCookies, issueSession };
}

function fakeRequest(user: any) {
  return { user, headers: { 'user-agent': 'Chrome/130' }, ip: '10.0.0.5' } as any;
}

describe('googleAuthRedirect — tài khoản không đăng nhập được', () => {
  beforeEach(() => {
    process.env.FRONTEND_URL = FRONTEND;
  });

  it('tài khoản bị vô hiệu hoá → về /login kèm thông báo, KHÔNG đặt cookie', async () => {
    const { controller, setAuthCookies } = buildController();
    const { res, redirects } = fakeResponse();

    await controller.googleAuthRedirect(fakeRequest({ isInactiveUser: true }), res);

    expect(redirects).toHaveLength(1);
    expect(redirects[0].url).toContain(`${FRONTEND}/login?error=`);
    expect(decodeURIComponent(redirects[0].url)).toContain('vô hiệu hóa');
    expect(setAuthCookies).not.toHaveBeenCalled();
  });

  it('email chưa được cấp tài khoản → về /login kèm thông báo, KHÔNG đặt cookie', async () => {
    const { controller, setAuthCookies } = buildController();
    const { res, redirects } = fakeResponse();

    await controller.googleAuthRedirect(fakeRequest({ isNewUser: true }), res);

    expect(decodeURIComponent(redirects[0].url)).toContain('chưa được tạo');
    expect(setAuthCookies).not.toHaveBeenCalled();
  });
});

describe('googleAuthRedirect — đăng nhập thành công', () => {
  beforeEach(() => {
    process.env.FRONTEND_URL = FRONTEND;
  });

  it('đặt cookie phiên từ access token và refresh token vừa cấp', async () => {
    const { controller, setAuthCookies } = buildController();
    const { res } = fakeResponse();

    await controller.googleAuthRedirect(fakeRequest({ id: 'u1', email: 'a@b.vn' }), res);

    expect(setAuthCookies).toHaveBeenCalledWith(res, {
      accessToken: 'jwt.access.value',
      refreshToken: 'refresh-raw-value',
    });
  });

  // Cookie là đường chính, nhưng FE ĐANG CHẠY vẫn đọc ?token= và thiếu nó là đá về /login.
  // Test này canh đúng cái bẫy đó: bỏ ?token= mà quên FE là đăng nhập Google chết câm.
  // GỠ test này ở bước deploy 3, cùng lúc gỡ ?token= khỏi controller.
  it('vẫn kèm ?token= cho FE bản cũ, đúng bằng access token trong cookie', async () => {
    const { controller } = buildController();
    const { res, redirects } = fakeResponse();

    await controller.googleAuthRedirect(fakeRequest({ id: 'u1', email: 'a@b.vn' }), res);

    const url = new URL(redirects[0].url);
    expect(url.pathname).toBe('/auth/google/callback');
    expect(url.searchParams.get('token')).toBe('jwt.access.value');
  });

  it('ghi lại user agent và IP vào phiên để lần ra token bị trộm từ đâu', async () => {
    const { controller, issueSession } = buildController();
    const { res } = fakeResponse();

    await controller.googleAuthRedirect(fakeRequest({ id: 'u1', email: 'a@b.vn' }), res);

    expect(issueSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1' }),
      { userAgent: 'Chrome/130', ipAddress: '10.0.0.5' },
    );
  });
});

describe('googleAuthRedirect — khi có lỗi', () => {
  beforeEach(() => {
    process.env.FRONTEND_URL = FRONTEND;
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Đây là đích của một redirect từ Google — người dùng cuối nhìn thẳng vào response. Bản cũ trả
  // 500 kèm err.stack, tức là phơi đường dẫn file và cấu trúc nội bộ cho bất kỳ ai bấm được nút
  // "Đăng nhập với Google".
  it('KHÔNG trả stack trace ra trình duyệt', async () => {
    const boom = new Error('kết nối DB hỏng');
    const { controller } = buildController({
      issueSession: jest.fn(async () => {
        throw boom;
      }),
    });
    const { res, redirects, jsonBodies, getStatus } = fakeResponse();

    await controller.googleAuthRedirect(fakeRequest({ id: 'u1', email: 'a@b.vn' }), res);

    expect(jsonBodies).toHaveLength(0);
    expect(getStatus()).toBeNull();

    // Soi nguyên URL sau khi giải mã: thông điệp lỗi gốc, tên file, và chữ "at " của stack frame
    // đều không được phép xuất hiện ở bất kỳ đâu trong thứ trả về trình duyệt.
    const url = decodeURIComponent(redirects[0].url);
    expect(url).not.toContain('kết nối DB hỏng');
    expect(url).not.toContain('auth.controller');
    expect(url).not.toContain('.ts:');
    expect(url).not.toMatch(/\bat\s+\w/);
  });

  it('đưa người dùng về /login kèm thông báo đọc được', async () => {
    const { controller } = buildController({
      issueSession: jest.fn(async () => {
        throw new Error('bất kỳ lỗi gì');
      }),
    });
    const { res, redirects } = fakeResponse();

    await controller.googleAuthRedirect(fakeRequest({ id: 'u1', email: 'a@b.vn' }), res);

    expect(redirects).toHaveLength(1);
    expect(redirects[0].url).toContain(`${FRONTEND}/login?error=`);
    expect(decodeURIComponent(redirects[0].url)).toContain('Đăng nhập Google thất bại');
  });

  // Stack vẫn phải còn để điều tra — chỉ khác chỗ: trong log server, không phải trong response.
  it('vẫn ghi lỗi đầy đủ vào log server', async () => {
    const boom = new Error('kết nối DB hỏng');
    const { controller } = buildController({
      issueSession: jest.fn(async () => {
        throw boom;
      }),
    });
    const { res } = fakeResponse();

    await controller.googleAuthRedirect(fakeRequest({ id: 'u1', email: 'a@b.vn' }), res);

    expect(console.error).toHaveBeenCalledWith('[GoogleCallback] CRITICAL ERROR:', boom);
  });
});
