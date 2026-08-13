import { DouyinScraperController } from '../douyin-scraper.controller';

/**
 * Chức năng: câu báo kết quả tìm kiếm Douyin nói ĐÚNG việc đã làm xong.
 *
 * Lỗi thật đo được ngày 13/08/2026: controller dựng câu `Đang tìm kiếm "..." trên Douyin...`
 * SAU KHI đã `await searchKeyword` xong xuôi. Gọi thật trả về `created: 5` kèm đúng câu đó.
 * FE thì `toast.success(data.message)` rồi thôi, không poll gì thêm — nên người dùng đọc được
 * "đang tìm kiếm" trong khi việc đã xong, và không biết cào được bao nhiêu video.
 *
 * Bốn nền tảng còn lại (TikTok, Kuaishou, Bilibili, Xiaohongshu) đều báo "Đã tìm thấy N video
 * mới" — chỉ mỗi Douyin lệch.
 */
describe('DouyinScraperController.search — câu báo kết quả', () => {
  function build(ketQua: { created: number; updated: number }) {
    const service: any = { searchKeyword: jest.fn().mockResolvedValue(ketQua) };
    const controller = new DouyinScraperController(service, {} as any);
    return { controller, service };
  }

  it('báo số video đã cào được, không báo là đang chạy', async () => {
    const { controller } = build({ created: 5, updated: 0 });

    const res = await controller.search({ keyword: '黄金首饰', num_of_posts: 5 });

    expect(res.message).toContain('5');
    // Đây đúng là câu bản cũ trả về sau khi công việc đã xong.
    expect(res.message).not.toContain('Đang tìm kiếm');
  });

  it('dùng từ khoá tiếng Việt người dùng gõ, không phải bản dịch tiếng Trung', async () => {
    const { controller } = build({ created: 3, updated: 0 });

    const res = await controller.search({
      keyword: '黄金首饰',
      display_keyword: 'trang sức vàng',
      num_of_posts: 3,
    });

    expect(res.message).toContain('trang sức vàng');
    expect(res.message).not.toContain('黄金首饰');
  });

  it('không cào được video nào cũng phải nói rõ là 0, không im lặng', async () => {
    const { controller } = build({ created: 0, updated: 0 });

    const res = await controller.search({ keyword: 'tu-khoa-la' });

    expect(res.message).toContain('0');
  });
});
