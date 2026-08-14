import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import * as jsonwebtoken from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth.service';
import { UsersService } from '../../users/users.service';
import type { LoginDto } from '../dto/login.dto';

const SECRET = 'test-secret';

function buildJwt() {
  return new JwtService({ secret: SECRET, signOptions: { expiresIn: '15m' } });
}

function buildConfig(env: Record<string, string> = {}) {
  return {
    get: (key: string, fallback?: string) => env[key] ?? fallback,
  } as unknown as ConfigService;
}

function buildUsersService(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    findByIdForAuth: jest.fn(),
    updateRefreshTokenHash: jest.fn(),
    findByEmail: jest.fn(),
    ...overrides,
  } as unknown as UsersService;
}

function hashSha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

const BASE_USER = { id: 'u1', email: 'a@b.vn', roles: ['MEMBER'], is_active: true };

describe('AuthService.login', () => {
  it('sai email/mật khẩu → 401, không cấp phiên', async () => {
    const users = buildUsersService({ findByEmail: jest.fn(async () => null) });
    const service = new AuthService(users, buildJwt(), buildConfig());

    await expect(
      service.login({ email: 'a@b.vn', password: 'secret123' } as LoginDto),
    ).rejects.toThrow(UnauthorizedException);
    expect(users.updateRefreshTokenHash).not.toHaveBeenCalled();
  });

  it('tài khoản bị vô hiệu hoá → 401, không cấp phiên', async () => {
    const password_hash = await bcrypt.hash('secret123', 10);
    const users = buildUsersService({
      findByEmail: jest.fn(async () => ({ ...BASE_USER, is_active: false, password_hash })),
    });
    const service = new AuthService(users, buildJwt(), buildConfig());

    await expect(
      service.login({ email: 'a@b.vn', password: 'secret123' } as LoginDto),
    ).rejects.toThrow(UnauthorizedException);
    expect(users.updateRefreshTokenHash).not.toHaveBeenCalled();
  });

  it('đúng mật khẩu → xác thực rồi cấp phiên luôn (validate + issueSession gộp)', async () => {
    const password_hash = await bcrypt.hash('secret123', 10);
    const users = buildUsersService({
      findByEmail: jest.fn(async () => ({ ...BASE_USER, password_hash })),
    });
    const service = new AuthService(users, buildJwt(), buildConfig());

    const { tokenResponse, refreshToken } = await service.login({
      email: 'a@b.vn',
      password: 'secret123',
    } as LoginDto);

    expect(tokenResponse.access_token).toBeTruthy();
    expect(refreshToken).toBeTruthy();
    expect(users.updateRefreshTokenHash).toHaveBeenCalledWith('u1', hashSha256(refreshToken));
  });
});

describe('AuthService.issueSession', () => {
  it('cấp accessToken + refreshToken JWT khác nhau, ghi bản băm refreshToken xuống DB', async () => {
    const jwt = buildJwt();
    const users = buildUsersService();
    const service = new AuthService(users, jwt, buildConfig());

    const { tokenResponse, refreshToken } = await service.issueSession(BASE_USER);

    expect(tokenResponse.access_token).toBeTruthy();
    expect(refreshToken).toBeTruthy();
    expect(refreshToken).not.toBe(tokenResponse.access_token);
    expect(users.updateRefreshTokenHash).toHaveBeenCalledWith('u1', hashSha256(refreshToken));
  });

  // Lý do tồn tại của hashSha256: DB không được phép giữ token thô, kể cả trong bản ghi vừa cấp.
  it('không lộ password_hash / refresh_token_hash ra tokenResponse.user', async () => {
    const jwt = buildJwt();
    const users = buildUsersService();
    const service = new AuthService(users, jwt, buildConfig());

    const { tokenResponse } = await service.issueSession({
      ...BASE_USER,
      password_hash: 'bcrypt-hash-bi-mat',
      refresh_token_hash: 'hash-cu',
    });

    const serialized = JSON.stringify(tokenResponse.user);
    expect(serialized).not.toContain('bcrypt-hash-bi-mat');
    expect(serialized).not.toContain('hash-cu');
  });
});

describe('AuthService.refreshTokens', () => {
  it('thiếu token → 401', async () => {
    const service = new AuthService(buildUsersService(), buildJwt(), buildConfig());
    await expect(service.refreshTokens('')).rejects.toThrow(UnauthorizedException);
  });

  it('token sai chữ ký hoặc không phải JWT → 401', async () => {
    const service = new AuthService(buildUsersService(), buildJwt(), buildConfig());
    await expect(service.refreshTokens('khong-phai-jwt')).rejects.toThrow(UnauthorizedException);
  });

  it('user không tồn tại → 401', async () => {
    const jwt = buildJwt();
    const raw = jwt.sign({ sub: 'ghost' });
    const users = buildUsersService({ findByIdForAuth: jest.fn(async () => null) });
    const service = new AuthService(users, jwt, buildConfig());

    await expect(service.refreshTokens(raw)).rejects.toThrow(UnauthorizedException);
  });

  it('tài khoản bị vô hiệu hoá → 401', async () => {
    const jwt = buildJwt();
    const raw = jwt.sign({ sub: 'u1' });
    const users = buildUsersService({
      findByIdForAuth: jest.fn(async () => ({
        ...BASE_USER,
        is_active: false,
        refresh_token_hash: hashSha256(raw),
      })),
    });
    const service = new AuthService(users, jwt, buildConfig());

    await expect(service.refreshTokens(raw)).rejects.toThrow(UnauthorizedException);
  });

  // Lý do tồn tại của single-hash: đăng nhập ở thiết bị mới ghi đè hash, nên refresh token của
  // thiết bị cũ — dù JWT còn hạn — không còn khớp DB nữa và bị từ chối.
  it('hash trong DB không khớp (đã bị ghi đè bởi phiên khác) → 401', async () => {
    const jwt = buildJwt();
    const raw = jwt.sign({ sub: 'u1' });
    const users = buildUsersService({
      findByIdForAuth: jest.fn(async () => ({
        ...BASE_USER,
        refresh_token_hash: 'hash-cua-phien-khac',
      })),
    });
    const service = new AuthService(users, jwt, buildConfig());

    await expect(service.refreshTokens(raw)).rejects.toThrow(UnauthorizedException);
  });

  it('chưa từng đăng nhập (refresh_token_hash null) → 401', async () => {
    const jwt = buildJwt();
    const raw = jwt.sign({ sub: 'u1' });
    const users = buildUsersService({
      findByIdForAuth: jest.fn(async () => ({ ...BASE_USER, refresh_token_hash: null })),
    });
    const service = new AuthService(users, jwt, buildConfig());

    await expect(service.refreshTokens(raw)).rejects.toThrow(UnauthorizedException);
  });

  it('hợp lệ → cấp lại cặp token mới và ghi đè hash (rotation)', async () => {
    const jwt = buildJwt();
    const raw = jwt.sign({ sub: 'u1' });
    const users = buildUsersService({
      findByIdForAuth: jest.fn(async () => ({ ...BASE_USER, refresh_token_hash: hashSha256(raw) })),
    });
    const service = new AuthService(users, jwt, buildConfig());

    const { tokenResponse, refreshToken } = await service.refreshTokens(raw);

    expect(refreshToken).not.toBe(raw);
    expect(tokenResponse.access_token).toBeTruthy();
    expect(users.updateRefreshTokenHash).toHaveBeenCalledWith('u1', hashSha256(refreshToken));
  });
});

describe('AuthService.logout', () => {
  it('có userId → xoá hash', async () => {
    const users = buildUsersService();
    const service = new AuthService(users, buildJwt(), buildConfig());

    await service.logout('u1');

    expect(users.updateRefreshTokenHash).toHaveBeenCalledWith('u1', null);
  });

  it('không có userId → không làm gì, không ném lỗi', async () => {
    const users = buildUsersService();
    const service = new AuthService(users, buildJwt(), buildConfig());

    await expect(service.logout(undefined)).resolves.toBeUndefined();
    expect(users.updateRefreshTokenHash).not.toHaveBeenCalled();
  });
});

describe('AuthService.logoutFromRefreshToken', () => {
  it('có cookie → giải mã userId (không verify) rồi xoá hash', async () => {
    const users = buildUsersService();
    const jwt = buildJwt();
    const service = new AuthService(users, jwt, buildConfig());
    const raw = jwt.sign({ sub: 'u1' });

    await service.logoutFromRefreshToken(raw);

    expect(users.updateRefreshTokenHash).toHaveBeenCalledWith('u1', null);
  });

  it('token đã hết hạn vẫn xoá được hash — không cần verify chữ ký/hạn', async () => {
    const users = buildUsersService();
    const service = new AuthService(users, buildJwt(), buildConfig());
    const expired = jsonwebtoken.sign(
      { sub: 'u1', exp: Math.floor(Date.now() / 1000) - 10 },
      SECRET,
    );

    await service.logoutFromRefreshToken(expired);

    expect(users.updateRefreshTokenHash).toHaveBeenCalledWith('u1', null);
  });

  it('không có cookie → không làm gì', async () => {
    const users = buildUsersService();
    const service = new AuthService(users, buildJwt(), buildConfig());

    await service.logoutFromRefreshToken(undefined);

    expect(users.updateRefreshTokenHash).not.toHaveBeenCalled();
  });
});

describe('AuthService.decodeRefreshTokenUserId', () => {
  // Lý do tồn tại: logout phải xoá được hash kể cả khi cookie refresh đã hết hạn — verify() sẽ
  // ném lỗi ở đúng lúc cần đọc payload nhất, nên hàm này CỐ Ý không kiểm tra hạn/chữ ký.
  it('lấy được sub từ token đã hết hạn, không cần verify', () => {
    const expired = jsonwebtoken.sign({ sub: 'u1', exp: Math.floor(Date.now() / 1000) - 10 }, SECRET);
    const service = new AuthService(buildUsersService(), buildJwt(), buildConfig());

    expect(service.decodeRefreshTokenUserId(expired)).toBe('u1');
  });

  it('token rác → null', () => {
    const service = new AuthService(buildUsersService(), buildJwt(), buildConfig());
    expect(service.decodeRefreshTokenUserId('khong-phai-jwt')).toBeNull();
  });
});

describe('AuthService.resolveGoogleLogin', () => {
  it('tài khoản bị vô hiệu hoá → về /login kèm thông báo, KHÔNG cấp phiên', async () => {
    const users = buildUsersService();
    const service = new AuthService(
      users,
      buildJwt(),
      buildConfig({ FRONTEND_URL: 'http://localhost:3001' }),
    );

    const result = await service.resolveGoogleLogin({ isInactiveUser: true });

    expect(result.session).toBeUndefined();
    expect(result.redirectUrl).toContain('http://localhost:3001/login?error=');
    expect(decodeURIComponent(result.redirectUrl)).toContain('vô hiệu hóa');
    expect(users.updateRefreshTokenHash).not.toHaveBeenCalled();
  });

  it('email chưa được cấp tài khoản → về /login kèm thông báo, KHÔNG cấp phiên', async () => {
    const users = buildUsersService();
    const service = new AuthService(
      users,
      buildJwt(),
      buildConfig({ FRONTEND_URL: 'http://localhost:3001' }),
    );

    const result = await service.resolveGoogleLogin({ isNewUser: true });

    expect(result.session).toBeUndefined();
    expect(decodeURIComponent(result.redirectUrl)).toContain('chưa được tạo');
  });

  it('hợp lệ → cấp phiên và trả URL callback kèm ?token= đúng bằng access token', async () => {
    const users = buildUsersService();
    const service = new AuthService(
      users,
      buildJwt(),
      buildConfig({ FRONTEND_URL: 'http://localhost:3001' }),
    );

    const result = await service.resolveGoogleLogin(BASE_USER);

    expect(result.session?.accessToken).toBeTruthy();
    expect(result.session?.refreshToken).toBeTruthy();

    const url = new URL(result.redirectUrl);
    expect(url.pathname).toBe('/auth/google/callback');
    expect(url.searchParams.get('token')).toBe(result.session?.accessToken);
    expect(users.updateRefreshTokenHash).toHaveBeenCalledWith('u1', expect.any(String));
  });

  it('dùng FRONTEND_URL mặc định (localhost:3001) khi không cấu hình', async () => {
    const service = new AuthService(buildUsersService(), buildJwt(), buildConfig());

    const result = await service.resolveGoogleLogin({ isInactiveUser: true });

    expect(result.redirectUrl).toContain('http://localhost:3001/login?error=');
  });
});

describe('AuthService.googleErrorRedirect', () => {
  it('trả URL /login kèm thông báo chung, không phụ thuộc lỗi gốc', () => {
    const service = new AuthService(
      buildUsersService(),
      buildJwt(),
      buildConfig({ FRONTEND_URL: 'http://localhost:3001' }),
    );

    const url = service.googleErrorRedirect();

    expect(url).toContain('http://localhost:3001/login?error=');
    expect(decodeURIComponent(url)).toContain('Đăng nhập Google thất bại');
  });
});
