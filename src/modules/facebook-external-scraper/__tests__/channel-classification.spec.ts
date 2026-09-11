import { FacebookExternalScraperService } from '../facebook-external-scraper.service';

describe('FacebookExternalScraperService - Channel Classification & Tags', () => {
  it('updateClassification cập nhật thành công channel_type và product_lines', async () => {
    let updatedData: any = null;
    const prismaMock: any = {
      scraperFanpage: {
        findUnique: jest.fn().mockResolvedValue({
          id: 10n,
          name: 'HAPAS Official',
          channel_type: 'product',
          product_lines: ['vang'],
        }),
        update: jest.fn().mockImplementation(({ where, data }: any) => {
          updatedData = { id: where.id, ...data };
          return {
            id: 10n,
            name: 'HAPAS Official',
            channel_type: data.channel_type || 'product',
            product_lines: data.product_lines || ['vang'],
          };
        }),
      },
    };

    const service = new FacebookExternalScraperService(prismaMock, {} as any);
    const result = await service.updateClassification(10n, {
      channel_type: 'content',
      product_lines: ['da_quy', 'kim_cuong'],
    });

    expect(result.status).toBe('ok');
    expect(result.fanpage_id).toBe(10);
    expect(result.channel_type).toBe('content');
    expect(result.product_lines).toEqual(['da_quy', 'kim_cuong']);
    expect(updatedData.channel_type).toBe('content');
    expect(updatedData.product_lines).toEqual(['da_quy', 'kim_cuong']);
  });

  it('createTag tạo tag mới với slug chuẩn tiếng Việt', async () => {
    let createdRow: any = null;
    const prismaMock: any = {
      scraperChannelTag: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) => {
          createdRow = { id: 1n, ...data };
          return createdRow;
        }),
      },
    };

    const service = new FacebookExternalScraperService(prismaMock, {} as any);
    const result = await service.createTag('Trang sức đá quý', 'violet');

    expect(result.name).toBe('Trang sức đá quý');
    expect(result.slug).toBe('trang_suc_da_quy');
    expect(result.color).toBe('violet');
    expect(createdRow).not.toBeNull();
  });

  it('createTag trả về tag đã có nếu trùng slug hoặc tên', async () => {
    const existingTag = {
      id: 5n,
      name: 'Vàng',
      slug: 'vang',
      color: 'amber',
    };
    const prismaMock: any = {
      scraperChannelTag: {
        findFirst: jest.fn().mockResolvedValue(existingTag),
        create: jest.fn(),
      },
    };

    const service = new FacebookExternalScraperService(prismaMock, {} as any);
    const result = await service.createTag('Vàng');

    expect(result.id).toBe(5);
    expect(result.slug).toBe('vang');
    expect(prismaMock.scraperChannelTag.create).not.toHaveBeenCalled();
  });

  it('listTags trả về danh sách tags', async () => {
    const prismaMock: any = {
      scraperChannelTag: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1n, name: 'Vàng', slug: 'vang', color: 'amber' },
          { id: 2n, name: 'Bạc', slug: 'bac', color: 'slate' },
        ]),
      },
    };

    const service = new FacebookExternalScraperService(prismaMock, {} as any);
    const tags = await service.listTags();

    expect(tags).toHaveLength(2);
    expect(tags[0].name).toBe('Vàng');
    expect(tags[1].slug).toBe('bac');
  });

  it('bulkAddFanpages lưu channel_type và product_lines đã chọn', async () => {
    const createdRows: any[] = [];
    const prismaMock: any = {
      scraperFanpage: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) => {
          const row = { id: 101n, ...data };
          createdRows.push(row);
          return row;
        }),
      },
    };

    const service = new FacebookExternalScraperService(prismaMock, {} as any);
    const result = await service.bulkAddFanpages(
      ['https://www.facebook.com/trangsucbacxua'],
      {
        channel_type: 'product',
        product_lines: ['bac', 'che_tac'],
      },
    );

    expect(result.added_count).toBe(1);
    expect(createdRows[0].channel_type).toBe('product');
    expect(createdRows[0].product_lines).toEqual(['bac', 'che_tac']);
  });
});
