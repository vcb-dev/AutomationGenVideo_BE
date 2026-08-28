import { of, throwError } from 'rxjs';
import { HttpException, HttpStatus } from '@nestjs/common';
import { AiIntegrationService } from '../ai-integration.service';

/**
 * Chức năng: POST /ai/content-transform/transcribe (AiIntegrationService#transcribeContentUpload).
 *
 * Khoá lại 2 bug độc lập vừa sửa (xem comment tại transcribeAiAuthHeaders/transcribeContentUpload):
 *  1. Auth — FE xác thực bằng cookie HttpOnly nên `authorization` header của request gốc thường
 *     rỗng; trước đây BE forward nguyên header đó (rỗng) khiến AI service trả 403. Giờ BE phải tự
 *     ký token nội bộ THEO ĐÚNG user gọi request (không phải danh tính 'be-system' dùng chung —
 *     Django dùng request.user.pk làm khoá throttle riêng từng người).
 *  2. Timeout — mốc cũ 60s nhỏ hơn cả thời gian Gemini thực sự cần (đo thật 110-240s), nên video
 *     dài luôn timeout. Giờ dùng CONTENT_TRANSFORM_TRANSCRIBE_TIMEOUT_MS (420s) và khi hết giờ ở
 *     tầng axios (không có response) phải trả về 504 kèm thông điệp tiếng Việt, không phải 500
 *     nguyên văn lỗi axios.
 */
describe('AiIntegrationService.transcribeContentUpload', () => {
  function buildService() {
    const httpService: any = { post: jest.fn(() => of({ data: { transcript: 'ok' } })) };
    const configService: any = {
      get: jest.fn((key: string, def?: string) => (key === 'AI_SERVICE_URL' ? 'http://ai.test:8001' : def)),
    };
    const jwtService: any = { sign: jest.fn(() => 'fake.jwt.token') };
    // 6 tham số: httpService, configService, jwtService, prisma, driveStorage, usersService —
    // transcribe không đụng 3 tham số cuối nên để {} as any.
    const service = new AiIntegrationService(httpService, configService, jwtService, {} as any, {} as any, {} as any);
    return { service, httpService, jwtService };
  }

  const fakeFile = { buffer: Buffer.from('fake-video-bytes'), originalname: 'a.mp4', mimetype: 'video/mp4' } as any;

  it('giữ nguyên Authorization của request gốc nếu có, không tự ký token', async () => {
    const { service, httpService, jwtService } = buildService();

    await service.transcribeContentUpload(fakeFile, 'Bearer client-token', { id: 'user-1', email: 'u1@x.com' });

    expect(httpService.post.mock.calls[0][2].headers.Authorization).toBe('Bearer client-token');
    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  it('không có Authorization (FE dùng cookie HttpOnly) — tự ký token nội bộ ĐÚNG theo user gọi request', async () => {
    const { service, httpService, jwtService } = buildService();

    await service.transcribeContentUpload(fakeFile, undefined, { id: 'user-1', email: 'u1@x.com' });

    expect(jwtService.sign).toHaveBeenCalledWith({ sub: 'user-1', email: 'u1@x.com' });
    expect(httpService.post.mock.calls[0][2].headers.Authorization).toBe('Bearer fake.jwt.token');
  });

  it('không có Authorization lẫn user — rơi về danh tính be-system (không có, không phải lỗi)', async () => {
    const { service, jwtService } = buildService();

    await service.transcribeContentUpload(fakeFile, undefined, undefined);

    expect(jwtService.sign).toHaveBeenCalledWith({ sub: 'be-system', email: 'be-system@internal.local' });
  });

  it('gửi kèm timeout_seconds cho Django khớp đúng ngân sách BE đang chờ (420s)', async () => {
    const { service, httpService } = buildService();

    await service.transcribeContentUpload(fakeFile, undefined, { id: 'user-1', email: 'u1@x.com' });

    const formData = httpService.post.mock.calls[0][1];
    const body = formData.getBuffer().toString('utf-8');
    const match = body.match(/name="timeout_seconds"\r\n\r\n(\d+)/);
    expect(match?.[1]).toBe('420');
    expect(httpService.post.mock.calls[0][2].timeout).toBe(420_000);
  });

  it('timeout ở tầng axios (không có response) -> 504 kèm thông điệp tiếng Việt, không phải 500 nguyên văn lỗi axios', async () => {
    const { service, httpService } = buildService();
    httpService.post.mockReturnValueOnce(
      throwError(() => ({ code: 'ECONNABORTED', message: 'timeout of 420000ms exceeded' })),
    );

    await expect(service.transcribeContentUpload(fakeFile, undefined, { id: 'user-1' })).rejects.toMatchObject({
      status: HttpStatus.GATEWAY_TIMEOUT,
    });
  });

  it('lỗi có response thật từ AI service — vẫn giữ nguyên status + message của AI service (không bị nuốt thành 504/500)', async () => {
    const { service, httpService } = buildService();
    httpService.post.mockReturnValueOnce(
      throwError(() => ({
        message: 'Request failed with status code 400',
        response: { status: 400, data: { error_message: 'File quá dài, chỉ chấp nhận dưới 10 phút' } },
      })),
    );

    await expect(service.transcribeContentUpload(fakeFile, undefined, { id: 'user-1' })).rejects.toMatchObject({
      status: 400,
      response: 'File quá dài, chỉ chấp nhận dưới 10 phút',
    });
  });
});
