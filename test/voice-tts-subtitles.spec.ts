import { of } from 'rxjs';
import { AiIntegrationService } from '../src/modules/ai-integration/ai-integration.service';

describe('Voice TTS Subtitles (SRT) Integration', () => {
  function buildService(aiResponseData: any = {}) {
    const axiosRef = {
      get: jest.fn().mockResolvedValue({
        status: 200,
        headers: {
          'content-type': 'application/x-subrip; charset=utf-8',
          'content-length': '150',
        },
        data: {
          on: jest.fn(),
          pipe: jest.fn(),
        },
      }),
    };

    const httpService: any = {
      post: jest.fn(() => of({ data: { success: true, ...aiResponseData } })),
      get: jest.fn(() => of({ data: [] })),
      axiosRef,
    };

    const configService: any = {
      get: jest.fn((key: string, def?: string) => {
        if (key === 'AI_SERVICE_URL') return 'http://localhost:8001';
        return def;
      }),
    };

    const prisma: any = {
      aiVoiceUsage: {
        create: jest.fn().mockResolvedValue({}),
      },
      voiceActionHistory: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const jwtService: any = { sign: jest.fn(() => 'fake.jwt.token') };
    const driveStorage: any = {
      resolveDatedFolder: jest.fn().mockResolvedValue('folder-123'),
      uploadFromUrl: jest.fn().mockResolvedValue(null),
    };
    const voiceQuotaService: any = {
      checkAndConsumeQuota: jest.fn().mockResolvedValue({ remaining: 7 }),
      refundQuota: jest.fn().mockResolvedValue({ remaining: 8 }),
    };

    const service = new AiIntegrationService(
      httpService,
      configService,
      jwtService,
      prisma,
      driveStorage,
      {} as any,
      voiceQuotaService,
    );

    return { service, httpService, prisma, axiosRef };
  }

  it('generateTTS forwards srt_content, srt_filename, and srt_url when AI returns subtitle', async () => {
    const mockSrt = '1\n00:00:00,000 --> 00:00:01,500\nXin chào\n';
    const srtFilename = 'tts_0123456789abcdef0123456789abcdef.srt';

    const { service } = buildService({
      audio_url: 'http://localhost:8001/media/minimax_tts/tts_0123456789abcdef0123456789abcdef.mp3',
      srt_content: mockSrt,
      srt_filename: srtFilename,
    });

    const result = await service.generateTTS('Xin chào', 'voice_123', 1.0, 0, 100, 'vi', 'user_uuid_1');

    expect(result.success).toBe(true);
    expect(result.srt_content).toBe(mockSrt);
    expect(result.srt_file_name).toBe(srtFilename);
    expect(result.srt_url).toContain(`/api/voice/tts/file/${srtFilename}`);
  });

  it('generateTTS works safely even when AI does not return subtitle', async () => {
    const { service } = buildService({
      audio_url: 'http://localhost:8001/media/minimax_tts/tts_0123456789abcdef0123456789abcdef.mp3',
    });

    const result = await service.generateTTS('Xin chào', 'voice_123');

    expect(result.success).toBe(true);
    expect(result.srt_content).toBeUndefined();
    expect(result.srt_file_name).toBeUndefined();
  });

  it('streamTtsAudioFromAi rejects invalid filenames and allows valid .srt and .mp3', async () => {
    const { service } = buildService();
    const res: any = {
      status: jest.fn(),
      setHeader: jest.fn(),
    };

    // Tên file không hợp lệ
    await expect(service.streamTtsAudioFromAi('hack.srt', res)).rejects.toThrow('Invalid TTS filename');
    await expect(service.streamTtsAudioFromAi('tts_123.wav', res)).rejects.toThrow('Invalid TTS filename');

    // Tên file .srt hợp lệ
    const validSrt = 'tts_0123456789abcdef0123456789abcdef.srt';
    await expect(service.streamTtsAudioFromAi(validSrt, res, true, 'Custom_Title')).resolves.not.toThrow();

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', expect.stringContaining('application/x-subrip'));
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('Custom_Title.srt'),
    );
  });
});
