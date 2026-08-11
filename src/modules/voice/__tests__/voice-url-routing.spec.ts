import { of } from 'rxjs';
import { Logger } from '@nestjs/common';
import { VoiceService } from '../voice.service';

/**
 * Chức năng: định tuyến URL cho các endpoint /api/voice/* (TTS + clone giọng).
 *
 * Gộp từ 2 file (2026-08-07): ai-integration.service.voice-url.spec.ts (cạnh source,
 * regression TTS 0:00 khi voice đi nhầm qua tunnel máy local) + voice-railway-url.spec.ts
 * (bỏ hostname/cổng Railway gõ cứng). Cùng một chức năng thì một file test.
 *
 * Lịch sử hai quyết định mà file này khoá lại:
 * 1. Voice phải đi qua voiceAiServiceUrl, KHÔNG đi qua AI_SERVICE_URL chung — đường
 *    chung trỏ máy local qua Cloudflare Tunnel, máy tắt là TTS 0:00/không tải được.
 * 2. Không còn hostname/cổng Railway nào gõ sẵn trong code. Bản cũ đoán cổng 8080
 *    làm mặc định, nhưng Dockerfile.railway bind gunicorn vào ${PORT} do Railway cấp —
 *    đoán sai thì voice chết trên production trong khi local vẫn chạy. Nay phải khai
 *    AI_SERVICE_VOICE_RAILWAY_URL; chưa khai thì lùi về AI_SERVICE_URL và kêu to.
 *
 * MỌI URL TRONG FILE NÀY LÀ FIXTURE BỊA (example.com, cổng 9999...) — không phải
 * endpoint thật của hệ thống. Test so khớp chuỗi nên bắt buộc phải viết literal;
 * endpoint thật nằm ở .env, xem .env.example.
 */
describe('VoiceService — định tuyến URL voice', () => {
  const URL_TUNNEL = 'https://ai-tunnel.example.com';
  const URL_RAILWAY = 'http://vi-du-ai.railway.internal:9999';
  const URL_OVERRIDE = 'https://voice-override.example.com';

  // Cảnh báo phát ra ngay trong constructor nên phải spy TRƯỚC khi dựng service.
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  function buildService(configValues: Record<string, string> = {}) {
    const httpService: any = {
      post: jest.fn(() => of({ data: { success: false } })),
      get: jest.fn(() => of({ data: {} })),
    };
    const configService: any = {
      get: jest.fn((key: string, def?: string) =>
        configValues[key] !== undefined ? configValues[key] : def,
      ),
    };
    const service = new VoiceService(httpService, configService, {} as any, {} as any);
    return { service, httpService };
  }

  it('local dev (không có RAILWAY_ENVIRONMENT_NAME): dùng AI_SERVICE_URL, không cảnh báo', async () => {
    const { service, httpService } = buildService({ AI_SERVICE_URL: 'http://localhost:8001' });

    await service.generateTTS('xin chào', 'voice_1');

    expect(httpService.post).toHaveBeenCalledWith(
      'http://localhost:8001/api/voice/tts/',
      expect.anything(),
      expect.anything(),
    );
    expect(warnSpy.mock.calls.flat().join(' ')).not.toContain('AI_SERVICE_VOICE_RAILWAY_URL');
  });

  it('trên Railway: generateTTS đi qua URL private network đã khai', async () => {
    const { service, httpService } = buildService({
      AI_SERVICE_URL: URL_TUNNEL,
      RAILWAY_ENVIRONMENT_NAME: 'production',
      AI_SERVICE_VOICE_RAILWAY_URL: URL_RAILWAY,
    });

    await service.generateTTS('xin chào', 'voice_1');

    expect(httpService.post).toHaveBeenCalledWith(
      `${URL_RAILWAY}/api/voice/tts/`,
      expect.anything(),
      expect.anything(),
    );
  });

  it('trên Railway: listVoices cũng đi qua URL đó — mọi endpoint voice cùng một đường', async () => {
    const { service, httpService } = buildService({
      AI_SERVICE_URL: URL_TUNNEL,
      RAILWAY_ENVIRONMENT_NAME: 'production',
      AI_SERVICE_VOICE_RAILWAY_URL: URL_RAILWAY,
    });

    await service.listVoices();

    expect(httpService.get).toHaveBeenCalledWith(`${URL_RAILWAY}/api/voice/list/`);
  });

  it('AI_SERVICE_URL_VOICE thắng tất cả, kể cả trên Railway', async () => {
    const { service, httpService } = buildService({
      AI_SERVICE_URL: URL_TUNNEL,
      RAILWAY_ENVIRONMENT_NAME: 'production',
      AI_SERVICE_VOICE_RAILWAY_URL: URL_RAILWAY,
      AI_SERVICE_URL_VOICE: URL_OVERRIDE,
    });

    await service.generateTTS('xin chào', 'voice_1');

    expect(httpService.post).toHaveBeenCalledWith(
      `${URL_OVERRIDE}/api/voice/tts/`,
      expect.anything(),
      expect.anything(),
    );
  });

  it('trên Railway mà CHƯA khai biến: KHÔNG còn hostname/cổng nào gõ cứng — lùi về AI_SERVICE_URL', async () => {
    const { service, httpService } = buildService({
      AI_SERVICE_URL: URL_TUNNEL,
      RAILWAY_ENVIRONMENT_NAME: 'production',
    });

    await service.listVoices();

    const url = httpService.get.mock.calls[0][0] as string;
    expect(url).toBe(`${URL_TUNNEL}/api/voice/list/`);
    expect(url).not.toContain('railway.internal');
    expect(url).not.toContain('8080');
  });

  it('lùi về như vậy thì phải cảnh báo rõ trong log, không được im lặng', async () => {
    buildService({
      AI_SERVICE_URL: URL_TUNNEL,
      RAILWAY_ENVIRONMENT_NAME: 'production',
    });

    expect(warnSpy.mock.calls.flat().join(' ')).toContain('AI_SERVICE_VOICE_RAILWAY_URL');
  });
});
