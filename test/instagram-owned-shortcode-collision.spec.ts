import { InstagramOwnedAccountsService } from '../src/modules/instagram-owned-accounts/instagram-owned-accounts.service';

describe('InstagramOwnedAccountsService.syncProfileMedia — shortcode collision resilience', () => {
  it('cập nhật thành công khi reel có cùng shortcode nhưng khác post_id (không văng lỗi unique constraint)', async () => {
    const existingReel = {
      id: 100n,
      profile_id: 1n,
      post_id: 'old_apify_numeric_id_12345',
      shortcode: 'REEL_SHORTCODE_XYZ',
      url: 'https://www.instagram.com/reel/REEL_SHORTCODE_XYZ/',
      description: 'Cũ',
      hashtags: [],
      thumbnail_url: 'https://example.com/old.jpg',
      play_count: 500n,
      likes_count: 50n,
      comments_count: 5n,
      date_posted: new Date(),
    };

    const updateMock = jest.fn().mockResolvedValue({});
    const createMock = jest.fn().mockResolvedValue({});
    const findFirstMock = jest.fn().mockResolvedValue(existingReel);
    const findUniqueMock = jest.fn().mockResolvedValue(null);

    const prismaMock: any = {
      scraperInstagramReel: {
        findFirst: findFirstMock,
        findUnique: findUniqueMock,
        update: updateMock,
        create: createMock,
      },
    };

    const service = new InstagramOwnedAccountsService(prismaMock, null as any);

    // Mock fetchUserMedia and fetchMediaViews
    jest.spyOn(service, 'fetchUserMedia').mockResolvedValue([
      {
        id: 'new_graph_api_id_99999',
        shortcode: 'REEL_SHORTCODE_XYZ',
        caption: 'Mới cập nhật #trangsuc',
        media_type: 'VIDEO',
        media_product_type: 'REELS',
        media_url: 'https://example.com/new.mp4',
        thumbnail_url: 'https://example.com/new.jpg',
        permalink: 'https://www.instagram.com/reel/REEL_SHORTCODE_XYZ/',
        timestamp: '2026-09-14T00:00:00Z',
        like_count: 120,
        comments_count: 15,
      },
    ] as any);

    jest.spyOn(service, 'fetchMediaViews').mockResolvedValue(1500);

    const count = await service.syncProfileMedia(1n, 'https://graph.facebook.com/v21.0', 'ig_user_1', 'token');

    expect(count).toBe(1);
    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        OR: [{ post_id: 'new_graph_api_id_99999' }, { shortcode: 'REEL_SHORTCODE_XYZ' }],
      },
    });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 100n },
      data: expect.objectContaining({
        post_id: 'new_graph_api_id_99999',
        likes_count: 120n,
        play_count: 1500n,
      }),
    });
    expect(createMock).not.toHaveBeenCalled();
  });
});
