import { of } from 'rxjs';
import { AiIntegrationService } from './ai-integration.service';

describe('AiIntegrationService.getVoiceUsageStats', () => {
  function buildService(rows: any[] = []) {
    const httpService: any = {
      post: jest.fn(() => of({ data: {} })),
      get: jest.fn(() => of({ data: {} })),
      delete: jest.fn(() => of({ data: {} })),
    };
    const configService: any = {
      get: jest.fn((key: string, def?: string) => {
        if (key === 'AI_SERVICE_URL') return 'http://ai.test:8001';
        if (key === 'MINIMAX_VND_PER_1K_CHARS') return '2600';
        if (key === 'MINIMAX_VND_PER_CLONE') return '38000';
        return def;
      }),
    };
    const prisma: any = {
      aiVoiceUsage: {
        findMany: jest.fn(async () => rows),
      },
    };
    const service = new AiIntegrationService(
      httpService,
      configService,
      { sign: jest.fn(() => 'fake.jwt.token') } as any,
      prisma,
      {} as any,
      {} as any,
    );
    return { service, prisma };
  }

  it('lấy thống kê sử dụng giọng nói và gom nhóm theo user chính xác dù user không thuộc team nào', async () => {
    const mockRows = [
      {
        id: 'usage-1',
        user_id: 'user-1',
        kind: 'tts',
        characters: 500,
        created_at: new Date('2026-08-28T08:00:00Z'),
        user: {
          id: 'user-1',
          full_name: 'Nguyễn Văn A',
          email: 'a@example.com',
          team: 'Team Sản Xuất',
        },
      },
      {
        id: 'usage-2',
        user_id: 'user-1',
        kind: 'tts',
        characters: 1500,
        created_at: new Date('2026-08-28T09:00:00Z'),
        user: {
          id: 'user-1',
          full_name: 'Nguyễn Văn A',
          email: 'a@example.com',
          team: 'Team Sản Xuất',
        },
      },
      {
        id: 'usage-3',
        user_id: 'user-2',
        kind: 'clone',
        characters: 0,
        created_at: new Date('2026-08-28T09:30:00Z'),
        user: {
          id: 'user-2',
          full_name: 'Trần Thị B',
          email: 'b@example.com',
          team: null, // User không thuộc team hoặc team vừa bị xóa
        },
      },
    ];

    const { service, prisma } = buildService(mockRows);
    const result = await service.getVoiceUsageStats('2026-08-01', '2026-08-28');

    expect(prisma.aiVoiceUsage.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        created_at: expect.any(Object),
      }),
      include: {
        user: {
          select: {
            id: true,
            full_name: true,
            email: true,
            team: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    expect(result.success).toBe(true);
    expect(result.total.characters).toBe(2000);
    expect(result.total.tts_count).toBe(2);
    expect(result.total.clone_count).toBe(1);
    expect(result.by_user).toHaveLength(2);

    const user1Stats = result.by_user.find((u: any) => u.user_id === 'user-1');
    expect(user1Stats).toBeDefined();
    expect(user1Stats.team).toBe('Team Sản Xuất');
    expect(user1Stats.characters).toBe(2000);
    expect(user1Stats.tts_count).toBe(2);

    const user2Stats = result.by_user.find((u: any) => u.user_id === 'user-2');
    expect(user2Stats).toBeDefined();
    expect(user2Stats.team).toBeNull();
    expect(user2Stats.clone_count).toBe(1);
    expect(user2Stats.cost_vnd).toBe(38000);
  });
});
