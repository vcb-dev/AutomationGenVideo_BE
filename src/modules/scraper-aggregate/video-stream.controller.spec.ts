import { VideoStreamController } from './video-stream.controller';
import { PlayUrlNoCreditError } from '../ai-integration/play-url-errors';

/**
 * Ba lỗi ĐÃ ĐO ĐƯỢC TRÊN MÁY THẬT rồi mới viết test này — không phải giả định:
 *
 *  1. Link phát trong bộ đệm hết hạn → nền tảng trả 403 → trả 502 cho người xem trong 16ms
 *     (tức chưa hề gọi tới nền tảng: trúng bộ đệm hỏng). Video chết suốt 2 tiếng TTL.
 *  2. Lần xin link thất bại trả `null` cũng bị đệm nguyên 2 tiếng → nền tảng trục trặc một
 *     giây, video chết hai tiếng.
 *  3. `AbortSignal.timeout(30000)` bấm giờ cho CẢ quá trình chứ không chỉ lúc chờ hồi đáp:
 *     ép mạng 150KB/s thì video 8.428.848 byte bị cắt ở giây 33 khi mới tải 5.077.749 byte.
 */

type Recording = { status?: number; body?: any; chunks: Buffer[]; finished: boolean };

function buildResponse() {
  const recording: Recording = { chunks: [], finished: false };
  const nghe = new Map<string, Function[]>();
  const res: any = {
    status(code: number) { recording.status = code; return res; },
    json(payload: any) { recording.body = payload; recording.finished = true; return res; },
    setHeader() { return res; },
    write(chunk: Buffer) { recording.chunks.push(chunk); return true; },
    end() { recording.finished = true; },
    destroy() { recording.finished = true; },
    on(ev: string, fn: Function) { nghe.set(ev, [...(nghe.get(ev) || []), fn]); return res; },
    once(ev: string, fn: Function) { return res.on(ev, fn); },
    off() { return res; },
  };
  return { res, recording };
}

/** Bộ đệm thật thu nhỏ — giữ đúng nét đã gây lỗi: đệm nguyên giá trị hàm trả về, kể cả null. */
function buildCache() {
  const kho = new Map<string, any>();
  return {
    kho,
    get: jest.fn(async (key: string, _ttl: number, fetchFn: () => Promise<any>) => {
      if (kho.has(key)) return kho.get(key);
      const data = await fetchFn();
      kho.set(key, data);
      return data;
    }),
    invalidate: jest.fn(async (prefix?: string) => {
      for (const k of [...kho.keys()]) if (!prefix || k.startsWith(prefix)) kho.delete(k);
    }),
  };
}

function thanBaByte() {
  let xong = false;
  return {
    getReader: () => ({
      read: async () => (xong ? { done: true, value: undefined } : ((xong = true), { done: false, value: new Uint8Array([1, 2, 3]) })),
      cancel: async () => {},
    }),
    cancel: async () => {},
  };
}

function hoiDap(status: number, coThan = true): any {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    body: coThan ? thanBaByte() : null,
  };
}

describe('VideoStreamController — phát video qua trung gian', () => {
  const fetchGoc = global.fetch;
  afterEach(() => { global.fetch = fetchGoc; jest.useRealTimers(); });

  it('link trong bộ đệm hết hạn (403) thì xin link mới và phát được, không trả 502 cho người xem', async () => {
    const cache = buildCache();
    const ai = { fetchVideoPlayUrl: jest.fn() } as any;
    ai.fetchVideoPlayUrl
      .mockResolvedValueOnce('https://cdn.example/het-han.mp4')
      .mockResolvedValueOnce('https://cdn.example/con-han.mp4');

    const goi: string[] = [];
    global.fetch = jest.fn(async (url: any) => {
      goi.push(String(url));
      return String(url).includes('het-han') ? hoiDap(403) : hoiDap(206);
    }) as any;

    const ctl = new VideoStreamController(cache as any, ai);
    const { res, recording } = buildResponse();
    await ctl.stream('douyin', 'v1', undefined, { headers: {} } as any, res);

    expect(goi).toEqual(['https://cdn.example/het-han.mp4', 'https://cdn.example/con-han.mp4']);
    expect(ai.fetchVideoPlayUrl).toHaveBeenCalledTimes(2);
    expect(recording.status).toBe(206);
    expect(recording.body).toBeUndefined();      // KHÔNG có thân báo lỗi
    expect(Buffer.concat(recording.chunks)).toHaveLength(3);
  });

  it('403 hai lần liên tiếp thì dừng, không thử lại vô tận', async () => {
    const cache = buildCache();
    const ai = { fetchVideoPlayUrl: jest.fn().mockResolvedValue('https://cdn.example/hong.mp4') } as any;
    global.fetch = jest.fn(async () => hoiDap(403)) as any;

    const ctl = new VideoStreamController(cache as any, ai);
    const { res, recording } = buildResponse();
    await ctl.stream('douyin', 'v1', undefined, { headers: {} } as any, res);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(recording.status).toBe(502);
  });

  it('lỗi khác 403 (vd 404) thì báo ngay, không tốn thêm một lượt xin link', async () => {
    const cache = buildCache();
    const ai = { fetchVideoPlayUrl: jest.fn().mockResolvedValue('https://cdn.example/mat.mp4') } as any;
    global.fetch = jest.fn(async () => hoiDap(404)) as any;

    const ctl = new VideoStreamController(cache as any, ai);
    const { res, recording } = buildResponse();
    await ctl.stream('douyin', 'v1', undefined, { headers: {} } as any, res);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(recording.status).toBe(502);
  });

  it('lần xin link thất bại KHÔNG được đọng lại trong bộ đệm', async () => {
    const cache = buildCache();
    const ai = { fetchVideoPlayUrl: jest.fn() } as any;
    ai.fetchVideoPlayUrl.mockResolvedValueOnce(null).mockResolvedValue('https://cdn.example/ok.mp4');
    global.fetch = jest.fn(async () => hoiDap(200)) as any;

    const ctl = new VideoStreamController(cache as any, ai);

    const a = buildResponse();
    await ctl.stream('douyin', 'v1', undefined, { headers: {} } as any, a.res);
    expect(a.recording.status).toBe(404);
    expect(cache.kho.size).toBe(0);           // không đọng `null` lại

    // Lượt sau nền tảng bình thường trở lại → phải phát được ngay, không phải đợi hết TTL.
    const b = buildResponse();
    await ctl.stream('douyin', 'v1', undefined, { headers: {} } as any, b.res);
    expect(b.recording.status).toBe(200);
  });

  it('hạn 30 giây chỉ tính lúc chờ hồi đáp, KHÔNG cắt ngang lúc dữ liệu đang chảy', async () => {
    // KHÔNG dùng jest.useFakeTimers() ở đây: đồng hồ bên trong `AbortSignal.timeout` nằm
    // dưới lớp Node, jest không tua được — test kiểu đó xanh cả với code hỏng lẫn code đúng.
    // Thay vào đó kiểm THẲNG cái cơ chế đã gây lỗi.
    const cache = buildCache();
    const ai = { fetchVideoPlayUrl: jest.fn().mockResolvedValue('https://cdn.example/longText.mp4') } as any;

    const timeoutGoc = AbortSignal.timeout;
    const doDemNguoc = jest.fn(timeoutGoc);
    (AbortSignal as any).timeout = doDemNguoc;

    const nhoHen = jest.spyOn(global, 'setTimeout');
    const goBoHen = jest.spyOn(global, 'clearTimeout');

    let tinHieu: AbortSignal | undefined;
    global.fetch = jest.fn(async (_u: any, opt: any) => { tinHieu = opt.signal; return hoiDap(200); }) as any;

    try {
      const ctl = new VideoStreamController(cache as any, ai);
      const { res } = buildResponse();
      await ctl.stream('douyin', 'v1', undefined, { headers: {} } as any, res);

      // 1. Cấm dùng AbortSignal.timeout: nó bấm giờ cho CẢ quá trình, kể cả lúc đang chảy dữ
      //    liệu — chính là thứ đã cắt video 8,4MB ở giây 33 khi ép mạng xuống 150KB/s.
      expect(doDemNguoc).not.toHaveBeenCalled();

      // 2. Hạn giờ phải được GỠ ngay khi có hồi đáp, để phần thân chảy bao lâu tuỳ mạng.
      const hen = nhoHen.mock.results.map((r) => r.value);
      expect(hen.length).toBeGreaterThan(0);
      expect(goBoHen).toHaveBeenCalledWith(hen[hen.length - 1]);

      // 3. Và tín hiệu vẫn còn sống sau khi trả hồi đáp.
      expect(tinHieu?.aborted).toBe(false);
    } finally {
      (AbortSignal as any).timeout = timeoutGoc;
      nhoHen.mockRestore();
      goBoHen.mockRestore();
    }
  });

  it('hết số dư TikHub thì trả 402 kèm lý do, KHÔNG lẫn với 404 "video này hỏng"', async () => {
    // Đã xảy ra thật: TikHub trả HTTP 402 vì hết tiền → cả douyin/tiktok/xiaohongshu/kuaishou
    // cùng chết, nhưng người dùng chỉ thấy "Không phát được video này" nên đi tìm sai chỗ.
    const cache = buildCache();
    const ai = { fetchVideoPlayUrl: jest.fn().mockRejectedValue(new PlayUrlNoCreditError()) } as any;
    global.fetch = jest.fn() as any;

    const ctl = new VideoStreamController(cache as any, ai);
    const { res, recording } = buildResponse();
    await ctl.stream('douyin', 'v1', undefined, { headers: {} } as any, res);

    expect(recording.status).toBe(402);
    expect(recording.body.reason).toBe('no_credit');
    expect(global.fetch).not.toHaveBeenCalled();   // khỏi phí một lượt gọi vô ích
    expect(cache.kho.size).toBe(0);                // không đọng lỗi lại trong bộ đệm
  });

  it('xin được link trở lại thì xoá ngay mốc hết số dư, không bắt chờ hết 10 phút', async () => {
    const ai = { fetchVideoPlayUrl: jest.fn() } as any;
    global.fetch = jest.fn(async () => hoiDap(200)) as any;

    // 1. Hết số dư → tokenRow-thai phải báo 402.
    ai.fetchVideoPlayUrl.mockRejectedValueOnce(new PlayUrlNoCreditError());
    const ctl = new VideoStreamController(buildCache() as any, ai);
    await ctl.stream('douyin', 'v1', undefined, { headers: {} } as any, buildResponse().res);
    const a = buildResponse();
    ctl.trangThai(a.res);
    expect(a.recording.status).toBe(402);

    // 2. Nạp tiền xong, một video phát được → mốc phải được xoá NGAY.
    ai.fetchVideoPlayUrl.mockResolvedValue('https://cdn.example/ok.mp4');
    await ctl.stream('douyin', 'v2', undefined, { headers: {} } as any, buildResponse().res);
    const b = buildResponse();
    ctl.trangThai(b.res);
    expect(b.recording.body).toEqual({ ok: true });
  });

  it('chuyển tiếp header Range để thẻ <video> tua được', async () => {
    const cache = buildCache();
    const ai = { fetchVideoPlayUrl: jest.fn().mockResolvedValue('https://cdn.example/ok.mp4') } as any;
    let guiDi: any;
    global.fetch = jest.fn(async (_u: any, opt: any) => { guiDi = opt.headers; return hoiDap(206); }) as any;

    const ctl = new VideoStreamController(cache as any, ai);
    const { res } = buildResponse();
    await ctl.stream('douyin', 'v1', undefined, { headers: { range: 'bytes=1000-2000' } } as any, res);

    expect(guiDi.Range).toBe('bytes=1000-2000');
    expect(guiDi.Referer).toBeUndefined();   // chính Referer làm Douyin trả 403
  });
});
