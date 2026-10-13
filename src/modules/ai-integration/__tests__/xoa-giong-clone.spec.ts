import { of, throwError } from 'rxjs';
import { HttpException } from '@nestjs/common';
import { AiIntegrationService } from '../ai-integration.service';

/**
 * Chức năng: xoá giọng đã clone (DELETE ai/voice/:voiceId).
 *
 * BE chỉ là lớp proxy, nhưng có 3 điểm dễ sai và hậu quả thật: gọi nhầm sang
 * AI_SERVICE_URL chung (tunnel máy local, thường tắt), quên gửi X-Minimax-Key
 * (AI không có key trong .env nữa → xoá luôn thất bại), và nuốt mất câu lỗi của
 * AI service khiến người dùng chỉ thấy "500".
 */
describe('AiIntegrationService.deleteClonedVoice', () => {
  function buildService(configValues: Record<string, string> = {}) {
    // AI_SERVICE_URL không còn giá trị mặc định trong mã nguồn (xem common/config/ai-service-url),
    // nên test phải cấp — nếu không service dừng ngay ở constructor.
    configValues = { AI_SERVICE_URL: 'http://ai.test:8001', ...configValues };
    const httpService: any = {
      post: jest.fn(() => of({ data: {} })),
      get: jest.fn(() => of({ data: {} })),
      delete: jest.fn(() => of({ data: { success: true } })),
    };
    const configService: any = {
      get: jest.fn((key: string, def?: string) =>
        configValues[key] !== undefined ? configValues[key] : def,
      ),
    };
    const service = new AiIntegrationService(
      httpService,
      configService,
      { sign: jest.fn(() => 'fake.jwt.token') } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, httpService };
  }

  it('gọi DELETE tới voiceAiServiceUrl, không phải AI_SERVICE_URL chung', async () => {
    const { service, httpService } = buildService({
      AI_SERVICE_URL: 'https://local-tunnel.example.com',
      AI_SERVICE_URL_VOICE: 'https://voice-ai.example.com',
    });

    await service.deleteClonedVoice('KOC_Lan_a1b2c3d4');

    expect(httpService.delete).toHaveBeenCalledWith(
      'https://voice-ai.example.com/api/voice/delete/KOC_Lan_a1b2c3d4/',
      expect.anything(),
    );
  });

  it('gửi kèm X-Minimax-Key — AI service không còn giữ key trong .env của nó', async () => {
    const { service, httpService } = buildService({
      AI_SERVICE_URL_VOICE: 'https://voice-ai.example.com',
      MINIMAX_API_KEY: 'sk-api-abc',
    });

    await service.deleteClonedVoice('v1');

    expect(httpService.delete.mock.calls[0][1].headers).toEqual({ 'X-Minimax-Key': 'sk-api-abc' });
  });

  it('đặt timeout rộng hơn poll status — delete_voice bên AI có sẵn 3 lần thử x 30s', async () => {
    const { service, httpService } = buildService({ AI_SERVICE_URL_VOICE: 'https://voice-ai.example.com' });

    await service.deleteClonedVoice('v1');

    expect(httpService.delete.mock.calls[0][1].timeout).toBeGreaterThanOrEqual(60000);
  });

  it('mã hoá voice_id trong URL', async () => {
    const { service, httpService } = buildService({ AI_SERVICE_URL_VOICE: 'https://voice-ai.example.com' });

    await service.deleteClonedVoice('KOC A/1');

    expect(httpService.delete.mock.calls[0][0]).toBe('https://voice-ai.example.com/api/voice/delete/KOC%20A%2F1/');
  });

  it('trả nguyên body của AI service về cho FE', async () => {
    const { service, httpService } = buildService({ AI_SERVICE_URL_VOICE: 'https://voice-ai.example.com' });
    httpService.delete.mockReturnValueOnce(
      of({ data: { success: true, voice_id: 'v1', name: 'KOC Lan', minimax_deleted: true } }),
    );

    await expect(service.deleteClonedVoice('v1')).resolves.toEqual({
      success: true,
      voice_id: 'v1',
      name: 'KOC Lan',
      minimax_deleted: true,
    });
  });

  it('giữ nguyên status + câu lỗi của AI service (404 giọng không tồn tại)', async () => {
    const { service, httpService } = buildService({ AI_SERVICE_URL_VOICE: 'https://voice-ai.example.com' });
    httpService.delete.mockReturnValueOnce(
      throwError(() => ({
        message: 'Request failed with status code 404',
        response: { status: 404, data: { error: 'Không tìm thấy giọng này' } },
      })),
    );

    await expect(service.deleteClonedVoice('khong-co')).rejects.toMatchObject({
      status: 404,
      response: { error: 'Không tìm thấy giọng này' },
    });
  });

  it('lỗi mạng (không có response) vẫn thành HttpException 500, không rò lỗi thô', async () => {
    const { service, httpService } = buildService({ AI_SERVICE_URL_VOICE: 'https://voice-ai.example.com' });
    httpService.delete.mockReturnValueOnce(throwError(() => ({ message: 'ECONNREFUSED' })));

    await expect(service.deleteClonedVoice('v1')).rejects.toBeInstanceOf(HttpException);
  });
});
