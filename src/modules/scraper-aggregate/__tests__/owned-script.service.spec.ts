import { OwnedScriptService } from '../owned-script.service';

/**
 * Kịch bản + điểm PAAST cho video kênh nội bộ.
 *
 * Trọng tâm là mấy chốt chặn TRƯỚC khi gọi LLM: kịch bản quá ngắn, kịch bản không phải tiếng
 * Việt, và bản chấm cũ đã có. Mỗi lần lọt qua là 6 lượt gọi DeepSeek — chốt hỏng thì tốn tiền
 * thật chứ không phải chỉ sai kết quả.
 *
 * Không test getFacebookSubtitles/getFacebookDialogue: chúng chỉ là lớp gọi HTTP sang AI service,
 * mock lại chỉ chứng minh mock đúng. Ở đây thay thẳng fetchScript để tập trung vào phần quyết định.
 */

const USER_ID = 'u1';

// AI_SERVICE_URL không còn giá trị mặc định trong mã nguồn (xem common/config/ai-service-url):
// service đọc lúc khởi tạo property nên phải đặt trước khi dựng instance.
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

/** Thay fetchScript (private) để test đi thẳng vào phần quyết định. */
function stubScript(service: OwnedScriptService, script: any) {
  (service as any).fetchScript = jest.fn(async () => script);
}

const script = (p: any = {}) => ({
  id: 'ks1',
  nguon: 'phu_de',
  noi_dung: 'a'.repeat(500),
  so_ky_tu: 500,
  ngon_ngu: 'vi_VN',
  paast_analysis_id: null,
  ...p,
});

describe('statusMany — trạng thái kịch bản của cả lưới video', () => {
  it('không có khoá nào thì trả rỗng, KHÔNG hỏi DB', async () => {
    const { service, prisma } = buildService();
    await expect(service.statusMany([])).resolves.toEqual({});
    expect(prisma.ownedVideoScript.findMany).not.toHaveBeenCalled();
  });

  /*
   * Bản ghi `khong_co` là DẤU "đã thử mà không ra", không phải kịch bản. Lọt vào kết quả thì
   * thẻ video hiện "có kịch bản" trong khi bấm vào chẳng có gì.
   */
  it('loại bản ghi đánh dấu khong_co ngay trong câu truy vấn', async () => {
    const { service, prisma } = buildService();
    await service.statusMany([{ platform: 'facebook', post_id: 'p1' }]);

    expect(prisma.ownedVideoScript.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ nguon: { not: 'khong_co' } }),
      }),
    );
  });

  it('đã chấm thành công thì trả da_cham kèm verdict đạt/chưa đạt', async () => {
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
      { 'facebook:p1': { trang_thai: 'da_cham', dat: true, so_ky_tu: 800 } },
    );
  });

  it('đã chấm nhưng không đọc được verdict thì dat = null, không đoán bừa là chưa đạt', async () => {
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

    const ra = await service.statusMany([{ platform: 'facebook', post_id: 'p1' }]);
    expect(ra['facebook:p1'].dat).toBeNull();
  });

  it.each([
    [99, 'qua_ngan'],
    [100, 'co_kich_ban'],
  ])('%s ký tự, chưa chấm → %s', async (charCount, mong) => {
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

    const ra = await service.statusMany([{ platform: 'facebook', post_id: 'p1' }]);
    expect(ra['facebook:p1']).toEqual({ trang_thai: mong, dat: null, so_ky_tu: charCount });
  });
});

describe('scoreVideo — chốt chặn trước khi gọi LLM', () => {
  it('không lấy được kịch bản Facebook → chua_co_kich_ban, không gọi LLM', async () => {
    const { service, paast } = buildService();
    stubScript(service, null);

    const ra = await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(ra.trang_thai).toBe('chua_co_kich_ban');
    expect(paast.analyzeContentV2).not.toHaveBeenCalled();
  });

  it.each(['tiktok', 'instagram', 'youtube'])(
    'nền tảng %s chưa hỗ trợ lấy kịch bản → khong_ho_tro',
    async (platform) => {
      const { service, paast } = buildService();
      stubScript(service, null);

      const ra = await service.scoreVideo(platform, 'p1', USER_ID);
      expect(ra.trang_thai).toBe('khong_ho_tro');
      expect(ra.ghi_chu).toContain(platform);
      expect(paast.analyzeContentV2).not.toHaveBeenCalled();
    },
  );

  /* PAAST đòi tối thiểu 100 ký tự — chặn ở đây để khỏi tốn một lượt LLM cho câu trả lời chắc chắn lỗi. */
  it('kịch bản 99 ký tự → qua_ngan, không gọi LLM', async () => {
    const { service, paast } = buildService();
    stubScript(service, script({ noi_dung: 'a'.repeat(99), so_ky_tu: 99 }));

    const ra = await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(ra.trang_thai).toBe('qua_ngan');
    expect(ra.ghi_chu).toContain('99 ký tự');
    expect(paast.analyzeContentV2).not.toHaveBeenCalled();
  });

  /*
   * Bộ tiêu chí PAAST viết bằng tiếng Việt. Đưa kịch bản tiếng Thái vào vẫn ra một bản chấm
   * trông như thật nhưng vô nghĩa — thà nói thẳng là chưa hỗ trợ.
   */
  it.each(['th', 'en', 'zh', 'ko'])('kịch bản tiếng "%s" → khong_ho_tro', async (ma) => {
    const { service, paast } = buildService();
    stubScript(service, script({ ngon_ngu: ma }));

    const ra = await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(ra.trang_thai).toBe('khong_ho_tro');
    expect(paast.analyzeContentV2).not.toHaveBeenCalled();
  });

  /* Whisper trả 'vi', phụ đề Facebook trả 'vi_VN' — phải nhận cả hai. Rỗng thì cho qua. */
  it.each(['vi', 'vi_VN', 'VI', ''])('kịch bản tiếng "%s" được chấm', async (ma) => {
    const { service, paast } = buildService();
    stubScript(service, script({ ngon_ngu: ma }));

    const ra = await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(ra.trang_thai).toBe('da_cham');
    expect(paast.analyzeContentV2).toHaveBeenCalledTimes(1);
  });

  /*
   * Dùng lại bản chấm cũ kể cả người chấm là đồng nghiệp khác — đây là lý do phải đi qua
   * paast_analysis_id thay vì findLatestByContent(): hàm đó lọc theo user_id nên mỗi người mở
   * cùng một video lại tốn thêm một lượt LLM và cho ra điểm khác nhau.
   */
  it('đã có bản chấm SUCCESS thì trả lại bản cũ, không gọi LLM lần nữa', async () => {
    const cu = { id: 'a1', status: 'SUCCESS' };
    const { service, paast } = buildService({
      prisma: { paastAnalysisHistory: { findUnique: async () => cu } },
    });
    stubScript(service, script({ paast_analysis_id: 'a1' }));

    const ra = await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(ra).toMatchObject({ trang_thai: 'da_cham', phan_tich: cu });
    expect(paast.analyzeContentV2).not.toHaveBeenCalled();
  });

  it('bản chấm cũ FAILED thì chấm lại', async () => {
    const { service, paast } = buildService({
      prisma: { paastAnalysisHistory: { findUnique: async () => ({ id: 'a1', status: 'FAILED' }) } },
    });
    stubScript(service, script({ paast_analysis_id: 'a1' }));

    await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(paast.analyzeContentV2).toHaveBeenCalledTimes(1);
  });

  it('chấm xong thì nối bản phân tích vào bản ghi kịch bản để lần sau dùng lại', async () => {
    const { service, prisma } = buildService();
    stubScript(service, script({ id: 'ks9' }));

    await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(prisma.ownedVideoScript.update).toHaveBeenCalledWith({
      where: { id: 'ks9' },
      data: { paast_analysis_id: 'p1' },
    });
  });

  it('LLM lỗi thì giữ nguyên co_kich_ban kèm lý do, không nuốt lỗi thành da_cham', async () => {
    const { service } = buildService({
      paast: {
        analyzeContentV2: async () => ({ status: 'FAILED', error_message: 'DeepSeek quá tải' }),
      },
    });
    stubScript(service, script());

    const ra = await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(ra).toMatchObject({ trang_thai: 'co_kich_ban', ghi_chu: 'DeepSeek quá tải' });
  });
});

describe('scoreVideo — cắt kịch bản dài quá trần 3.000 ký tự', () => {
  /* Video dài bóc ra tới 5.320 ký tự (đo được), trước đây rơi thẳng vào nhánh lỗi. */
  const longContent = (n: number) => 'Câu này dài vừa đủ để có dấu chấm. '.repeat(n);

  it('cắt ở ranh giới câu gần nhất, không cắt giữa chừng', async () => {
    const { service, paast } = buildService();
    const content = longContent(200);
    stubScript(service, script({ noi_dung: content, so_ky_tu: content.length }));

    await service.scoreVideo('facebook', 'p1', USER_ID);

    const sent = paast.analyzeContentV2.mock.calls[0][1];
    expect(sent.length).toBeLessThanOrEqual(3000);
    expect(sent.endsWith('.')).toBe(true);
  });

  it('báo rõ trong ghi_chu là đã chấm trên phần đầu', async () => {
    const { service } = buildService();
    const content = longContent(200);
    stubScript(service, script({ noi_dung: content, so_ky_tu: content.length }));

    const ra = await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(ra.ghi_chu).toContain(`Kịch bản dài ${content.length} ký tự`);
    expect(ra.so_ky_tu).toBe(content.length); // số ký tự trả về là của bản GỐC
  });

  /*
   * Không có dấu câu nào trong 3.000 ký tự đầu thì cắt cứng — thà chấm trên 3.000 ký tự cụt
   * còn hơn gửi quá trần rồi rơi vào nhánh lỗi và không chấm được gì.
   */
  it('kịch bản không có dấu câu thì cắt cứng đúng 3.000 ký tự', async () => {
    const { service, paast } = buildService();
    const content = 'a'.repeat(5000);
    stubScript(service, script({ noi_dung: content, so_ky_tu: 5000 }));

    await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(paast.analyzeContentV2.mock.calls[0][1]).toHaveLength(3000);
  });

  it('kịch bản đúng 3.000 ký tự thì gửi nguyên, không ghi chú cắt', async () => {
    const { service, paast } = buildService();
    const content = 'a'.repeat(3000);
    stubScript(service, script({ noi_dung: content, so_ky_tu: 3000 }));

    const ra = await service.scoreVideo('facebook', 'p1', USER_ID);
    expect(paast.analyzeContentV2.mock.calls[0][1]).toBe(content);
    expect(ra.ghi_chu).toBeUndefined();
  });
});
