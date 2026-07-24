import { of } from 'rxjs';
import { AiIntegrationService } from './ai-integration.service';

/**
 * Regression test: /api/voice/* (TTS + clone giọng) phải gọi qua
 * voiceAiServiceUrl thay vì AI_SERVICE_URL chung (tunnel máy local) — root
 * cause khiến TTS 0:00/không tải được khi máy local tắt hoặc chưa cập nhật
 * code. Trên Railway (RAILWAY_ENVIRONMENT_NAME tự có, không cần khai báo),
 * mặc định trỏ private network automationgenvideo-ai.railway.internal — không
 * cần set biến gì thêm trên Railway. Xem ai-integration.service.ts constructor.
 */
describe('AiIntegrationService voice endpoint URL routing', () => {
  function buildService(configValues: Record<string, string>) {
    const httpService: any = {
      post: jest.fn(() => of({ data: { success: false } })),
      get: jest.fn(() => of({ data: [] })),
    };
    const configService: any = {
      get: jest.fn((key: string, def?: string) =>
        configValues[key] !== undefined ? configValues[key] : def,
      ),
    };
    const prisma: any = {};
    const driveStorage: any = {};

    const service = new AiIntegrationService(httpService, configService, prisma, driveStorage);
    return { service, httpService };
  }

  it('local dev (no RAILWAY_ENVIRONMENT_NAME): falls back to AI_SERVICE_URL', async () => {
    const { service, httpService } = buildService({
      AI_SERVICE_URL: 'http://localhost:8000',
    });

    await service.generateTTS('xin chào', 'voice_1');

    expect(httpService.post).toHaveBeenCalledWith(
      'http://localhost:8000/api/voice/tts/',
      expect.anything(),
      expect.anything(),
    );
  });

  it('running on Railway: defaults to the AI service private network URL, no extra config needed', async () => {
    const { service, httpService } = buildService({
      AI_SERVICE_URL: 'https://local-tunnel.example.com',
      RAILWAY_ENVIRONMENT_NAME: 'production',
    });

    await service.generateTTS('xin chào', 'voice_1');

    expect(httpService.post).toHaveBeenCalledWith(
      'http://automationgenvideo-ai.railway.internal:8000/api/voice/tts/',
      expect.anything(),
      expect.anything(),
    );
  });

  it('explicit AI_SERVICE_URL_VOICE always wins, even on Railway', async () => {
    const { service, httpService } = buildService({
      AI_SERVICE_URL: 'https://local-tunnel.example.com',
      RAILWAY_ENVIRONMENT_NAME: 'production',
      AI_SERVICE_URL_VOICE: 'https://custom-override.example.com',
    });

    await service.generateTTS('xin chào', 'voice_1');

    expect(httpService.post).toHaveBeenCalledWith(
      'https://custom-override.example.com/api/voice/tts/',
      expect.anything(),
      expect.anything(),
    );
  });

  it('running on Railway: listVoices also uses the private network URL', async () => {
    const { service, httpService } = buildService({
      AI_SERVICE_URL: 'https://local-tunnel.example.com',
      RAILWAY_ENVIRONMENT_NAME: 'production',
    });

    await service.listVoices();

    expect(httpService.get).toHaveBeenCalledWith(
      'http://automationgenvideo-ai.railway.internal:8000/api/voice/list/',
    );
  });
});
