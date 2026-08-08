import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { COOKIE_CSRF, CSRF_HEADER } from '../../../modules/auth/cookie.constants';
import { CsrfGuard } from '../csrf.guard';

function makeContext(opts: {
  method?: string;
  cookieValue?: string;
  headerValue?: string;
  authorization?: string;
}): ExecutionContext {
  const headers: Record<string, string> = {};
  if (opts.headerValue !== undefined) headers[CSRF_HEADER] = opts.headerValue;
  if (opts.authorization !== undefined) headers.authorization = opts.authorization;

  const req = {
    method: opts.method ?? 'POST',
    headers,
    cookies: opts.cookieValue !== undefined ? { [COOKIE_CSRF]: opts.cookieValue } : {},
  };

  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
  const guard = new CsrfGuard();

  it('cho qua khi cookie và header khớp nhau', () => {
    expect(guard.canActivate(makeContext({ cookieValue: 'tok', headerValue: 'tok' }))).toBe(true);
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
