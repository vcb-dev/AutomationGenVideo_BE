import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { CookieAuthService, extractAccessTokenFromCookie } from '../cookie-auth.service';
import {
  COOKIE_ACCESS,
  COOKIE_CSRF,
  COOKIE_REFRESH,
  REFRESH_COOKIE_PATH,
} from '../cookie.constants';

function buildService(env: Record<string, string> = {}) {
  const config = {
    get: (key: string, fallback?: string) => env[key] ?? fallback,
  } as unknown as ConfigService;
  return new CookieAuthService(config);
}

type CookieCall = { name: string; value: string; opts: any };

function fakeResponse() {
  const set: CookieCall[] = [];
  const cleared: Array<{ name: string; opts: any }> = [];
  const res = {
    cookie: (name: string, value: string, opts: any) => set.push({ name, value, opts }),
    clearCookie: (name: string, opts: any) => cleared.push({ name, opts }),
  } as unknown as Response;
  return { res, set, cleared };
}

const TOKENS = { accessToken: 'access.jwt.value', refreshToken: 'refresh-raw-value' };

describe('CookieAuthService — kiểm tra env lúc khởi tạo', () => {
  // Ném lỗi lúc dùng thì mãi tới lần đăng nhập đầu tiên mới lộ ra, mà lúc đó deploy đã xong và
  // người dùng là người phát hiện giúp. Phải chết ngay khi bootstrap.
  it('nổ ngay lúc khởi tạo khi COOKIE_SAMESITE không hợp lệ', () => {
    expect(() => buildService({ COOKIE_SAMESITE: 'khong-co-that' })).toThrow(/COOKIE_SAMESITE/);
    expect(() => buildService({ COOKIE_SAMESITE: '' })).toThrow(/COOKIE_SAMESITE/);
  });

  // FE và BE chạy khác domain (cross-site) → bắt buộc SameSite=None, mà trình duyệt vứt bỏ
  // None không kèm Secure — sai cặp này là toàn bộ đăng nhập chết câm ở production.
  it('nổ ngay lúc khởi tạo khi SameSite=none mà không bật Secure', () => {
    expect(() => buildService({ COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'false' })).toThrow(
      /COOKIE_SECURE/,
    );
    expect(() =>
      buildService({ COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'true' }),
    ).not.toThrow();
  });

  it('khởi tạo bình thường khi không có env — mặc định sameSite=lax, secure=false', () => {
    expect(() => buildService()).not.toThrow();
  });
});

describe('CookieAuthService.setAuthCookies', () => {
  it('đặt đủ ba cookie đúng tên', () => {
    const { res, set } = fakeResponse();
    buildService().setAuthCookies(res, TOKENS);
    expect(set.map((c) => c.name)).toEqual([COOKIE_ACCESS, COOKIE_REFRESH, COOKIE_CSRF]);
  });

  it('access và refresh là HttpOnly, csrf thì KHÔNG', () => {
    const { res, set } = fakeResponse();
    buildService().setAuthCookies(res, TOKENS);
    const byName = Object.fromEntries(set.map((c) => [c.name, c.opts]));
    expect(byName[COOKIE_ACCESS].httpOnly).toBe(true);
    expect(byName[COOKIE_REFRESH].httpOnly).toBe(true);
    expect(byName[COOKIE_CSRF].httpOnly).toBe(false);
  });

  // Route thật là /api/auth/refresh (setGlobalPrefix('api') trong main.ts) — path sai thì
  // trình duyệt không bao giờ đính cookie refresh vào request, refresh luôn 401.
  it('cookie refresh dùng path /api/auth, hai cookie kia dùng /', () => {
    const { res, set } = fakeResponse();
    buildService().setAuthCookies(res, TOKENS);
    const byName = Object.fromEntries(set.map((c) => [c.name, c.opts]));
    expect(byName[COOKIE_REFRESH].path).toBe(REFRESH_COOKIE_PATH);
    expect(byName[COOKIE_REFRESH].path).toBe('/api/auth');
    expect(byName[COOKIE_ACCESS].path).toBe('/');
    expect(byName[COOKIE_CSRF].path).toBe('/');
  });

  it('maxAge lấy từ biến môi trường', () => {
    const { res, set } = fakeResponse();
    buildService({ JWT_ACCESS_EXPIRES: '15m', JWT_REFRESH_EXPIRES: '7d' }).setAuthCookies(res, TOKENS);
    const byName = Object.fromEntries(set.map((c) => [c.name, c.opts]));
    expect(byName[COOKIE_ACCESS].maxAge).toBe(900_000);
    expect(byName[COOKIE_REFRESH].maxAge).toBe(604_800_000);
  });

  it('định dạng thời hạn sai → âm thầm dùng mặc định 7 ngày', () => {
    const { res, set } = fakeResponse();
    buildService({ JWT_ACCESS_EXPIRES: '15x' }).setAuthCookies(res, TOKENS);
    const byName = Object.fromEntries(set.map((c) => [c.name, c.opts]));
    expect(byName[COOKIE_ACCESS].maxAge).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('sameSite theo biến môi trường COOKIE_SAMESITE', () => {
    const { res, set } = fakeResponse();
    buildService({ COOKIE_SAMESITE: 'strict' }).setAuthCookies(res, TOKENS);
    expect(set.every((c) => c.opts.sameSite === 'strict')).toBe(true);
  });

  it('mặc định sameSite=lax khi không có env', () => {
    const { res, set } = fakeResponse();
    buildService().setAuthCookies(res, TOKENS);
    expect(set.every((c) => c.opts.sameSite === 'lax')).toBe(true);
  });

  it('secure theo biến môi trường COOKIE_SECURE', () => {
    const { res, set } = fakeResponse();
    buildService({ COOKIE_SECURE: 'true' }).setAuthCookies(res, TOKENS);
    expect(set.every((c) => c.opts.secure === true)).toBe(true);
  });

  it('mặc định là secure=false khi không có env', () => {
    const { res, set } = fakeResponse();
    buildService().setAuthCookies(res, TOKENS);
    expect(set.every((c) => c.opts.secure === false)).toBe(true);
  });

  it('csrf token khác nhau giữa hai lần đăng nhập', () => {
    const a = fakeResponse();
    const b = fakeResponse();
    const service = buildService();
    service.setAuthCookies(a.res, TOKENS);
    service.setAuthCookies(b.res, TOKENS);
    const csrfA = a.set.find((c) => c.name === COOKIE_CSRF)!.value;
    const csrfB = b.set.find((c) => c.name === COOKIE_CSRF)!.value;
    expect(csrfA).not.toBe(csrfB);
    expect(csrfA).toHaveLength(64); // 32 byte hex
  });
});

describe('CookieAuthService.clearAuthCookies', () => {
  it('xoá đủ ba cookie', () => {
    const { res, cleared } = fakeResponse();
    buildService().clearAuthCookies(res);
    expect(cleared.map((c) => c.name)).toEqual([COOKIE_ACCESS, COOKIE_REFRESH, COOKIE_CSRF]);
  });

  // Trình duyệt chỉ xoá cookie khi path/sameSite khớp với lúc đặt.
  it('dùng đúng path đã đặt lúc set, đặc biệt là /api/auth cho refresh', () => {
    const { res, set, cleared } = fakeResponse();
    const service = buildService();
    service.setAuthCookies(res, TOKENS);
    service.clearAuthCookies(res);

    for (const c of cleared) {
      const original = set.find((s) => s.name === c.name)!;
      expect(c.opts.path).toBe(original.opts.path);
      expect(c.opts.sameSite).toBe(original.opts.sameSite);
    }
  });
});

describe('CookieAuthService.clearIfUnauthorized', () => {
  // Để lại cookie chết thì FE lặp vô hạn 401 → refresh → 401; nhưng xoá cookie vì lỗi hạ tầng
  // thoáng qua thì đá văng cả người đang có phiên hoàn toàn hợp lệ.
  it('lỗi là UnauthorizedException → xoá cookie', () => {
    const { res, cleared } = fakeResponse();
    buildService().clearIfUnauthorized(res, new UnauthorizedException('Refresh Token hết hạn'));
    expect(cleared.map((c) => c.name)).toEqual([COOKIE_ACCESS, COOKIE_REFRESH, COOKIE_CSRF]);
  });

  it('lỗi hạ tầng (không phải UnauthorizedException) → giữ nguyên cookie', () => {
    const { res, cleared } = fakeResponse();
    buildService().clearIfUnauthorized(res, new Error('Connection terminated unexpectedly'));
    expect(cleared).toHaveLength(0);
  });
});

describe('extractAccessTokenFromCookie', () => {
  it('trả token khi cookie có mặt', () => {
    const req = { cookies: { [COOKIE_ACCESS]: 'abc.def.ghi' } } as unknown as Request;
    expect(extractAccessTokenFromCookie(req)).toBe('abc.def.ghi');
  });

  it('trả null khi không có cookie nào', () => {
    expect(extractAccessTokenFromCookie({} as Request)).toBeNull();
    expect(extractAccessTokenFromCookie({ cookies: {} } as unknown as Request)).toBeNull();
  });
});
