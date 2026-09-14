import { of } from 'rxjs';
import { AiIntegrationService } from '../ai-integration.service';

describe('AiIntegrationService - Voice Action History', () => {
  function buildService(prismaMocks: Record<string, any> = {}) {
    const configValues: Record<string, string> = {
      AI_SERVICE_URL: 'http://ai.test:8001',
      AI_SERVICE_URL_VOICE: 'https://voice-ai.example.com',
    };
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
    const prisma: any = {
      voiceActionHistory: {
        create: jest.fn(async (args) => ({ id: 'h1', ...args.data })),
        count: jest.fn(async () => 1),
        findMany: jest.fn(async () => [
          {
            id: 'h1',
            user_id: 'u1',
            action_type: 'TTS',
            status: 'SUCCESS',
            voice_id: 'voice_123',
            input_text: 'Xin chào test',
            output_url: 'http://drive/file1.mp3',
            characters: 12,
            duration_ms: 1500,
            details: { language: 'Vietnamese' },
            created_at: new Date('2026-09-09T08:00:00Z'),
            user: {
              id: 'u1',
              full_name: 'Admin User',
              email: 'admin@vcbi.vn',
              team: 'Tech',
            },
          },
        ]),
        ...prismaMocks,
      },
    };

    const service = new AiIntegrationService(
      httpService,
      configService,
      { sign: jest.fn(() => 'token') } as any,
      prisma,
      {} as any,
      {} as any,
    );
    return { service, prisma };
  }

  describe('logVoiceAction', () => {
    it('ghi lại log thao tác TTS thành công vào Prisma', async () => {
      const { service, prisma } = buildService();

      await service.logVoiceAction({
        user_id: 'u1',
        action_type: 'TTS',
        status: 'SUCCESS',
        voice_id: 'v1',
        input_text: 'Xin chào',
        characters: 8,
      });

      expect(prisma.voiceActionHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          user_id: 'u1',
          action_type: 'TTS',
          status: 'SUCCESS',
          voice_id: 'v1',
          input_text: 'Xin chào',
          characters: 8,
        }),
      });
    });

    it('không ném lỗi làm crash hệ thống nếu Prisma create bị lỗi', async () => {
      const { service, prisma } = buildService({
        create: jest.fn().mockRejectedValue(new Error('DB connection failed')),
      });

      await expect(
        service.logVoiceAction({
          user_id: 'u1',
          action_type: 'CLONE',
          status: 'PENDING',
          voice_name: 'Test Voice',
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('getVoiceActionHistory', () => {
    it('trả về danh sách lịch sử kèm thông tin phân trang', async () => {
      const { service, prisma } = buildService();

      const result = await service.getVoiceActionHistory({
        page: 1,
        limit: 10,
        action_type: 'TTS',
        search: 'Xin chào',
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });

      expect(prisma.voiceActionHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            action_type: 'TTS',
          }),
          skip: 0,
          take: 10,
          orderBy: { created_at: 'desc' },
        }),
      );
    });

    it('áp dụng đúng bộ lọc khoảng ngày date_from và date_to', async () => {
      const { service, prisma } = buildService();

      await service.getVoiceActionHistory({
        date_from: '2026-09-01',
        date_to: '2026-09-09',
      });

      expect(prisma.voiceActionHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            created_at: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        }),
      );
    });
  });
});
