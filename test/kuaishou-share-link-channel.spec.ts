import { HttpException, HttpStatus } from '@nestjs/common';
import { KuaishouScraperController } from '../src/modules/kuaishou-scraper/kuaishou-scraper.controller';
import { extractKuaishouEid, isKuaishouShareLink } from '../src/common/utils/channel-url.util';
import { isShortLink } from '../src/common/utils/resolve-short-link.util';

/**
 * Dán link chia sẻ Kuaishou (nút Chia sẻ → Sao chép liên kết: https://www.kuaishou.com/f/<mã>)
 * vào ô "Thêm kênh" bị báo "Không lấy được eid Kuaishou": link không chứa eid và không nằm
 * trong allowlist link rút gọn nên không được resolve.
 *
 * Link đó redirect 302 tới URL video kèm eid tác giả trong query authorId (kiểm chứng thật
 * ngày 2026-10-01 với link mẫu trong FE video-playback.test.ts):
 *   https://www.kuaishou.com/f/X-f2k5KJpiXN1SY
 *   → https://www.kuaishou.com/short-video/3x73wr9tdt7nxqy?...&authorId=3xz63mn6fngqtiq&...
 */
const SHARE_LINK = 'https://www.kuaishou.com/f/X-f2k5KJpiXN1SY';
const RESOLVED =
  'https://www.kuaishou.com/short-video/3x73wr9tdt7nxqy?cc=share_copylink&kpf=PC_WEB&area=homexxbrilliant' +
  '&utm_campaign=pc_share&shareMethod=token&utm_medium=pc_share&kpn=KUAISHOU_VISION&subBiz=SINGLE_ROW_WEB' +
  '&shareId=18140818792114&shareToken=X-f2k5KJpiXN1SY&authorId=3xz63mn6fngqtiq&shareMode=app&efid=0' +
  '&shareObjectId=3x73wr9tdt7nxqy&utm_source=pc_share';
const AUTHOR_EID = '3xz63mn6fngqtiq';

describe('extractKuaishouEid — link video có authorId', () => {
  it('bóc eid tác giả từ URL đích của link chia sẻ', () => {
    expect(extractKuaishouEid(RESOLVED)).toBe(AUTHOR_EID);
  });

  it('bóc eid tác giả từ URL copy trên thanh địa chỉ khi đang xem video', () => {
    expect(
      extractKuaishouEid(`https://www.kuaishou.com/short-video/3x73wr9tdt7nxqy?authorId=${AUTHOR_EID}&streamSource=profile`),
    ).toBe(AUTHOR_EID);
  });

  it('link video KHÔNG có authorId vẫn bị từ chối như cũ', () => {
    expect(extractKuaishouEid('https://www.kuaishou.com/short-video/3x73wr9tdt7nxqy')).toBeNull();
  });

  it('authorId ở domain khác không được nhận', () => {
    expect(extractKuaishouEid(`https://evil.example.com/x?authorId=${AUTHOR_EID}`)).toBeNull();
  });

  it('link profile vẫn ưu tiên như cũ', () => {
    expect(extractKuaishouEid('https://www.kuaishou.com/profile/3xabcdef12345678')).toBe('3xabcdef12345678');
  });
});

describe('isKuaishouShareLink', () => {
  it('nhận link chia sẻ /f/', () => {
    expect(isKuaishouShareLink(SHARE_LINK)).toBe(true);
    expect(isKuaishouShareLink('https://kuaishou.com/f/X-abc')).toBe(true);
  });

  it('không nhận link khác hoặc domain giả mạo', () => {
    expect(isKuaishouShareLink('https://www.kuaishou.com/profile/3xabc')).toBe(false);
    expect(isKuaishouShareLink('https://evil.com/?u=https://www.kuaishou.com/f/X-abc')).toBe(false);
  });

  it('không đổi allowlist chung — video-library vẫn lưu nguyên link /f/ để phát video', () => {
    expect(isShortLink(SHARE_LINK)).toBe(false);
  });
});

describe('KuaishouScraperController.profileScrape — dán link chia sẻ', () => {
  let fetchSpy: jest.SpyInstance;
  const service = { scrapeProfile: jest.fn().mockResolvedValue({ status: 'ok' }) };

  beforeEach(() => {
    service.scrapeProfile.mockClear();
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ url: RESOLVED } as Response);
  });
  afterEach(() => fetchSpy.mockRestore());

  it('link /f/ → follow redirect → cào đúng kênh tác giả', async () => {
    const controller = new KuaishouScraperController(service as any, {} as any);
    await controller.profileScrape({ eid: SHARE_LINK, num_of_posts: 20 });

    expect(fetchSpy).toHaveBeenCalledWith(SHARE_LINK, expect.objectContaining({ redirect: 'follow' }));
    expect(service.scrapeProfile).toHaveBeenCalledWith(AUTHOR_EID, 20);
  });

  it('đoạn chữ chia sẻ từ app (lẫn tiếng Trung) vẫn bóc được link', async () => {
    const controller = new KuaishouScraperController(service as any, {} as any);
    await controller.profileScrape({ eid: `看看这个作品 ${SHARE_LINK} 复制此链接，打开快手` });
    expect(service.scrapeProfile).toHaveBeenCalledWith(AUTHOR_EID, expect.anything());
  });

  it('link chia sẻ chết (không ra authorId) → 400 rõ ràng, không cào', async () => {
    fetchSpy.mockResolvedValue({ url: 'https://www.kuaishou.com/new-reco' } as Response);
    const controller = new KuaishouScraperController(service as any, {} as any);
    const err = await controller.profileScrape({ eid: SHARE_LINK }).catch((e) => e);

    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(service.scrapeProfile).not.toHaveBeenCalled();
  });

  it('link profile thường không gọi mạng', async () => {
    const controller = new KuaishouScraperController(service as any, {} as any);
    await controller.profileScrape({ eid: 'https://www.kuaishou.com/profile/3xabcdef12345678' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(service.scrapeProfile).toHaveBeenCalledWith('3xabcdef12345678', expect.anything());
  });
});
