import {
  resolveAiServiceUrl,
  resolveAiServiceUrlFromEnv,
} from '../ai-service-url';

/**
 * Trước khi gom về đây, 24 chỗ tự đọc AI_SERVICE_URL với hai giá trị mặc định khác nhau —
 * 8 chỗ localhost:8001, 16 chỗ localhost:8000. Thiếu biến môi trường thì một nửa module gọi
 * đúng cổng, nửa kia gọi vào chỗ không ai nghe, mà không có dấu hiệu gì lúc khởi động.
 *
 * Test khoá lại hai điều: không còn giá trị mặc định nào, và dấu / thừa ở cuối bị cắt để nơi
 * gọi ghép `${url}/api/...` không sinh ra đường dẫn có //.
 */
describe('resolveAiServiceUrl', () => {
  it('trả về đúng giá trị đã cấu hình', () => {
    const config = { get: () => 'https://ai.example.com' } as any;
    expect(resolveAiServiceUrl(config)).toBe('https://ai.example.com');
  });

  it('cắt dấu / ở cuối để không sinh // khi ghép đường dẫn', () => {
    const config = { get: () => 'https://ai.example.com/' } as any;
    expect(resolveAiServiceUrl(config)).toBe('https://ai.example.com');
  });

  it('thiếu biến thì báo lỗi, KHÔNG tự chọn cổng mặc định', () => {
    const config = { get: () => undefined } as any;
    expect(() => resolveAiServiceUrl(config)).toThrow(/AI_SERVICE_URL/);
  });

  it('chuỗi rỗng cũng coi là thiếu', () => {
    const config = { get: () => '   ' } as any;
    expect(() => resolveAiServiceUrl(config)).toThrow(/AI_SERVICE_URL/);
  });

  it('thông báo lỗi nêu cả hai cổng để người đọc biết đặt gì', () => {
    const config = { get: () => undefined } as any;
    expect(() => resolveAiServiceUrl(config)).toThrow(/8001[\s\S]*8000|8000[\s\S]*8001/);
  });
});

describe('resolveAiServiceUrlFromEnv', () => {
  const OLD = process.env.AI_SERVICE_URL;
  afterEach(() => {
    if (OLD === undefined) delete process.env.AI_SERVICE_URL;
    else process.env.AI_SERVICE_URL = OLD;
  });

  it('đọc từ process.env và cắt dấu / cuối', () => {
    process.env.AI_SERVICE_URL = 'http://ai.local:9999/';
    expect(resolveAiServiceUrlFromEnv()).toBe('http://ai.local:9999');
  });

  it('thiếu biến thì báo lỗi', () => {
    delete process.env.AI_SERVICE_URL;
    expect(() => resolveAiServiceUrlFromEnv()).toThrow(/AI_SERVICE_URL/);
  });
});
