import { ChannelsService } from '../src/modules/channels-team/channels.service';

describe('ChannelsService.lookupByIdentifiers', () => {
  let prisma: any;
  let service: ChannelsService;

  beforeEach(() => {
    prisma = {
      channel: {
        findMany: jest.fn().mockResolvedValue([
          {
            name: 'HuyK Artisan',
            link_channel: 'https://www.facebook.com/profile.php?id=61591008054738&sk=reels_tab',
            channel_id: 'id=61591008054738&sk=reels_tab',
            owner: 'Nguyễn Thùy Linh',
            channel_owner: { full_name: 'Nguyễn Thùy Linh' },
            channel_team: { name: 'Global Thái Lan' },
          },
          {
            name: 'HuyK หัตถ์สุวรรณ',
            link_channel: 'https://www.instagram.com/huyk.hatsunwan/reels/',
            channel_id: ' huyk.hatsunwan',
            owner: 'Thuỳ Trang',
            channel_owner: { full_name: 'Thuỳ Trang' },
            channel_team: { name: 'Global Thái Lan' },
          },
          {
            name: 'HuyK Jewelerr',
            link_channel: 'https://www.facebook.com/profile.php?id=61552410151576',
            channel_id: null,
            owner: 'Khuc Quan',
            channel_owner: { full_name: 'Khuc Quan' },
            channel_team: null,
          },
        ]),
      },
      trackedChannel: {},
      team: {},
      user: {},
    };

    service = new ChannelsService(prisma as any);
  });

  it('trả về rỗng khi truyền mảng rỗng', async () => {
    const res = await service.lookupByIdentifiers([]);
    expect(res).toEqual({});
  });

  it('khớp chính xác theo link_channel đầy đủ', async () => {
    const res = await service.lookupByIdentifiers([
      'https://www.facebook.com/profile.php?id=61591008054738&sk=reels_tab',
    ]);
    expect(res['https://www.facebook.com/profile.php?id=61591008054738&sk=reels_tab']).toEqual({
      team_name: 'Global Thái Lan',
      owner_name: 'Nguyễn Thùy Linh',
    });
  });

  it('khớp theo URL chuẩn hoá khi URL dán vào không có &sk=reels_tab', async () => {
    const res = await service.lookupByIdentifiers([
      'https://www.facebook.com/61591008054738',
      '61591008054738',
    ]);
    expect(res['61591008054738']).toEqual({
      team_name: 'Global Thái Lan',
      owner_name: 'Nguyễn Thùy Linh',
    });
    expect(res['https://www.facebook.com/61591008054738']).toEqual({
      team_name: 'Global Thái Lan',
      owner_name: 'Nguyễn Thùy Linh',
    });
  });

  it('khớp Instagram khi URL có hoặc không có /reels/ và ID có khoảng trắng', async () => {
    const res = await service.lookupByIdentifiers([
      'huyk.hatsunwan',
      'https://www.instagram.com/huyk.hatsunwan',
      'https://instagram.com/huyk.hatsunwan/',
    ]);
    expect(res['huyk.hatsunwan']).toEqual({
      team_name: 'Global Thái Lan',
      owner_name: 'Thuỳ Trang',
    });
    expect(res['https://www.instagram.com/huyk.hatsunwan']).toEqual({
      team_name: 'Global Thái Lan',
      owner_name: 'Thuỳ Trang',
    });
  });

  it('khớp theo tên kênh (name fallback) khi URL khác định dạng', async () => {
    const res = await service.lookupByIdentifiers(['HuyK Jewelerr']);
    expect(res['HuyK Jewelerr']).toEqual({
      team_name: null,
      owner_name: 'Khuc Quan',
    });
  });
});
