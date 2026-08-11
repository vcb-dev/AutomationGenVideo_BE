import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { CookieAuthService } from '../cookie-auth.service';
import { RefreshTokenService } from '../refresh-token.service';
import { UsersService } from '../../users/users.service';
import { COOKIE_REFRESH } from '../cookie.constants';

const TTL_7D = 604_800_000;

function fakeResponse() {
  return {} as any;
}

function fakeRequest(rawToken?: string) {
  return {
    cookies: rawToken === undefined ? {} : { [COOKIE_REFRESH]: rawToken },
    headers: { 'user-agent': 'Chrome/130' },
    ip: '10.0.0.5',
  } as any;
}

function buildController(opts: {
  rotate?: jest.Mock;
  findOne?: jest.Mock;
} = {}) {
  const setAuthCookies = jest.fn();
  const clearAuthCookies = jest.fn();
  const generateToken = jest.fn(async () => ({ access_token: 'jwt.new.value' }));

  const rotate =
    opts.rotate ??
    jest.fn(async () => ({ userId: 'u1', rawToken: 'refresh-new', id: 'rt2', familyId: 'f1' }));
  const findOne = opts.findOne ?? jest.fn(async () => ({ id: 'u1', is_active: true }));

  const controller = new AuthController(
    { generateToken } as unknown as AuthService,
    {
      setAuthCookies,
      clearAuthCookies,
      refreshMaxAge: () => TTL_7D,
    } as unknown as CookieAuthService,
    { rotate } as unknown as RefreshTokenService,
    { findOne } as unknown as UsersService,
  );

  return { controller, setAuthCookies, clearAuthCookies, rotate, findOne, generateToken };
}

describe('POST /auth/refresh — đường thành công', () => {
  it('xoay vòng token rồi đặt lại cả bộ cookie', async () => {
    const { controller, setAuthCookies } = buildController();
    const res = fakeResponse();

    const result = await controller.refresh(fakeRequest('refresh-old'), res);

    expect(result).toEqual({ access_token: 'jwt.new.value' });
    expect(setAuthCookies).toHaveBeenCalledWith(res, {
      accessToken: 'jwt.new.value',
      refreshToken: 'refresh-new',
    });
  });
});

describe('POST /auth/refresh — mã lỗi trả về', () => {
  it('thiếu cookie refresh → 401', async () => {
    const { controller } = buildController();
    await expect(controller.refresh(fakeRequest(), fakeResponse())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('token bị thu hồi hoặc hết hạn → 401 và dọn sạch cookie', async () => {
    const { controller, clearAuthCookies } = buildController({
      rotate: jest.fn(async () => {
        throw new UnauthorizedException('Refresh token đã bị thu hồi');
      }),
    });
    const res = fakeResponse();

    await expect(controller.refresh(fakeRequest('refresh-old'), res)).rejects.toThrow(
      UnauthorizedException,
    );
    // Để lại cookie chết thì FE lặp vô hạn 401 → refresh → 401.
    expect(clearAuthCookies).toHaveBeenCalledWith(res);
  });

  // usersService.findOne NÉM NotFoundException chứ không trả null. Không nuốt thì refresh trả 404,
  // mà FE chỉ bắt 401 để về trang đăng nhập — người dùng treo ở màn hình trắng, không ai hiểu vì sao.
  it('user đã bị xoá → 401 chứ KHÔNG phải 404', async () => {
    const { controller, clearAuthCookies } = buildController({
      findOne: jest.fn(async () => {
        throw new NotFoundException('User with ID u1 not found');
      }),
    });
    const res = fakeResponse();

    const err = await controller
      .refresh(fakeRequest('refresh-old'), res)
      .then(() => null)
      .catch((e) => e);

    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err).not.toBeInstanceOf(NotFoundException);
    // Chốt bằng chính mã trạng thái đi ra ngoài, chứ không chỉ bằng tên class.
    expect(err.getStatus()).toBe(401);
    expect(clearAuthCookies).toHaveBeenCalledWith(res);
  });

  it('tài khoản bị vô hiệu hoá → 401 và dọn sạch cookie', async () => {
    const { controller, clearAuthCookies, setAuthCookies } = buildController({
      findOne: jest.fn(async () => ({ id: 'u1', is_active: false })),
    });
    const res = fakeResponse();

    await expect(controller.refresh(fakeRequest('refresh-old'), res)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(setAuthCookies).not.toHaveBeenCalled();
    expect(clearAuthCookies).toHaveBeenCalledWith(res);
  });
});

describe('POST /auth/refresh — lỗi hạ tầng KHÔNG được đăng xuất người dùng', () => {
  // Bản cũ bắt mọi lỗi rồi xoá cookie. Hậu quả: DB chớp lỗi một nhịp là đá văng tất cả những người
  // đang làm việc, trong khi phiên của họ còn hiệu lực hoàn toàn và chỉ cần thử lại là xong.
  it('DB chớp lỗi khi xoay vòng → giữ nguyên cookie', async () => {
    const { controller, clearAuthCookies } = buildController({
      rotate: jest.fn(async () => {
        throw new Error('Connection terminated unexpectedly');
      }),
    });
    const res = fakeResponse();

    await expect(controller.refresh(fakeRequest('refresh-old'), res)).rejects.toThrow(
      'Connection terminated unexpectedly',
    );
    expect(clearAuthCookies).not.toHaveBeenCalled();
  });

  // Chỗ dễ làm ẩu nhất: bọc findOne bằng .catch(() => null) cho gọn thì lỗi hạ tầng cũng hoá
  // thành "user không tồn tại" → 401 → xoá cookie. Chỉ NotFoundException mới được nuốt.
  it('DB chớp lỗi khi đọc user → lỗi nổi lên nguyên vẹn, giữ nguyên cookie', async () => {
    const { controller, clearAuthCookies, setAuthCookies } = buildController({
      findOne: jest.fn(async () => {
        throw new Error('Timed out fetching a new connection from the pool');
      }),
    });
    const res = fakeResponse();

    const err = await controller
      .refresh(fakeRequest('refresh-old'), res)
      .then(() => null)
      .catch((e) => e);

    expect(err.message).toBe('Timed out fetching a new connection from the pool');
    expect(err).not.toBeInstanceOf(UnauthorizedException);
    expect(clearAuthCookies).not.toHaveBeenCalled();
    expect(setAuthCookies).not.toHaveBeenCalled();
  });
});
