import { OwnedScriptService } from '../owned-script.service';

const USER_ID = 'u1';

process.env.AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai.test:8001';

function buildService(over: { prisma?: any; paast?: any } = {}) {
  const prisma: any = {
    ownedVideoScript: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
      update: jest.fn(async () => ({})),
      create: jest.fn(async () => ({})),
    },
    paastAnalysisHistory: { findUnique: jest.fn(async () => null) },
    ...over.prisma,
  };
  const paast: any = {
    analyzeContentV2: jest.fn(async () => ({ id: 'p1', status: 'SUCCESS' })),
    ...over.paast,
  };
  const service = new OwnedScriptService(prisma, { sign: () => 'jwt' } as any, paast);
  return { service, prisma, paast };
}

function stubScript(service: OwnedScriptService, script: any) {
  (service as any).fetchScript = jest.fn(async () => script);
}

const sampleScript = (p: any = {}) => ({
  id: 'ks1',
  nguon: 'phu_de',
  noi_dung: 'a'.repeat(500),
  so_ky_tu: 500,
  ngon_ngu: 'vi_VN',
  paast_analysis_id: null,
  ...p,
});

describe('statusMany — bulk script status for video grid', () => {
  it('returns empty object and does not query DB when keys array is empty', async () => {
    const { service, prisma } = buildService();
    await expect(service.statusMany([])).resolves.toEqual({});
    expect(prisma.ownedVideoScript.findMany).not.toHaveBeenCalled();
  });

  it('excludes khong_co marker records in the query', async () => {
    const { service, prisma } = buildService();
    await service.statusMany([{ platform: 'facebook', post_id: 'p1' }]);

    expect(prisma.ownedVideoScript.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ nguon: { not: 'khong_co' } }),
      }),
    );
  });

  it('returns da_cham with verdict passed/failed when scoring succeeded', async () => {
    const { service } = buildService({
      prisma: {
        ownedVideoScript: {
          findMany: async () => [
            {
              platform: 'facebook',
              post_id: 'p1',
              so_ky_tu: 800,
              nguon: 'phu_de',
              paast_analysis_id: 'a1',
              paast_analysis: { status: 'SUCCESS', analysis_result: { verdict: { passed: true } } },
            },
          ],
        },
      },
    });

    await expect(service.statusMany([{ platform: 'facebook', post_id: 'p1' }])).resolves.toEqual(
      {
        'facebook:p1': {
          statusCode: 'da_cham',
          passed: true,
          charCount: 800,
          trang_thai: 'da_cham',
          dat: true,
          so_ky_tu: 800,
        },
      },
    );
  });

  it('returns passed = null if verdict cannot be read without assuming false', async () => {
    const { service } = buildService({
      prisma: {
        ownedVideoScript: {
          findMany: async () => [
            {
              platform: 'facebook',
              post_id: 'p1',
              so_ky_tu: 800,
              nguon: 'phu_de',
              paast_analysis_id: 'a1',
              paast_analysis: { status: 'SUCCESS', analysis_result: {} },
            },
          ],
        },
      },
    });

    const res = await service.statusMany([{ platform: 'facebook', post_id: 'p1' }]);
    expect(res['facebook:p1'].passed).toBeNull();
  });

  it.each([
    [99, 'qua_ngan'],
    [100, 'co_kich_ban'],
  ])('%s characters, unscored → %s', async (charCount, expectedStatus) => {
    const { service } = buildService({
      prisma: {
        ownedVideoScript: {
          findMany: async () => [
            {
              platform: 'facebook',
              post_id: 'p1',
              so_ky_tu: charCount,
              nguon: 'phu_de',
              paast_analysis_id: null,
              paast_analysis: null,
            },
          ],
        },
      },
    });

    const res = await service.statusMany([{ platform: 'facebook', post_id: 'p1' }]);
    expect(res['facebook:p1']).toMatchObject({
      statusCode: expectedStatus,
      passed: null,
      charCount,
      trang_thai: expectedStatus,
      dat: null,
      so_ky_tu: charCount,
    });
  });
});

describe('scoreVideo — guards before LLM invocation', () => {
  it('returns chua_co_kich_ban without invoking LLM when no Facebook script found', async () => {
    const { service, paast } = buildService();
    stubScript(service, null);

    const res = await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(res.statusCode).toBe('chua_co_kich_ban');
    expect(paast.analyzeContentV2).not.toHaveBeenCalled();
  });

  it.each(['tiktok', 'instagram', 'youtube'])(
    'returns khong_ho_tro for unsupported platform %s',
    async (platform) => {
      const { service, paast } = buildService();
      stubScript(service, null);

      const res = await service.scoreVideo(platform, 'p1', USER_ID);
      expect(res.statusCode).toBe('khong_ho_tro');
      expect(res.note).toContain(platform);
      expect(paast.analyzeContentV2).not.toHaveBeenCalled();
    },
  );

  it('returns qua_ngan without calling LLM for scripts with 99 chars', async () => {
    const { service, paast } = buildService();
    stubScript(service, sampleScript({ noi_dung: 'a'.repeat(99), so_ky_tu: 99 }));

    const res = await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(res.statusCode).toBe('qua_ngan');
    expect(res.note).toContain('99 characters');
    expect(paast.analyzeContentV2).not.toHaveBeenCalled();
  });

  it.each(['th', 'en', 'zh', 'ko'])('returns khong_ho_tro for non-Vietnamese language "%s"', async (lang) => {
    const { service, paast } = buildService();
    stubScript(service, sampleScript({ ngon_ngu: lang }));

    const res = await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(res.statusCode).toBe('khong_ho_tro');
    expect(paast.analyzeContentV2).not.toHaveBeenCalled();
  });

  it.each(['vi', 'vi_VN', 'VI', ''])('scores Vietnamese script language "%s"', async (lang) => {
    const { service, paast } = buildService();
    stubScript(service, sampleScript({ ngon_ngu: lang }));

    const res = await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(res.statusCode).toBe('da_cham');
    expect(paast.analyzeContentV2).toHaveBeenCalledTimes(1);
  });

  it('reuses existing SUCCESS analysis result without re-invoking LLM', async () => {
    const existing = { id: 'a1', status: 'SUCCESS' };
    const { service, paast } = buildService({
      prisma: { paastAnalysisHistory: { findUnique: async () => existing } },
    });
    stubScript(service, sampleScript({ paast_analysis_id: 'a1' }));

    const res = await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(res).toMatchObject({ statusCode: 'da_cham', analysis: existing });
    expect(paast.analyzeContentV2).not.toHaveBeenCalled();
  });

  it('re-evaluates if previous analysis status was FAILED', async () => {
    const { service, paast } = buildService({
      prisma: { paastAnalysisHistory: { findUnique: async () => ({ id: 'a1', status: 'FAILED' }) } },
    });
    stubScript(service, sampleScript({ paast_analysis_id: 'a1' }));

    await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(paast.analyzeContentV2).toHaveBeenCalledTimes(1);
  });

  it('attaches fresh analysis ID to script record upon completion', async () => {
    const { service, prisma } = buildService();
    stubScript(service, sampleScript({ id: 'ks9' }));

    await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(prisma.ownedVideoScript.update).toHaveBeenCalledWith({
      where: { id: 'ks9' },
      data: { paast_analysis_id: 'p1' },
    });
  });

  it('keeps co_kich_ban status when LLM returns failure', async () => {
    const { service } = buildService({
      paast: {
        analyzeContentV2: async () => ({ status: 'FAILED', error_message: 'DeepSeek overloaded' }),
      },
    });
    stubScript(service, sampleScript());

    const res = await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(res).toMatchObject({ statusCode: 'co_kich_ban', note: 'DeepSeek overloaded' });
  });
});

describe('scoreVideo — truncates scripts longer than 3,000 characters', () => {
  const longContent = (n: number) => 'This sentence is long enough to have a period. '.repeat(n);

  it('truncates at the nearest sentence boundary', async () => {
    const { service, paast } = buildService();
    const content = longContent(200);
    stubScript(service, sampleScript({ noi_dung: content, so_ky_tu: content.length }));

    await service.scoreVideo('facebook', 'p1', USER_ID);

    const sent = paast.analyzeContentV2.mock.calls[0][1];
    expect(sent.length).toBeLessThanOrEqual(3000);
    expect(sent.endsWith('.')).toBe(true);
  });

  it('notes truncation in result note', async () => {
    const { service } = buildService();
    const content = longContent(200);
    stubScript(service, sampleScript({ noi_dung: content, so_ky_tu: content.length }));

    const res = await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(res.note).toContain(`Script length is ${content.length} characters`);
    expect(res.charCount).toBe(content.length);
  });

  it('hard truncates at 3,000 characters if no punctuation boundary found', async () => {
    const { service, paast } = buildService();
    const content = 'a'.repeat(5000);
    stubScript(service, sampleScript({ noi_dung: content, so_ky_tu: 5000 }));

    await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(paast.analyzeContentV2.mock.calls[0][1]).toHaveLength(3000);
  });

  it('sends exactly 3,000 characters unchanged without truncation note', async () => {
    const { service, paast } = buildService();
    const content = 'a'.repeat(3000);
    stubScript(service, sampleScript({ noi_dung: content, so_ky_tu: 3000 }));

    const res = await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(paast.analyzeContentV2.mock.calls[0][1]).toBe(content);
    expect(res.note).toBeUndefined();
  });
});
