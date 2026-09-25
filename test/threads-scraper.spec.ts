import { ThreadsScraperService } from '../src/modules/threads-scraper/threads-scraper.service';
import { ThreadsScraperReadService } from '../src/modules/threads-scraper/threads-scraper-read.service';

describe('ThreadsScraperService & ThreadsScraperReadService', () => {
  describe('ThreadsScraperService', () => {
    let service: ThreadsScraperService;
    let prismaMock: any;
    let aiClientMock: any;

    beforeEach(() => {
      prismaMock = {
        scraperThreadsProfile: {
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
          count: jest.fn(),
          findMany: jest.fn(),
        },
        scraperThreadsPost: {
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          count: jest.fn(),
          findMany: jest.fn(),
        },
      };

      aiClientMock = {
        fetchProfilePosts: jest.fn(),
        searchTop: jest.fn(),
      };

      service = new ThreadsScraperService(prismaMock, aiClientMock);
    });

    it('createOrGetProfile tạo mới profile với is_owned = false cho kênh khám phá ngoài', async () => {
      prismaMock.scraperThreadsProfile.findUnique.mockResolvedValue(null);
      let createdData: any = null;
      prismaMock.scraperThreadsProfile.create.mockImplementation(({ data }: any) => {
        createdData = { id: 100n, ...data };
        return Promise.resolve(createdData);
      });

      const profile = await service.createOrGetProfile('@tech_insider');

      expect(prismaMock.scraperThreadsProfile.findUnique).toHaveBeenCalledWith({
        where: { username: 'tech_insider' },
      });
      expect(createdData.username).toBe('tech_insider');
      expect(createdData.is_owned).toBe(false); // BẮT BUỘC false để không nhầm kênh nội bộ
      expect(createdData.is_tracked).toBe(true);
      expect(profile.id).toBe(100n);
    });

    it('createOrGetProfile tái sử dụng profile nếu đã tồn tại', async () => {
      const existing = { id: 200n, username: 'existing_user', is_owned: false };
      prismaMock.scraperThreadsProfile.findUnique.mockResolvedValue(existing);

      const profile = await service.createOrGetProfile('existing_user');

      expect(prismaMock.scraperThreadsProfile.create).not.toHaveBeenCalled();
      expect(profile).toBe(existing);
    });

    it('scrapeProfilePosts gọi AI client và upsert đầy đủ posts', async () => {
      prismaMock.scraperThreadsProfile.findUnique.mockResolvedValue({
        id: 10n,
        username: 'viet_creator',
        scraping_status: 'idle',
      });
      prismaMock.scraperThreadsProfile.update.mockResolvedValue({});
      prismaMock.scraperThreadsPost.findUnique.mockResolvedValue(null);
      prismaMock.scraperThreadsPost.create.mockResolvedValue({});

      aiClientMock.fetchProfilePosts.mockResolvedValue({
        full_profile: {
          threads_user_id: '98765',
          username: 'viet_creator',
          name: 'Việt Creator',
          url: 'https://www.threads.net/@viet_creator',
          avatar_url: 'https://cdn.threads.net/avatar.jpg',
          biography: 'Sáng tạo nội dung ngắn',
          followers_count: 25000,
          is_verified: true,
        },
        posts: [
          {
            post_id: 'post_001',
            shortcode: 'code1',
            url: 'https://www.threads.net/@viet_creator/post/code1',
            text: 'Nội dung chia sẻ hôm nay #threads',
            media_type: 'VIDEO',
            thumbnail_url: 'https://cdn.threads.net/thumb.jpg',
            views_count: 10000,
            likes_count: 800,
            replies_count: 45,
            reposts_count: 20,
            quotes_count: 5,
            date_posted: new Date().toISOString(),
          },
        ],
      });

      const result = await service.scrapeProfilePosts(10n, 20);

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.items_returned).toBe(1);
      expect(prismaMock.scraperThreadsPost.create).toHaveBeenCalled();
      expect(prismaMock.scraperThreadsProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 10n },
          data: expect.objectContaining({
            scraping_status: 'completed',
          }),
        }),
      );
    });

    it('toggle cập nhật đúng cờ is_tracked hoặc is_bookmarked', async () => {
      prismaMock.scraperThreadsProfile.update.mockResolvedValue({ id: 5n, is_tracked: true });

      const updated = await service.toggle(5n, 'is_tracked', true);

      expect(prismaMock.scraperThreadsProfile.update).toHaveBeenCalledWith({
        where: { id: 5n },
        data: { is_tracked: true },
      });
      expect(updated.is_tracked).toBe(true);
    });

    it('deleteProfile đếm số post trước khi xoá và trả về kết quả chuẩn', async () => {
      prismaMock.scraperThreadsProfile.findUnique.mockResolvedValue({
        id: 7n,
        name: 'Kênh Cũ',
        username: 'old_channel',
      });
      prismaMock.scraperThreadsPost.count.mockResolvedValue(15);
      prismaMock.scraperThreadsProfile.delete.mockResolvedValue({});

      const result = await service.deleteProfile(7n);

      expect(result.deleted).toBe(true);
      expect(result.id).toBe(7);
      expect(result.name).toBe('Kênh Cũ');
      expect(result.videos_deleted).toBe(15);
      expect(prismaMock.scraperThreadsProfile.delete).toHaveBeenCalledWith({
        where: { id: 7n },
      });
    });

    it('searchHotPosts gọi aiClient.searchTop khi tìm theo từ khoá', async () => {
      aiClientMock.searchTop.mockResolvedValue({
        query: 'vàng bạc',
        posts: [
          {
            post_id: 'live_post_1',
            shortcode: 'live1',
            url: 'https://threads.net/p/live1',
            text: 'Giá vàng hôm nay tăng mạnh',
            media_type: 'IMAGE',
            thumbnail_url: 'https://img.cdn/1.jpg',
            video_url: '',
            views_count: 3000,
            likes_count: 500,
            replies_count: 20,
            reposts_count: 5,
            quotes_count: 1,
            date_posted: new Date().toISOString(),
            author_username: 'gold_expert',
            author_name: 'Chuyên gia Vàng',
            author_avatar: '',
          },
        ],
      });

      prismaMock.scraperThreadsProfile.findUnique.mockResolvedValue({ id: 88n, username: 'gold_expert' });
      prismaMock.scraperThreadsPost.findUnique.mockResolvedValue(null);
      prismaMock.scraperThreadsPost.create.mockResolvedValue({});

      const res = await service.searchHotPosts('vàng bạc', 20);

      expect(aiClientMock.searchTop).toHaveBeenCalledWith('vàng bạc', 20);
      expect(prismaMock.scraperThreadsPost.create).toHaveBeenCalled();
      expect(res.posts.length).toBe(1);
      expect(res.posts[0].post_id).toBe('live_post_1');
      expect(res.posts[0].likes_count).toBe(500);
    });

    it('searchHotPosts tìm kiếm bài viết trong DB theo từ khoá và sắp xếp theo like nếu AI rỗng', async () => {
      aiClientMock.searchTop.mockResolvedValue({ query: 'công sở', posts: [] });
      prismaMock.scraperThreadsPost.findMany.mockResolvedValue([
        {
          post_id: 'top1',
          shortcode: 'code1',
          url: 'https://threads.net/p1',
          text: 'Chuyện công sở hôm nay',
          media_type: 'TEXT',
          thumbnail_url: null,
          views_count: 5000n,
          likes_count: 1200n,
          replies_count: 50n,
          reposts_count: 10n,
          quotes_count: 2n,
          date_posted: new Date('2026-09-14T10:00:00Z'),
          profile: { username: 'creator1', name: 'Creator 1', avatar_url: null },
        },
      ]);

      const res = await service.searchHotPosts('công sở', 30);

      expect(prismaMock.scraperThreadsPost.findMany).toHaveBeenCalled();
      expect(res.posts.length).toBe(1);
      expect(res.posts[0].likes_count).toBe(1200);
    });

    it('ingestHotPosts lưu bài hot và tự tạo profile nếu chưa có', async () => {
      prismaMock.scraperThreadsProfile.findUnique.mockResolvedValue(null);
      prismaMock.scraperThreadsProfile.create.mockResolvedValue({ id: 99n, username: 'hot_author' });
      prismaMock.scraperThreadsPost.findUnique.mockResolvedValue(null);
      prismaMock.scraperThreadsPost.create.mockResolvedValue({});

      const res = await service.ingestHotPosts([
        {
          post_id: 'hot_p1',
          author_username: 'hot_author',
          text: 'Viral content',
          date_posted: new Date().toISOString(),
        } as any,
      ]);

      expect(res.saved_count).toBe(1);
      expect(prismaMock.scraperThreadsProfile.create).toHaveBeenCalled();
      expect(prismaMock.scraperThreadsPost.create).toHaveBeenCalled();
    });

    it('periodicRefresh tìm các profile tracked và gọi cào định kỳ', async () => {
      prismaMock.scraperThreadsProfile.findMany.mockResolvedValue([
        { id: 10n, username: 'tracked_chan', is_tracked: true },
      ]);
      prismaMock.scraperThreadsProfile.findUnique.mockResolvedValue({
        id: 10n,
        username: 'tracked_chan',
        is_tracked: true,
      });
      aiClientMock.fetchProfilePosts.mockResolvedValue({
        full_profile: null,
        posts: [],
      });

      const res = await service.periodicRefresh({ scope: 'tracked', mode: 'count', count: 20 });
      expect(prismaMock.scraperThreadsProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ is_tracked: true }),
        }),
      );
      expect(res.total).toBe(1);
      expect(res.done).toBe(1);
    });

    it('batchScrape cào danh sách nhiều kênh Threads', async () => {
      prismaMock.scraperThreadsProfile.findUnique.mockResolvedValue({ id: 11n, username: 'chan1' });
      aiClientMock.fetchProfilePosts.mockResolvedValue({
        full_profile: null,
        posts: [],
      });

      const res = await service.batchScrape(['@chan1', 'chan2']);
      expect(res.total).toBe(2);
      expect(res.succeeded).toBe(2);
      expect(res.failed).toBe(0);
    });
  });


  describe('ThreadsScraperReadService', () => {
    let readService: ThreadsScraperReadService;
    let prismaMock: any;

    beforeEach(() => {
      prismaMock = {
        scraperThreadsProfile: {
          count: jest.fn(),
          findMany: jest.fn(),
          findUnique: jest.fn(),
        },
        scraperThreadsPost: {
          count: jest.fn(),
          findMany: jest.fn(),
        },
      };

      readService = new ThreadsScraperReadService(prismaMock);
    });

    it('listProfiles lọc where is_owned = false', async () => {
      prismaMock.scraperThreadsProfile.count.mockResolvedValue(1);
      prismaMock.scraperThreadsProfile.findMany.mockResolvedValue([
        {
          id: 1n,
          username: 'external_chan',
          followers_count: 1000n,
          is_owned: false,
          _count: { posts: 12 },
        },
      ]);

      const res = await readService.listProfiles({ search: 'external' });

      expect(prismaMock.scraperThreadsProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            is_owned: false,
          }),
        }),
      );
      expect(res.items.length).toBe(1);
      expect(res.items[0].posts_count).toBe(12);
      expect(typeof res.items[0].id).toBe('string'); // BigInt đã được serialize an toàn
    });

    it('getProfilePosts phân trang và lọc media_type chính xác', async () => {
      prismaMock.scraperThreadsPost.count.mockResolvedValue(2);
      prismaMock.scraperThreadsPost.findMany.mockResolvedValue([
        { id: 101n, post_id: 'p1', media_type: 'VIDEO', likes_count: 50n },
        { id: 102n, post_id: 'p2', media_type: 'VIDEO', likes_count: 30n },
      ]);

      const res = await readService.getProfilePosts(1n, {
        media_type: 'VIDEO',
        page: 1,
        limit: 10,
      });

      expect(prismaMock.scraperThreadsPost.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            profile_id: 1n,
            media_type: 'VIDEO',
          }),
        }),
      );
      expect(res.items.length).toBe(2);
      expect(res.total).toBe(2);
    });

    it('listAllPosts lấy toàn bộ bài viết từ cả kênh theo dõi và tìm kiếm từ khoá', async () => {
      prismaMock.scraperThreadsPost.count.mockResolvedValue(2);
      prismaMock.scraperThreadsPost.findMany.mockResolvedValue([
        {
          id: 201n,
          post_id: 'post_from_channel',
          media_type: 'VIDEO',
          text: 'Video từ kênh chú ý',
          likes_count: 500n,
          profile: { id: 1n, username: 'channel_user', name: 'Channel User', is_tracked: true },
        },
        {
          id: 202n,
          post_id: 'post_from_keyword',
          media_type: 'TEXT',
          text: 'Bài viết tìm theo từ khoá vàng bạc',
          likes_count: 150n,
          profile: { id: 2n, username: 'keyword_user', name: 'Keyword User', is_tracked: false },
        },
      ]);

      const res = await readService.listAllPosts({
        search: 'vàng bạc',
        media_type: 'ALL',
        page: 1,
        limit: 20,
      });

      expect(prismaMock.scraperThreadsPost.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            profile: expect.objectContaining({
              is_owned: false,
            }),
          }),
        }),
      );
      expect(res.items.length).toBe(2);
      expect(res.total).toBe(2);
      expect(res.items[0].profile.username).toBe('channel_user');
      expect(res.items[1].profile.username).toBe('keyword_user');
    });
  });
});

