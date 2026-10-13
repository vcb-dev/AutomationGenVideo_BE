import { AiIntegrationService } from '../src/modules/ai-integration/ai-integration.service';

describe('Voice History Access & Playback & Duplicate Detection', () => {
  let service: AiIntegrationService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      voiceActionHistory: {
        create: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn(),
      },
      clonedVoice: {
        findUnique: jest.fn(),
      },
      aiVoiceUsage: {
        create: jest.fn(),
      },
    };

    const httpService: any = {
      axiosRef: { get: jest.fn(), post: jest.fn() },
      get: jest.fn(),
      post: jest.fn(),
    };

    const configService: any = {
      get: jest.fn((key: string, def?: string) => {
        if (key === 'AI_SERVICE_URL') return 'http://localhost:8001';
        return def;
      }),
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

    service = new AiIntegrationService(
      httpService,
      configService,
      jwtService,
      prisma,
      driveStorage,
      null as any,
      voiceQuotaService,
    );
  });

  describe('normalizeVoiceHistoryItem', () => {
    it('chuẩn hóa link Drive fileId thành BE stream URL có download=1', () => {
      const item = {
        id: 'h1',
        user_id: 'u1',
        voice_id: 'voice_123',
        voice_name: 'Giọng Nữ Ngọt Ngào',
        details: {
          audio_file_id: '1GoogleDriveFileId999',
          srt_content: '1\n00:00:00,000 --> 00:00:01,000\nXin chào\n\n',
        },
      };

      const normalized = service.normalizeVoiceHistoryItem(item);

      expect(normalized.audio_play_url).toBe('/api/ai/voice/tts/audio/1GoogleDriveFileId999');
      expect(normalized.audio_download_url).toContain('/api/ai/voice/tts/audio/1GoogleDriveFileId999?download=1');
      expect(normalized.audio_download_url).toContain('filename=Gi%E1%BB%8Dng%20N%E1%BB%AF%20Ng%E1%BB%8Dt%20Ng%C3%A0o.mp3');
      expect(normalized.srt_content).toContain('Xin chào');
      expect(normalized.has_srt).toBe(true);
    });

    it('trích xuất Google Drive id từ output_url cũ nếu chưa có trong details', () => {
      const item = {
        id: 'h2',
        user_id: 'u1',
        voice_id: 'voice_old',
        output_url: 'https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQrStUvWxYz',
      };

      const normalized = service.normalizeVoiceHistoryItem(item);

      expect(normalized.audio_play_url).toBe('/api/ai/voice/tts/audio/1AbCdEfGhIjKlMnOpQrStUvWxYz');
      expect(normalized.audio_download_url).toContain('/api/ai/voice/tts/audio/1AbCdEfGhIjKlMnOpQrStUvWxYz?download=1');
    });

    it('chuẩn hóa link AI stream từ audio_file_name hoặc local filename', () => {
      const item = {
        id: 'h3',
        user_id: 'u1',
        voice_id: 'voice_local',
        details: {
          audio_file_name: 'tts_abcdef1234567890abcdef1234567890.mp3',
          srt_filename: 'tts_abcdef1234567890abcdef1234567890.srt',
        },
      };

      const normalized = service.normalizeVoiceHistoryItem(item);

      expect(normalized.audio_play_url).toBe('/api/ai/voice/tts/stream/tts_abcdef1234567890abcdef1234567890.mp3');
      expect(normalized.srt_download_url).toContain('/api/ai/voice/tts/stream/tts_abcdef1234567890abcdef1234567890.srt?download=1');
    });
  });

  describe('checkDuplicateVoice', () => {
    it('phát hiện kịch bản trùng lặp chính xác theo text', async () => {
      prisma.voiceActionHistory.findMany.mockResolvedValueOnce([
        {
          id: 'hist-dup-1',
          user_id: 'user_1',
          action_type: 'TTS',
          status: 'SUCCESS',
          voice_id: 'v_minimax_1',
          voice_name: 'Giọng Nam MC',
          input_text: 'Chào mừng các bạn đến với video hôm nay.',
          created_at: new Date('2026-09-18T10:00:00Z'),
          details: {
            audio_file_id: 'drive_file_123',
            srt_content: '1\n00:00:00,000 --> 00:00:02,000\nChào mừng\n\n',
          },
        },
      ]);

      const result = await service.checkDuplicateVoice('user_1', '  Chào mừng các bạn đến với video hôm nay.  ');

      expect(result.is_duplicate).toBe(true);
      expect(result.existing_item).toBeDefined();
      expect(result.existing_item.voice_name).toBe('Giọng Nam MC');
      expect(result.existing_item.audio_play_url).toBe('/api/ai/voice/tts/audio/drive_file_123');
    });

    it('trả về is_duplicate: false nếu kịch bản chưa từng tạo', async () => {
      prisma.voiceActionHistory.findMany.mockResolvedValueOnce([
        {
          id: 'hist-dup-1',
          user_id: 'user_1',
          input_text: 'Nội dung khác hoàn toàn',
          details: {},
        },
      ]);

      const result = await service.checkDuplicateVoice('user_1', 'Kịch bản mới toanh chưa từng có');

      expect(result.is_duplicate).toBe(false);
      expect(result.existing_item).toBeUndefined();
    });
  });
});
