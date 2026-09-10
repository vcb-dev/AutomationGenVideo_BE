import { FacebookExternalScraperService } from '../facebook-external-scraper.service';

describe('FacebookExternalScraperService.bulkAddFanpages', () => {
  it('thêm thành công các link hợp lệ và bỏ qua link trùng / sai định dạng', async () => {
    const createdRows: any[] = [];
    let nextId = 100n;

    const existingRows = [
      { id: 1n, handle: 'already_exists_page', page_url: 'https://www.facebook.com/already_exists_page', name: 'Existing Page' },
    ];

    const prisma: any = {
      scraperFanpage: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where.handle) {
            return existingRows.find((r) => r.handle === where.handle) || null;
          }
          if (where.page_url) {
            return existingRows.find((r) => r.page_url === where.page_url) || null;
          }
          return null;
        }),
        create: jest.fn().mockImplementation(({ data }: any) => {
          const row = { id: nextId++, ...data };
          createdRows.push(row);
          return row;
        }),
      },
    };

    const service = new FacebookExternalScraperService(prisma, {} as any);

    const inputUrls = [
      'https://www.facebook.com/new_page_1',
      'https://www.facebook.com/new_page_2/',
      'https://www.facebook.com/already_exists_page', // đã tồn tại
      'https://www.facebook.com/new_page_1', // trùng trong batch
      'https://google.com/not-fb', // sai domain
      '', // link rỗng
    ];

    const result = await service.bulkAddFanpages(inputUrls);

    expect(result.total_received).toBe(6);
    expect(result.added_count).toBe(2);
    expect(result.skipped_count).toBe(4); // 1 existing + 1 dup in batch + 1 invalid domain + 1 empty string

    expect(result.added_pages).toHaveLength(2);
    expect(result.added_pages[0].handle).toBe('new_page_1');
    expect(result.added_pages[1].handle).toBe('new_page_2');

    expect(createdRows).toHaveLength(2);
    expect(createdRows[0].scraping_status).toBe('idle');
    expect(createdRows[0].is_initial_scraped).toBe(false);
  });

  it('báo lỗi BAD_REQUEST khi gửi mảng rỗng', async () => {
    const service = new FacebookExternalScraperService({} as any, {} as any);
    await expect(service.bulkAddFanpages([])).rejects.toThrow('Danh sách URLs không được để trống');
  });
});
