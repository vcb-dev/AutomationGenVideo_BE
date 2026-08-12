import { HttpException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from '../all-exceptions.filter';

/**
 * Lý do BE chỉ nhận được "Request failed with status code 502": axios ném AxiosError,
 * mà `AxiosError.response` là ĐỐI TƯỢNG PHẢN HỒI HTTP, không phải thân lỗi kiểu
 * HttpException. Bộ lọc đọc `exception.response.error` nên với axios nó luôn undefined
 * và rơi về `exception.message` — câu chữ của thư viện, không phải của AI service.
 *
 * Hậu quả đo được ngày 12/08/2026: AI đã nói rõ "TikHub từ chối, khoá hết hạn" mà
 * người dùng vẫn chỉ thấy lỗi 500 trống. Sửa ở đây phủ cả 9 ai-client cùng lúc —
 * vá từng client là chắc chắn sót.
 */
describe('AllExceptionsFilter — chuyển tiếp lỗi từ AI service', () => {
  let phanHoi: { body: any; status: number };
  let filter: AllExceptionsFilter;

  const host: any = {
    switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => ({}) }),
  };

  beforeEach(() => {
    phanHoi = { body: null, status: 0 };
    const adapterHost: any = {
      httpAdapter: {
        getRequestUrl: () => '/api/scraper/tiktok/profiles/scrape/',
        reply: (_res: unknown, body: any, status: number) => {
          phanHoi = { body, status };
        },
      },
    };
    filter = new AllExceptionsFilter(adapterHost);
    jest.spyOn(require('@nestjs/common').Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  function loiAxios(status: number, data: any) {
    return Object.assign(new Error(`Request failed with status code ${status}`), {
      isAxiosError: true,
      response: { status, data },
    });
  }

  it('giữ nguyên lý do AI service trả về thay vì "status code 502"', () => {
    filter.catch(
      loiAxios(502, { error: 'TikHub từ chối yêu cầu (403): API token has expired. Khoá TIKHUB_API_KEY cần được gia hạn.' }),
      host,
    );

    expect(phanHoi.body.error).toContain('TIKHUB_API_KEY');
    expect(phanHoi.body.error).not.toContain('status code');
  });

  it('giữ nguyên mã trạng thái của AI, không quy hết về 500', () => {
    filter.catch(loiAxios(502, { error: 'TikHub từ chối yêu cầu (403)' }), host);

    expect(phanHoi.status).toBe(502);
  });

  it('AI sập không kèm thân JSON thì vẫn về 500 như cũ', () => {
    // Không có `data.error` để đọc — bịa ra thông báo tử tế ở đây là nói dối kiểu khác.
    filter.catch(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8001'), { isAxiosError: true }), host);

    expect(phanHoi.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(phanHoi.body.message).toContain('ECONNREFUSED');
  });

  /**
   * AI service là hạ tầng NỘI BỘ. Mã 401/403 của nó nói về quan hệ tin cậy BE↔AI, không
   * nói gì về phiên đăng nhập của người dùng — nhưng FE không phân biệt được: interceptor
   * ở api-client.ts gặp 401 là xoá localStorage và đá thẳng về /login.
   *
   * Hôm nay chưa view nào của AI trả 401/403 kèm khoá `error` nên chưa nổ. Đây là chốt
   * chặn cho ngày mai: thêm một view như vậy là người dùng bị đăng xuất giữa chừng mà
   * không ai hiểu vì sao.
   *
   * 429 cùng nhóm vì lý do khác: FE tự thử lại 3 lần khi gặp 429, tức bắn lại nguyên
   * lệnh cào — không phải thứ nên xảy ra sau lưng người dùng.
   */
  it.each([401, 403, 429])('mã %i của AI service không lọt ra ngoài, quy về 502', (status) => {
    filter.catch(loiAxios(status, { error: 'AI service từ chối' }), host);

    expect(phanHoi.status).toBe(HttpStatus.BAD_GATEWAY);
    expect(phanHoi.body.error).toBe('AI service từ chối');
  });

  it.each([400, 404, 422])('mã %i giữ nguyên — đó là lỗi về nội dung yêu cầu, có nghĩa với người dùng', (status) => {
    filter.catch(loiAxios(status, { error: 'username is required' }), host);

    expect(phanHoi.status).toBe(status);
  });

  it('HttpException của chính BE không bị đổi nghĩa', () => {
    filter.catch(new HttpException({ error: 'username is required' }, HttpStatus.BAD_REQUEST), host);

    expect(phanHoi.status).toBe(HttpStatus.BAD_REQUEST);
    expect(phanHoi.body.error).toBe('username is required');
  });
});
