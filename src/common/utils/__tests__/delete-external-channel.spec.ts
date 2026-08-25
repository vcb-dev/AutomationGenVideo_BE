import { FacebookExternalScraperService } from '../../../modules/facebook-external-scraper/facebook-external-scraper.service';
import { XiaohongshuScraperService } from '../../../modules/xiaohongshu-scraper/xiaohongshu-scraper.service';
import { DouyinScraperService } from '../../../modules/douyin-scraper/douyin-scraper.service';
import { TiktokScraperService } from '../../../modules/tiktok-scraper/tiktok-scraper.service';
import { InstagramScraperService } from '../../../modules/instagram-scraper/instagram-scraper.service';
import { YoutubeScraperService } from '../../../modules/youtube-scraper/youtube-scraper.service';
import { KuaishouScraperService } from '../../../modules/kuaishou-scraper/kuaishou-scraper.service';
import { BilibiliScraperService } from '../../../modules/bilibili-scraper/bilibili-scraper.service';

/**
 * Xoá cứng một kênh khám phá bên ngoài.
 *
 * Kênh khám phá kéo về rất nhiều page rác (page 14 follower, không có reel nào), nên cần
 * nút dọn. Xoá ở đây là xoá cứng: bản ghi kênh biến mất kèm toàn bộ video/reels, lịch sử
 * chỉ số và liên kết từ khoá của nó — không khôi phục được.
 *
 * Ba nền tảng nối video với kênh theo ba kiểu khác nhau, nên "xoá kèm video" không tự động
 * đúng ở mọi nơi:
 *   - Facebook/TikTok/Instagram/YouTube/KuaiShou/Bilibili: khoá ngoại onDelete Cascade,
 *     Postgres tự dọn con.
 *   - XiaoHongShu: onDelete SetNull — xoá kênh chỉ làm video mồ côi, phải tự xoá.
 *   - Douyin: không có khoá ngoại, video nối bằng chuỗi search_keyword = '@username'.
 *
 * Vì số video sẽ mất được hiện lên hộp xác nhận trước khi người dùng bấm, con số service
 * trả về phải là số thật, không phải ước lượng.
 */

const FANPAGE = {
  id: 7n,
  profile_id: '100065437811374',
  name: 'HAPAS Official',
  handle: 'hapas.official',
};

function buildFacebook(fanpage: any = FANPAGE, reelCount = 42) {
  const prisma: any = {
    scraperFanpage: {
      findUnique: jest.fn(async () => fanpage),
      delete: jest.fn(async () => fanpage),
    },
    scraperFacebookReel: {
      count: jest.fn(async () => reelCount),
    },
  };
  const aiClient: any = { fetchPageReels: jest.fn() };
  const service = new FacebookExternalScraperService(prisma, aiClient);
  return { service, prisma };
}

describe('Facebook — xoá cứng fanpage khám phá', () => {
  it('xoá đúng fanpage được chỉ định', async () => {
    const { service, prisma } = buildFacebook();

    await service.deleteFanpage(7n);

    expect(prisma.scraperFanpage.delete).toHaveBeenCalledWith({ where: { id: 7n } });
  });

  it('trả về số reels thật sự bị xoá kèm, để hộp xác nhận không nói dối', async () => {
    const { service } = buildFacebook(FANPAGE, 42);

    const result = await service.deleteFanpage(7n);

    expect(result.videos_deleted).toBe(42);
    expect(result.name).toBe('HAPAS Official');
  });

  it('kênh không tồn tại thì báo lỗi và KHÔNG gọi xoá', async () => {
    const { service, prisma } = buildFacebook(null);

    await expect(service.deleteFanpage(999n)).rejects.toThrow();
    expect(prisma.scraperFanpage.delete).not.toHaveBeenCalled();
  });

  it('người dùng xoá kênh giữa lúc đang cào thì lượt cào dừng êm, không nổ 500', async () => {
    // Nút xoá cho phép bấm bất kể trạng thái, mà scrapeByUrl chạy batch đầu đồng bộ rồi
    // còn dispatch tiếp phần nền. Xoá đúng lúc đó thì applyFanpageUpdate gọi update() lên
    // một id vừa biến mất — Prisma ném "Record to update not found" và người dùng nhận 500
    // cho một thao tác họ đã chủ động huỷ.
    const { service, prisma } = buildFacebook();
    prisma.scraperFanpage.findUnique.mockResolvedValue(null);
    prisma.scraperFanpage.update = jest.fn(async () => {
      throw new Error('Record to update not found');
    });

    const result = await (service as any).ingestFetchedData(7n, {
      profile_id: '100065437811374',
      name: 'HAPAS Official',
      page_url: '',
      handle: '',
      avatar_url: '',
      is_verified: null,
      followers_count: 0,
    }, []);

    expect(result.fanpage_id).toBeNull();
    expect(prisma.scraperFanpage.update).not.toHaveBeenCalled();
  });

  it('đếm reels TRƯỚC khi xoá — đếm sau thì cascade đã dọn sạch, luôn ra 0', async () => {
    const { service, prisma } = buildFacebook();
    const order: string[] = [];
    prisma.scraperFacebookReel.count.mockImplementation(async () => {
      order.push('count');
      return 42;
    });
    prisma.scraperFanpage.delete.mockImplementation(async () => {
      order.push('delete');
      return FANPAGE;
    });

    await service.deleteFanpage(7n);

    expect(order).toEqual(['count', 'delete']);
  });
});

const XHS_PROFILE = { id: 12n, user_id: 'xhs_abc123', nickname: 'Kênh XHS' };

function buildXhs(profile: any = XHS_PROFILE, videoCount = 8) {
  const prisma: any = {
    scraperXiaohongshuProfile: {
      findUnique: jest.fn(async () => profile),
      delete: jest.fn(async () => profile),
    },
    scraperXiaohongshuVideo: {
      count: jest.fn(async () => videoCount),
      deleteMany: jest.fn(async () => ({ count: videoCount })),
    },
  };
  const service = new XiaohongshuScraperService(prisma, {} as any, {} as any, {} as any);
  return { service, prisma };
}

describe('XiaoHongShu — xoá cứng kênh', () => {
  it('XOÁ HẲN video chứ không để mồ côi', async () => {
    // Khoá ngoại XHS là onDelete SetNull, khác 6 nền tảng cascade. Nếu chỉ xoá profile,
    // video ở lại với profile_id = null: không còn hiện ở kênh nào, không xoá được qua UI,
    // nhưng vẫn chiếm chỗ và vẫn lọt vào các truy vấn gom toàn bộ video.
    const { service, prisma } = buildXhs();

    await service.deleteProfile(12n);

    expect(prisma.scraperXiaohongshuVideo.deleteMany).toHaveBeenCalledWith({
      where: { profile_id: 12n },
    });
  });

  it('xoá video TRƯỚC rồi mới xoá kênh', async () => {
    const { service, prisma } = buildXhs();
    const order: string[] = [];
    prisma.scraperXiaohongshuVideo.deleteMany.mockImplementation(async () => {
      order.push('videos');
      return { count: 8 };
    });
    prisma.scraperXiaohongshuProfile.delete.mockImplementation(async () => {
      order.push('profile');
      return XHS_PROFILE;
    });

    await service.deleteProfile(12n);

    expect(order).toEqual(['videos', 'profile']);
  });

  it('báo đúng số video đã xoá và tên kênh', async () => {
    const { service } = buildXhs(XHS_PROFILE, 8);

    const result = await service.deleteProfile(12n);

    expect(result.videos_deleted).toBe(8);
    expect(result.name).toBe('Kênh XHS');
  });

  it('kênh không tồn tại thì báo lỗi và KHÔNG xoá video nào', async () => {
    const { service, prisma } = buildXhs(null);

    await expect(service.deleteProfile(999n)).rejects.toThrow();
    expect(prisma.scraperXiaohongshuVideo.deleteMany).not.toHaveBeenCalled();
  });
});

const DOUYIN_PROFILE = { id: 30n, sec_user_id: 'MS4wLjABAAAA', username: 'chandung', nickname: 'Chân Dung' };

function buildDouyin(profile: any = DOUYIN_PROFILE, videoCount = 15) {
  const prisma: any = {
    scraperDouyinProfile: {
      findUnique: jest.fn(async () => profile),
      delete: jest.fn(async () => profile),
    },
    scraperDouyinVideo: {
      deleteMany: jest.fn(async () => ({ count: videoCount })),
    },
  };
  const service = new DouyinScraperService(prisma, {} as any, {} as any, {} as any, {} as any);
  return { service, prisma };
}

describe('Douyin — xoá cứng kênh', () => {
  it('xoá video theo đúng chuỗi search_keyword = "@username"', async () => {
    // Douyin không có khoá ngoại từ video sang profile. Lúc cào theo kênh, service ghi
    // search_keyword = '@' + username, và đó là mối nối duy nhất giữa video với kênh.
    const { service, prisma } = buildDouyin();

    await service.deleteProfile(30n);

    expect(prisma.scraperDouyinVideo.deleteMany).toHaveBeenCalledWith({
      where: { search_keyword: '@chandung' },
    });
  });

  it('kênh chưa có username thì KHÔNG được xoá video nào', async () => {
    // Profile tạo từ sec_user_id trước lần cào đầu chưa có username. Ghép '@' + '' ra
    // chuỗi '@' — đem đi deleteMany sẽ quét trúng video của kênh khác, hoặc quét bừa.
    const { service, prisma } = buildDouyin({ ...DOUYIN_PROFILE, username: '' });

    const result = await service.deleteProfile(30n);

    expect(prisma.scraperDouyinVideo.deleteMany).not.toHaveBeenCalled();
    expect(result.videos_deleted).toBe(0);
    expect(prisma.scraperDouyinProfile.delete).toHaveBeenCalled();
  });

  it('kênh không tồn tại thì báo lỗi', async () => {
    const { service } = buildDouyin(null);
    await expect(service.deleteProfile(999n)).rejects.toThrow();
  });
});

/**
 * Năm nền tảng còn lại đều dùng khoá ngoại onDelete Cascade như Facebook, nên hợp đồng
 * hành vi giống hệt nhau. Gom vào một bảng để mỗi nền tảng mới thêm vào chỉ tốn một dòng,
 * và để lệch chuẩn ở bất kỳ nền tảng nào cũng lộ ra ngay.
 */
const CASCADE_PLATFORMS = [
  {
    label: 'TikTok',
    profileModel: 'scraperTikTokProfile',
    videoModel: 'scraperTikTokProfileVideo',
    row: { id: 1n, username: 'abc', nickname: 'Kênh TikTok' },
    expectedName: 'Kênh TikTok',
    make: (p: any) => new TiktokScraperService(p, {} as any, {} as any, {} as any),
  },
  {
    label: 'Instagram',
    profileModel: 'scraperInstagramProfile',
    videoModel: 'scraperInstagramReel',
    row: { id: 2n, username: 'ig_user', full_name: 'Kênh IG' },
    expectedName: 'Kênh IG',
    make: (p: any) => new InstagramScraperService(p, {} as any),
  },
  {
    label: 'YouTube',
    profileModel: 'scraperYoutubeProfile',
    videoModel: 'scraperYoutubeShort',
    row: { id: 3n, channel_id: 'UC123', title: 'Kênh YT' },
    expectedName: 'Kênh YT',
    make: (p: any) => new YoutubeScraperService(p, {} as any, {} as any),
  },
  {
    label: 'KuaiShou',
    profileModel: 'scraperKuaishouProfile',
    videoModel: 'scraperKuaishouVideo',
    row: { id: 4n, user_id: 'ks1', username: 'ks_user', nickname: 'Kênh KS' },
    expectedName: 'Kênh KS',
    make: (p: any) => new KuaishouScraperService(p, {} as any, {} as any, {} as any, {} as any),
  },
  {
    label: 'Bilibili',
    profileModel: 'scraperBilibiliProfile',
    videoModel: 'scraperBilibiliVideo',
    row: { id: 5n, mid: '999', username: 'bili_user', nickname: 'Kênh Bili' },
    expectedName: 'Kênh Bili',
    make: (p: any) => new BilibiliScraperService(p, {} as any, {} as any, {} as any, {} as any),
  },
];

describe.each(CASCADE_PLATFORMS)(
  '$label — xoá cứng kênh (cascade)',
  ({ profileModel, videoModel, row, expectedName, make }) => {
    function build(profile: any = row, videoCount = 23) {
      const prisma: any = {
        [profileModel]: {
          findUnique: jest.fn(async () => profile),
          delete: jest.fn(async () => profile),
        },
        [videoModel]: { count: jest.fn(async () => videoCount) },
      };
      return { service: make(prisma) as any, prisma };
    }

    it('xoá đúng kênh được chỉ định', async () => {
      const { service, prisma } = build();
      await service.deleteProfile(row.id);
      expect(prisma[profileModel].delete).toHaveBeenCalledWith({ where: { id: row.id } });
    });

    it('đếm video TRƯỚC khi xoá, nếu không cascade đã dọn sạch và luôn ra 0', async () => {
      const { service, prisma } = build();
      const order: string[] = [];
      prisma[videoModel].count.mockImplementation(async () => {
        order.push('count');
        return 23;
      });
      prisma[profileModel].delete.mockImplementation(async () => {
        order.push('delete');
        return row;
      });

      const result = await service.deleteProfile(row.id);

      expect(order).toEqual(['count', 'delete']);
      expect(result.videos_deleted).toBe(23);
    });

    it('trả về tên kênh cho FE báo lại người dùng', async () => {
      const { service } = build();
      const result = await service.deleteProfile(row.id);
      expect(result.name).toBe(expectedName);
    });

    it('kênh không tồn tại thì báo lỗi và KHÔNG gọi xoá', async () => {
      const { service, prisma } = build(null);
      await expect(service.deleteProfile(404n)).rejects.toThrow();
      expect(prisma[profileModel].delete).not.toHaveBeenCalled();
    });
  },
);
