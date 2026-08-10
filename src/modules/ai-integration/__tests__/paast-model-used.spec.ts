import { of } from 'rxjs';
import { AiIntegrationService } from '../ai-integration.service';

/**
 * Chức năng: ghi đúng tên model đã dùng vào cột model_used của paast_analysis_history.
 *
 * Cột này gõ cứng 'deepseek-chat' ở BE, trong khi model do AI service chọn — PAAST
 * gọi _call_deepseek_raw/_checked mà KHÔNG truyền model nên nhận mặc định
 * 'deepseek-v4-flash'. Tức là mọi dòng lịch sử đang ghi sai tên model. Cột này
 * sinh ra để về sau còn truy "điểm tụt là do đổi model hay do đổi prompt"; ghi sai
 * thì nó tệ hơn cả bỏ trống, vì trông vẫn như một dữ kiện đáng tin.
 */
describe('AiIntegrationService — model_used của PAAST', () => {
  function buildService(aiResponse: any) {
    const httpService: any = { post: jest.fn(() => of({ data: aiResponse })) };
    const configService: any = { get: jest.fn((_k: string, d?: string) => d) };
    const updated: any[] = [];
    const prisma: any = {
      paastAnalysisHistory: {
        create: jest.fn(async () => ({ id: 'h1' })),
        update: jest.fn(async (args: any) => { updated.push(args); return args; }),
      },
    };
    const service = new AiIntegrationService(
      httpService, configService, { sign: jest.fn() } as any, prisma,
    );
    return { service, updated };
  }

  const ketQuaAi = {
    layers: [], total_score: 80, verdict: 'ok', cta_warning: null,
  };

  it('lấy tên model từ response của AI service, không tự bịa', async () => {
    const { service, updated } = buildService({ ...ketQuaAi, model_used: 'deepseek-v4-flash' });

    await service.analyzeContent('u1', { content: 'abc' } as any);

    expect(updated[0].data.model_used).toBe('deepseek-v4-flash');
  });

  it('AI đổi sang model khác thì cột cũng đổi theo', async () => {
    const { service, updated } = buildService({ ...ketQuaAi, model_used: 'deepseek-r2' });

    await service.analyzeContent('u1', { content: 'abc' } as any);

    expect(updated[0].data.model_used).toBe('deepseek-r2');
  });

  it('AI chưa deploy bản trả model_used → ghi null chứ KHÔNG ghi tên đoán mò', async () => {
    const { service, updated } = buildService(ketQuaAi);

    await service.analyzeContent('u1', { content: 'abc' } as any);

    expect(updated[0].data.model_used).toBeNull();
  });
});
