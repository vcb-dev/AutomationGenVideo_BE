import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { COOKIE_CSRF, CSRF_HEADER } from '../cookie.constants';
import { CsrfGuard } from '../guards/csrf.guard';
import { SKIP_CSRF_KEY } from '../decorators/skip-csrf.decorator';

function makeReflector(skipCsrf = false): Reflector {
  return {
    getAllAndOverride: jest.fn().mockReturnValue(skipCsrf),
  } as unknown as Reflector;
}

function makeContext(opts: {
  method?: string;
  cookieValue?: string;
  headerValue?: string | string[];
  authorization?: string;
}): ExecutionContext {
  const headers: Record<string, string | string[]> = {};
  if (opts.headerValue !== undefined) headers[CSRF_HEADER] = opts.headerValue;
  if (opts.authorization !== undefined) headers.authorization = opts.authorization;

  const req = {
    method: opts.method ?? 'POST',
    headers,
    cookies: opts.cookieValue !== undefined ? { [COOKIE_CSRF]: opts.cookieValue } : {},
  };

  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
  const guard = new CsrfGuard(makeReflector(false));

  it('cho qua khi cookie và header khớp nhau', () => {
    expect(guard.canActivate(makeContext({ cookieValue: 'tok', headerValue: 'tok' }))).toBe(true);
  });

  // Gửi trùng header thì Node nối thành MỘT chuỗi "tok, tok" (đã đo bằng http.createServer —
  // KHÔNG phải mảng, chỉ set-cookie mới là mảng). So thẳng chuỗi đó với cookie thì luôn lệch, nên
  // client lỡ set hai lần ăn 403 vĩnh viễn trong khi devtools hiện giá trị đúng y hệt.
  it('cho qua khi header bị gửi trùng — Node nối thành "tok, tok"', () => {
    expect(guard.canActivate(makeContext({ cookieValue: 'tok', headerValue: 'tok, tok' }))).toBe(
      true,
    );
  });

  it('vẫn chặn khi header gửi trùng mà giá trị đầu lệch cookie', () => {
    expect(() =>
      guard.canActivate(makeContext({ cookieValue: 'tok', headerValue: 'khac, tok' })),
    ).toThrow(ForbiddenException);
  });

  // Phòng khi proxy hoặc framework khác trả về mảng thật.
  it('cũng xử lý được trường hợp header về dưới dạng mảng', () => {
    expect(
      guard.canActivate(makeContext({ cookieValue: 'tok', headerValue: ['tok', 'tok'] })),
    ).toBe(true);
  });

  it('chặn khi thiếu header', () => {
    expect(() => guard.canActivate(makeContext({ cookieValue: 'tok' }))).toThrow(ForbiddenException);
  });

  it('chặn khi thiếu cookie', () => {
    expect(() => guard.canActivate(makeContext({ headerValue: 'tok' }))).toThrow(ForbiddenException);
  });

  it('chặn khi hai bên lệch nhau', () => {
    expect(() =>
      guard.canActivate(makeContext({ cookieValue: 'tok', headerValue: 'khac' })),
    ).toThrow(ForbiddenException);
  });

  // Chuỗi rỗng ở cả hai phía vẫn "khớp" nếu so sánh ngây thơ — phải chặn.
  it('chặn khi cả hai đều là chuỗi rỗng', () => {
    expect(() =>
      guard.canActivate(makeContext({ cookieValue: '', headerValue: '' })),
    ).toThrow(ForbiddenException);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('bỏ qua method %s vì không đổi dữ liệu', (method) => {
    expect(guard.canActivate(makeContext({ method }))).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('có kiểm tra method %s', (method) => {
    expect(() => guard.canActivate(makeContext({ method }))).toThrow(ForbiddenException);
  });

  // Trình duyệt không tự gắn Authorization vào request do trang khác kích hoạt, nên request mang
  // Bearer về bản chất không có nguy cơ CSRF. Bắt ở đây chỉ làm gãy Swagger và script curl.
  it('bỏ qua khi request xác thực bằng Bearer header', () => {
    expect(guard.canActivate(makeContext({ authorization: 'Bearer abc.def.ghi' }))).toBe(true);
  });

  it('KHÔNG bỏ qua với scheme khác Bearer', () => {
    expect(() =>
      guard.canActivate(makeContext({ authorization: 'Basic dXNlcjpwYXNz' })),
    ).toThrow(ForbiddenException);
  });
});

describe('CsrfGuard + @SkipCsrf()', () => {
  const skipGuard = new CsrfGuard(makeReflector(true));

  it('cho qua POST khi route có @SkipCsrf(), không cần cookie/header CSRF', () => {
    expect(skipGuard.canActivate(makeContext({ method: 'POST' }))).toBe(true);
  });

  it('cho qua DELETE khi route có @SkipCsrf()', () => {
    expect(skipGuard.canActivate(makeContext({ method: 'DELETE' }))).toBe(true);
  });

  it('Reflector.getAllAndOverride được gọi đúng key SKIP_CSRF_KEY', () => {
    const reflector = makeReflector(true);
    const g = new CsrfGuard(reflector);
    const ctx = makeContext({ method: 'POST' });
    g.canActivate(ctx);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(SKIP_CSRF_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
  });
});

