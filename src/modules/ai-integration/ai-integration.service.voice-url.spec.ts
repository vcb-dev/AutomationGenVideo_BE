import { of } from 'rxjs';
import { AiIntegrationService } from './ai-integration.service';

/**
 * /api/voice/* chỉ gọi AI_SERVICE_URL_VOICE (GPU). Không fallback MiniMax,
 * không fallback AI_SERVICE_URL / Railway private network.
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
    const jwtService: any = { sign: jest.fn(() => 'fake.jwt.token') };
    const driveStorage: any = {};

    const service = new AiIntegrationService(httpService, configService, jwtService, prisma, driveStorage, {} as any);
    return { service, httpService };
  }

  it('thiếu AI_SERVICE_URL_VOICE thì không khởi động — kể cả trên Railway', () => {
    expect(() =>
      buildService({
        AI_SERVICE_URL: 'https://local-tunnel.example.com',
        RAILWAY_ENVIRONMENT_NAME: 'production',
      }),
    ).toThrow(/AI_SERVICE_URL_VOICE/);
  });

  it('không fallback sang AI_SERVICE_URL khi thiếu URL GPU', () => {
    expect(() =>
      buildService({
        AI_SERVICE_URL: 'http://localhost:8000',
      }),
    ).toThrow(/AI_SERVICE_URL_VOICE/);
  });

  it('gọi đúng AI_SERVICE_URL_VOICE, không đụng AI_SERVICE_URL', async () => {
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

  it('listVoices cũng dùng AI_SERVICE_URL_VOICE', async () => {
    const { service, httpService } = buildService({
      AI_SERVICE_URL: 'https://local-tunnel.example.com',
      AI_SERVICE_URL_VOICE: 'https://gpu.example.com',
    });

    await service.listVoices();

    expect(httpService.get).toHaveBeenCalledWith('https://gpu.example.com/api/voice/list/');
  });
});
