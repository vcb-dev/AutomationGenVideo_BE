import { of, throwError } from 'rxjs';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { TransformStatus } from '@prisma/client';
import { AiIntegrationService } from '../ai-integration.service';

/**
 * Chức năng: PR2 — BE tạo job upgrade nền + poll-kèm-ghi-DB.
 * AiIntegrationService#startUpgradeJob + #pollContentTransformJob (+ finalizeUpgradeJob).
 *
 * Khoá:
 *  1. pollContentTransformJob: running → chỉ chuyển trạng thái, KHÔNG ghi DB.
 *  2. transcribe completed → trả result.transcript, không đụng DB (không có bản ghi).
 *  3. upgrade completed → ghi 1 lần vào placeholder (guard status=PENDING); poll lần 2 (count 0)
 *     KHÔNG cộng chi phí lần nữa, vẫn trả bản ghi hoàn tất.
 *  4. upgrade error → placeholder → FAILED.
 *  5. startUpgradeJob: thiếu history_id / chưa chấm điểm → 4xx; bấm trùng → 409;
 *     AI /start lỗi → placeholder thành FAILED rồi ném.
 */
describe('AiIntegrationService — content-transform upgrade job (PR2)', () => {
  function buildService(overrides: { prisma?: any } = {}) {
    const httpService: any = { get: jest.fn(() => of({ data: {} })), post: jest.fn(() => of({ data: {} })) };
    const configService: any = {
      get: jest.fn((key: string, def?: string) => (key === 'AI_SERVICE_URL' ? 'http://ai.test:8001' : def)),
    };
    const jwtService: any = { sign: jest.fn(() => 'jwt') };
    const prisma: any = {
      contentTransformHistory: {
        create: jest.fn(async (a: any) => ({ id: 'ph-1', ...a.data })),
        update: jest.fn(async (a: any) => ({ id: a.where.id, ...a.data })),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => ({ id: 'ph-1', score_result: { total_score: 90, layers: { prefer: {} } }, character: {} })),
      },
      paastAnalysisHistory: { findFirst: jest.fn(async () => null) },
      ...overrides.prisma,
    };
    const service = new AiIntegrationService(httpService, configService, jwtService, prisma, {} as any, {} as any);
    return { service, httpService, prisma };
  }

  // ── pollContentTransformJob ────────────────────────────────────────────────

  it('running → { status: running }, không ghi DB', async () => {
    const { service, httpService, prisma } = buildService();
    httpService.get.mockReturnValueOnce(of({ data: { status: 'running', kind: 'upgrade', message: 'Đang nâng cấp...' } }));

    const res = await service.pollContentTransformJob('job-1', 'u1', []);

    expect(res).toMatchObject({ status: 'running', message: 'Đang nâng cấp...' });
    expect(prisma.contentTransformHistory.updateMany).not.toHaveBeenCalled();
  });

  it('transcribe completed → trả result.transcript, không đụng DB', async () => {
    const { service, httpService, prisma } = buildService();
    httpService.get.mockReturnValueOnce(
      of({ data: { status: 'completed', kind: 'transcribe', result: { transcript: 'xin chào', char_count: 8 } } }),
    );

    const res = await service.pollContentTransformJob('job-1', 'u1', []);

    expect(res).toMatchObject({ status: 'completed', result: { transcript: 'xin chào' } });
    expect(prisma.contentTransformHistory.findFirst).not.toHaveBeenCalled();
  });

  it('upgrade completed → ghi placeholder PENDING→SUCCESS 1 lần, trả { previous, upgraded }', async () => {
    const findFirst = jest.fn(async () => ({ id: 'ph-1', user_id: 'u1', ai_job_id: 'job-u', character: {} }));
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const findUnique = jest.fn(async () => ({ id: 'ph-1', output_text: 'kịch bản mới', score_result: { total_score: 88 }, character: {} }));
    const { service, httpService } = buildService({
      prisma: { contentTransformHistory: { findFirst, updateMany, findUnique, create: jest.fn(), update: jest.fn() } },
    });
    jest.spyOn(service, 'getContentTransformHistoryDetail').mockResolvedValue({
      output_text: 'kịch bản cũ', scoreResult: { total_score: 70 },
    } as any);
    httpService.get.mockReturnValueOnce(
      of({
        data: {
          status: 'completed', kind: 'upgrade',
          client_context: { source_history_id: 'src-1' },
          result: { output_text: 'kịch bản mới', score: { total_score: 88, layers: { prefer: {} } }, score_error: null, usage: { prompt_tokens: 5, completion_tokens: 7 }, model_used: 'deepseek' },
        },
      }),
    );

    const res: any = await service.pollContentTransformJob('job-u', 'u1', []);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ph-1', status: TransformStatus.PENDING },
        data: expect.objectContaining({ status: TransformStatus.SUCCESS, output_text: 'kịch bản mới' }),
      }),
    );
    expect(res.status).toBe('completed');
    expect(res.previous).toEqual({ output_text: 'kịch bản cũ', scoreResult: { total_score: 70 } });
    expect(res.upgraded.scoreStatus).toBe('success');
  });

  it('upgrade completed poll LẦN 2 (updateMany count 0) → không lỗi, trả bản ghi hoàn tất', async () => {
    const findFirst = jest.fn(async () => ({ id: 'ph-1', user_id: 'u1', ai_job_id: 'job-u', character: {} }));
    const updateMany = jest.fn(async () => ({ count: 0 })); // đã có lời gọi trước ghi rồi
    const findUnique = jest.fn(async () => ({ id: 'ph-1', output_text: 'kịch bản mới', score_result: { total_score: 88 }, character: {} }));
    const { service, httpService } = buildService({
      prisma: { contentTransformHistory: { findFirst, updateMany, findUnique, create: jest.fn(), update: jest.fn() } },
    });
    jest.spyOn(service, 'getContentTransformHistoryDetail').mockResolvedValue({ output_text: 'cũ', scoreResult: null } as any);
    httpService.get.mockReturnValueOnce(
      of({ data: { status: 'completed', kind: 'upgrade', client_context: {}, result: { output_text: 'kịch bản mới', score: null, score_error: null, usage: {}, model_used: 'x' } } }),
    );

    const res: any = await service.pollContentTransformJob('job-u', 'u1', []);

    expect(res.status).toBe('completed');
    expect(res.upgraded.id).toBe('ph-1');
  });

  it('upgrade error → placeholder → FAILED, trả { status: error }', async () => {
    const findFirst = jest.fn(async () => ({ id: 'ph-1', user_id: 'u1', character: {} }));
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const { service, httpService } = buildService({
      prisma: { contentTransformHistory: { findFirst, updateMany, create: jest.fn(), update: jest.fn(), findUnique: jest.fn() } },
    });
    httpService.get.mockReturnValueOnce(
      of({ data: { status: 'error', kind: 'upgrade', message: 'DeepSeek từ chối yêu cầu' } }),
    );

    const res: any = await service.pollContentTransformJob('job-u', 'u1', []);

    expect(res.status).toBe('error');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: TransformStatus.FAILED }) }),
    );
  });

  it('not_found → { status: not_found }', async () => {
    const { service, httpService } = buildService();
    httpService.get.mockReturnValueOnce(throwError(() => ({ response: { status: 404 } })));

    expect(await service.pollContentTransformJob('job-x', 'u1', [])).toEqual({ status: 'not_found' });
  });

  // ── startUpgradeJob ───────────────────────────────────────────────────────

  it('thiếu history_id → BadRequest', async () => {
    const { service } = buildService();
    await expect(service.startUpgradeJob('u1', [], {} as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bản ghi nguồn chưa được chấm điểm → BadRequest', async () => {
    const { service } = buildService();
    jest.spyOn(service, 'getContentTransformHistoryDetail').mockResolvedValue({
      output_text: 'có kịch bản', scoreResult: null, character_id: 'c1', input_text: 'x', user_id: 'u1', input_type: 'TEXT',
    } as any);

    await expect(service.startUpgradeJob('u1', [], { history_id: 'h1' } as any)).rejects.toThrow(/chưa được chấm điểm/);
  });

  it('bấm trùng cùng history_id → Conflict', async () => {
    const { service } = buildService();
    (service as any).contentTransformProcessingUpgrades.add('h1');

    await expect(service.startUpgradeJob('u1', [], { history_id: 'h1' } as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('happy: tạo placeholder PENDING, POST AI, gắn ai_job_id, trả { history_id, job_id }', async () => {
    const create = jest.fn(async (a: any) => ({ id: 'ph-1', ...a.data }));
    const update = jest.fn(async () => ({}));
    const { service, httpService } = buildService({
      prisma: { contentTransformHistory: { create, update, updateMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() } },
    });
    jest.spyOn(service, 'getContentTransformHistoryDetail').mockResolvedValue({
      output_text: 'kịch bản', scoreResult: { total_score: 70, layers: { prefer: {}, action: {}, acknowledge: {}, stick: {}, trust: {} } },
      character_id: 'c1', input_text: 'thô', user_id: 'u1', input_type: 'TEXT',
    } as any);
    jest.spyOn(service as any, 'fetchContentTransformCharacterViaApi').mockResolvedValue({ id: 'c1', name: 'A', slug: 'a', system_prompt: 'sys' });
    httpService.post.mockReturnValueOnce(of({ data: { success: true, job_id: 'job-new' } }));

    const res = await service.startUpgradeJob('u1', [], { history_id: 'h1' } as any);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: TransformStatus.PENDING, ai_job_kind: 'upgrade' }) }),
    );
    expect(update).toHaveBeenCalledWith({ where: { id: 'ph-1' }, data: { ai_job_id: 'job-new' } });
    expect(res).toEqual({ history_id: 'ph-1', job_id: 'job-new' });
    // lock đã nhả
    expect((service as any).contentTransformProcessingUpgrades.has('h1')).toBe(false);
  });

  it('AI /start lỗi → placeholder → FAILED rồi ném', async () => {
    const create = jest.fn(async (a: any) => ({ id: 'ph-1', ...a.data }));
    const update = jest.fn(async () => ({}));
    const { service, httpService } = buildService({
      prisma: { contentTransformHistory: { create, update, updateMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() } },
    });
    jest.spyOn(service, 'getContentTransformHistoryDetail').mockResolvedValue({
      output_text: 'kịch bản', scoreResult: { total_score: 70, layers: { prefer: {}, action: {}, acknowledge: {}, stick: {}, trust: {} } },
      character_id: 'c1', input_text: 'thô', user_id: 'u1', input_type: 'TEXT',
    } as any);
    jest.spyOn(service as any, 'fetchContentTransformCharacterViaApi').mockResolvedValue({ id: 'c1', name: 'A', slug: 'a', system_prompt: 'sys' });
    httpService.post.mockReturnValueOnce(throwError(() => ({ response: { status: 502, data: { error: 'AI service sập' } } })));

    await expect(service.startUpgradeJob('u1', [], { history_id: 'h1' } as any)).rejects.toThrow();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ph-1' }, data: expect.objectContaining({ status: TransformStatus.FAILED }) }),
    );
  });
});
