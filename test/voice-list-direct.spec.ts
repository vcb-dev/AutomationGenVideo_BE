import { of } from 'rxjs';
import { AiIntegrationService } from '../src/modules/ai-integration/ai-integration.service';

describe('Voice List Direct DB & Fallback (listVoices)', () => {
  function buildService(prismaMock?: any, httpGetMock?: any) {
    const httpService: any = {
      get: httpGetMock || jest.fn(() => of({ data: { success: true, voices: [] } })),
      post: jest.fn(() => of({ data: { success: true } })),
    };
    const configService: any = {
      get: jest.fn((key: string, def?: string) => {
        if (key === 'MINIMAX_VND_PER_1K_CHARS') return '2600';
        if (key === 'MINIMAX_VND_PER_CLONE') return '38000';
        if (key === 'AI_SERVICE_URL') return 'http://localhost:8000';
        return def;
      }),
    };
    const jwtService: any = { sign: jest.fn(() => 'token') };
    const driveStorage: any = {};
    const usersService: any = {};
    const voiceQuotaService: any = {
      getQuota: jest.fn(async () => ({ daily_limit: 8, used: 2, remaining: 6 })),
    };

    const service = new AiIntegrationService(
      httpService,
      configService,
      jwtService,
      prismaMock || {},
      driveStorage,
      usersService,
      voiceQuotaService,
    );
    return { service, httpService, voiceQuotaService };
  }

  it('lấy danh sách giọng trực tiếp từ Prisma DB mà không cần gọi HTTP sang AI Service', async () => {
    const fakeVoices = [
      {
        id: BigInt(1),
        voice_id: 'HuyK_8a4ca57b',
        name: 'HuyK Giọng Ấm',
        language: 'vi',
        gender: 'male',
        provider: 'minimax',
        is_cloned: true,
        is_system: false,
        sample_audio_url: 'https://example.com/audio1.mp3',
      },
      {
        id: BigInt(2),
        voice_id: 'moss_audio_123',
        name: 'Giọng Nữ Chuẩn',
        language: 'vi',
        gender: 'female',
        provider: 'minimax',
        is_cloned: false,
        is_system: true,
        sample_audio_url: null,
      },
    ];

    const prismaMock = {
      voice: {
        findMany: jest.fn().mockResolvedValue(fakeVoices),
      },
    };

    const { service, httpService, voiceQuotaService } = buildService(prismaMock);

    const result = await service.listVoices('user-uuid-123');

    // Không gọi sang AI Service
    expect(httpService.get).not.toHaveBeenCalled();
    expect(prismaMock.voice.findMany).toHaveBeenCalledWith({ orderBy: { id: 'asc' } });
    expect(voiceQuotaService.getQuota).toHaveBeenCalledWith('user-uuid-123');

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.voices).toEqual([
      {
        id: 1, // Chuyển từ BigInt sang Number an toàn
        voice_id: 'HuyK_8a4ca57b',
        name: 'HuyK Giọng Ấm',
        language: 'vi',
        gender: 'male',
        provider: 'minimax',
        is_cloned: true,
        is_system: false,
        sample_audio_url: 'https://example.com/audio1.mp3',
      },
      {
        id: 2,
        voice_id: 'moss_audio_123',
        name: 'Giọng Nữ Chuẩn',
        language: 'vi',
        gender: 'female',
        provider: 'minimax',
        is_cloned: false,
        is_system: true,
        sample_audio_url: null,
      },
    ]);
    expect(result.pricing).toEqual({
      vnd_per_1k_chars: 2600,
      vnd_per_clone: 38000,
    });
    expect(result.quota).toEqual({
      daily_limit: 8,
      used: 2,
      remaining: 6,
    });
  });

  it('tự động fallback gọi sang AI Service khi Prisma gặp lỗi hoặc không khả dụng', async () => {
    const prismaMock = {
      voice: {
        findMany: jest.fn().mockRejectedValue(new Error('DB connection pool timeout')),
      },
    };

    const fallbackVoices = [
      {
        id: 10,
        voice_id: 'v_fallback',
        name: 'Giọng Fallback',
        language: 'vi',
        gender: 'female',
        provider: 'minimax',
        is_cloned: true,
        is_system: false,
      },
    ];

    const httpGetMock = jest.fn(() =>
      of({
        data: {
          success: true,
          voices: fallbackVoices,
        },
      }),
    );

    const { service, httpService } = buildService(prismaMock, httpGetMock);

    const result = await service.listVoices('user-uuid-456');

    // Phải gọi fallback sang AI Service
    expect(httpService.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/voice/list/'),
    );
    expect(result.success).toBe(true);
    expect(result.voices).toEqual(fallbackVoices);
  });
});
