import { Logger } from '@nestjs/common';
import { FacebookOwnedPagesService } from '../facebook-owned-pages.service';

/**
 * Đây là hàm DUY NHẤT cập nhật view_count/like_count của video nội bộ đã đăng — trang
 * "Tổng quan kênh nội bộ" cộng thẳng từ những cột đó. Nó chết là bảng số đứng im, mà
 * đứng im thì trông y hệt "kỳ này ít view", không ai nhận ra là hỏng.
 *
 * Vòng lặp gốc gọi fetchMetricsRefresh() TRẦN, không try/catch. Một page token hỏng
 * (hoặc một cú 502 của AI service) là `throw` bay thẳng ra khỏi vòng lặp và 94 page
 * còn lại không được sờ tới — thứ tự Map quyết định ai may ai rủi. Đo trên dữ liệu
 * thật 12/08/2026: 95/95 fanpage kẹt `scrape_error=502`, metrics đứng từ 03/08.
 *
 * Hai hàm anh em cùng tệp (backfillAllPages, deltaSyncAllPages) đều đã bọc try/catch
 * quanh từng page — chỉ hàm này bị bỏ sót.
 */
describe('FacebookOwnedPagesService.refreshRecentMetrics — một page hỏng không kéo sập cả lượt', () => {
  let prisma: any;
  let aiClient: { fetchMetricsRefresh: jest.Mock };
  let service: FacebookOwnedPagesService;
  let capNhat: string[];

  /** Ba page, mỗi page một video — page giữa luôn là page ném lỗi. */
  function dungVideo() {
    return ['page-a', 'page-hong', 'page-c'].map((pageId, i) => ({
      id: BigInt(i + 1),
      post_id: `${pageId}_post`,
      view_count: 0n,
      like_count: 0,
      comment_count: 0,
      share_count: 0,
      managed_page: { page_id: pageId, name: pageId, page_access_token: 'token-ma-hoa' },
    }));
  }

  beforeEach(() => {
    capNhat = [];
    prisma = {
      video_management_ownedvideocontent: {
        findMany: jest.fn().mockResolvedValue(dungVideo()),
        update: jest.fn(async ({ where }: any) => {
          capNhat.push(String(where.id));
          return {};
        }),
      },
    };
    aiClient = { fetchMetricsRefresh: jest.fn() };
    service = new FacebookOwnedPagesService(prisma, aiClient as any);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  function traLoiTheoPage() {
    aiClient.fetchMetricsRefresh.mockImplementation(async (_token: string, postIds: string[]) => {
      if (postIds[0].startsWith('page-hong')) throw new Error('Request failed with status code 502');
      return { metrics: { [postIds[0]]: { view_count: 1234, like_count: 5, comment_count: 1, share_count: 0 } } };
    });
  }

  it('page sau page hỏng vẫn được cập nhật view', async () => {
    traLoiTheoPage();

    await service.refreshRecentMetrics(7);

    // '3' là page-c — nằm SAU page hỏng trong thứ tự duyệt.
    expect(capNhat).toContain('3');
  });

  it('đếm đúng số video cập nhật được, không tính page hỏng', async () => {
    traLoiTheoPage();

    const ketQua = await service.refreshRecentMetrics(7);

    expect(ketQua).toEqual({ updated: 2, total: 3 });
  });

  it('page hỏng phải được ghi log lỗi kèm tên, không im lặng bỏ qua', async () => {
    traLoiTheoPage();
    const errorSpy = jest.spyOn(Logger.prototype, 'error');

    await service.refreshRecentMetrics(7);

    expect(errorSpy.mock.calls.flat().join(' ')).toContain('page-hong');
  });
});
