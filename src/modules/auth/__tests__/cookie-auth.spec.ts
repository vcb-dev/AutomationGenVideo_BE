import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import {
  CookieAuthService,
  extractAccessTokenFromCookie,
  parseDurationMs,
} from '../cookie-auth.service';
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

describe('parseDurationMs', () => {
  it('đổi đúng các đơn vị sang mili giây', () => {
    expect(parseDurationMs('30s', 'X')).toBe(30_000);
    expect(parseDurationMs('15m', 'X')).toBe(900_000);
    expect(parseDurationMs('5h', 'X')).toBe(18_000_000);
    expect(parseDurationMs('7d', 'X')).toBe(604_800_000);
  });

  it('bỏ qua khoảng trắng và chữ hoa', () => {
    expect(parseDurationMs('  15M  ', 'X')).toBe(900_000);
  });

  // Bản mẫu tham chiếu âm thầm trả 15 phút khi parse hỏng. Hậu quả: gõ nhầm JWT_ACCESS_EXPIRES=15x
  // thì cả công ty bị đá ra sau 15 phút mà config nhìn vẫn rất hợp lệ. Phải nổ ngay lúc khởi động.
  it('ném lỗi kèm tên biến khi sai định dạng', () => {
    expect(() => parseDurationMs('15x', 'JWT_ACCESS_EXPIRES')).toThrow(/JWT_ACCESS_EXPIRES/);
    expect(() => parseDurationMs('', 'JWT_ACCESS_EXPIRES')).toThrow();
    expect(() => parseDurationMs('abc', 'JWT_ACCESS_EXPIRES')).toThrow();
  });
});

describe('CookieAuthService — kiểm tra env lúc khởi tạo', () => {
  // Ném lỗi lúc dùng thì mãi tới lần đăng nhập đầu tiên mới lộ ra, mà lúc đó deploy đã xong và
  // người dùng là người phát hiện giúp. Phải chết ngay khi bootstrap.
  it('nổ ngay lúc khởi tạo khi JWT_ACCESS_EXPIRES sai định dạng', () => {
    expect(() => buildService({ JWT_ACCESS_EXPIRES: '15x' })).toThrow(/JWT_ACCESS_EXPIRES/);
  });

  // COOKIE_SECURE="True" viết hoa thì `=== 'true'` cho ra false: production tưởng đã bật secure mà
  // cookie phiên vẫn đi qua HTTP trần, và không có dấu hiệu nào để nhận ra.
  it('nổ ngay lúc khởi tạo khi COOKIE_SECURE không phải true/false', () => {
    expect(() => buildService({ COOKIE_SECURE: 'True' })).not.toThrow();
    expect(() => buildService({ COOKIE_SECURE: '1' })).toThrow(/COOKIE_SECURE/);
    expect(() => buildService({ COOKIE_SECURE: 'yes' })).toThrow(/COOKIE_SECURE/);
  });

  // Viết hoa chữ L thì trình duyệt không nhận ra giá trị và vứt cả cookie.
  it('nổ ngay lúc khởi tạo khi COOKIE_SAMESITE không hợp lệ', () => {
    expect(() => buildService({ COOKIE_SAMESITE: 'khong-co-that' })).toThrow(/COOKIE_SAMESITE/);
    expect(() => buildService({ COOKIE_SAMESITE: '' })).toThrow(/COOKIE_SAMESITE/);
  });

  // Trình duyệt vứt bỏ cookie SameSite=None không kèm Secure — hỏng đúng lúc chuyển sang khác site.
  it('nổ ngay lúc khởi tạo khi SameSite=none mà không bật Secure', () => {
    expect(() => buildService({ COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'false' })).toThrow(
      /COOKIE_SECURE/,
    );
    expect(() =>
      buildService({ COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'true' }),
    ).not.toThrow();
  });

  it('nổ ngay lúc khởi tạo khi JWT_REFRESH_EXPIRES sai định dạng', () => {
    expect(() => buildService({ JWT_REFRESH_EXPIRES: '7z' })).toThrow(/JWT_REFRESH_EXPIRES/);
  });

  it('khởi tạo bình thường khi không có env — dùng mặc định 15m/7d', () => {
    const service = buildService();
    expect(service.accessMaxAge()).toBe(900_000);
    expect(service.refreshMaxAge()).toBe(604_800_000);
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
    // Double-submit chỉ chạy được khi JS đọc được cookie này rồi gửi lại qua header.
    expect(byName[COOKIE_CSRF].httpOnly).toBe(false);
  });

  it('cookie refresh dùng path hẹp /api/auth, hai cookie kia dùng /', () => {
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

  it('secure và sameSite theo biến môi trường', () => {
    const { res, set } = fakeResponse();
    buildService({ COOKIE_SECURE: 'true', COOKIE_SAMESITE: 'none' }).setAuthCookies(res, TOKENS);
    expect(set.every((c) => c.opts.secure === true)).toBe(true);
    expect(set.every((c) => c.opts.sameSite === 'none')).toBe(true);
  });

  it('mặc định là secure=false, sameSite=lax khi không có env', () => {
    const { res, set } = fakeResponse();
    buildService().setAuthCookies(res, TOKENS);
    expect(set.every((c) => c.opts.secure === false)).toBe(true);
    expect(set.every((c) => c.opts.sameSite === 'lax')).toBe(true);
  });

  it('chỉ gắn domain khi COOKIE_DOMAIN có giá trị', () => {
    const noDomain = fakeResponse();
    buildService().setAuthCookies(noDomain.res, TOKENS);
    expect(noDomain.set.every((c) => c.opts.domain === undefined)).toBe(true);

    const withDomain = fakeResponse();
    buildService({ COOKIE_DOMAIN: '.vcbi.vn' }).setAuthCookies(withDomain.res, TOKENS);
    expect(withDomain.set.every((c) => c.opts.domain === '.vcbi.vn')).toBe(true);
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

  // Trình duyệt chỉ xoá cookie khi path/domain/sameSite khớp với lúc đặt. Hai hàm set/clear trôi
  // lệch nhau là cookie xoá hụt — người dùng bấm "đăng xuất" mà phiên vẫn sống.
  it('dùng đúng path đã đặt lúc set, đặc biệt là /api/auth cho refresh', () => {
    const { res, set, cleared } = fakeResponse();
    const service = buildService({ COOKIE_DOMAIN: '.vcbi.vn', COOKIE_SAMESITE: 'strict' });
    service.setAuthCookies(res, TOKENS);
    service.clearAuthCookies(res);

    for (const c of cleared) {
      const original = set.find((s) => s.name === c.name)!;
      expect(c.opts.path).toBe(original.opts.path);
      expect(c.opts.domain).toBe(original.opts.domain);
      expect(c.opts.sameSite).toBe(original.opts.sameSite);
    }
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
