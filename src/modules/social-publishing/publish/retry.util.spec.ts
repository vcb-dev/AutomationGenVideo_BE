import { withRetry, isRetryableHttpError, linearBackoff, DEFAULT_MAX_ATTEMPTS } from './retry.util';

/** Lỗi giả có status như axios ném ra */
function httpError(status?: number) {
  return status === undefined ? new Error('đứt mạng') : { response: { status }, message: `HTTP ${status}` };
}

describe('isRetryableHttpError — giữ nguyên luật cũ của các publisher', () => {
  it('thử lại khi bị rate-limit (429)', () => {
    expect(isRetryableHttpError(httpError(429))).toBe(true);
  });

  it('thử lại khi nền tảng lỗi (5xx)', () => {
    expect(isRetryableHttpError(httpError(500))).toBe(true);
    expect(isRetryableHttpError(httpError(503))).toBe(true);
  });

  it('thử lại khi không có status — timeout hoặc đứt mạng', () => {
    expect(isRetryableHttpError(httpError())).toBe(true);
  });

  it('KHÔNG thử lại với lỗi 4xx khác — request sai thì thử lại chỉ tốn thời gian', () => {
    expect(isRetryableHttpError(httpError(400))).toBe(false);
    expect(isRetryableHttpError(httpError(403))).toBe(false);
  });

  it('đọc được status gắn trực tiếp trên lỗi, không chỉ trong response', () => {
    expect(isRetryableHttpError({ status: 429 })).toBe(true);
    expect(isRetryableHttpError({ status: 400 })).toBe(false);
  });
});

describe('withRetry', () => {
  it('trả kết quả ngay khi lần đầu thành công, không chờ gì', async () => {
    const fn = jest.fn().mockResolvedValue('xong');
    await expect(withRetry(fn, { delayMs: () => 0 })).resolves.toBe('xong');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('thử lại rồi thành công ở lượt sau', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValue('xong');
    await expect(withRetry(fn, { delayMs: () => 0 })).resolves.toBe('xong');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('dừng ngay với lỗi vĩnh viễn, không đốt hết số lượt', async () => {
    const fn = jest.fn().mockRejectedValue(httpError(400));
    await expect(withRetry(fn, { delayMs: () => 0 })).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('ném lỗi của lượt cuối sau khi hết số lượt', async () => {
    const fn = jest.fn().mockRejectedValue(httpError(500));
    await expect(withRetry(fn, { maxAttempts: 3, delayMs: () => 0 })).rejects.toMatchObject({
      response: { status: 500 },
    });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('mặc định 3 lượt — đúng con số các publisher đang dùng', async () => {
    const fn = jest.fn().mockRejectedValue(httpError(500));
    await expect(withRetry(fn, { delayMs: () => 0 })).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(DEFAULT_MAX_ATTEMPTS);
    expect(DEFAULT_MAX_ATTEMPTS).toBe(3);
  });

  it('gọi onRetry kèm số lượt và độ trễ để publisher ghi log', async () => {
    const onRetry = jest.fn();
    const fn = jest.fn()
      .mockRejectedValueOnce(httpError(500))
      .mockResolvedValue('xong');
    await withRetry(fn, { delayMs: () => 0, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][1]).toBe(1);
    expect(onRetry.mock.calls[0][2]).toBe(0);
  });

  it('tôn trọng isRetryable tuỳ biến', async () => {
    const fn = jest.fn().mockRejectedValue(httpError(500));
    await expect(
      withRetry(fn, { delayMs: () => 0, isRetryable: () => false }),
    ).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('linearBackoff — giữ đúng công thức cũ attempt * 800', () => {
  it('giãn dần theo lượt', () => {
    expect(linearBackoff(1)).toBe(800);
    expect(linearBackoff(2)).toBe(1600);
  });
});
