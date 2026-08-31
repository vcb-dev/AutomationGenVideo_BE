import axios from 'axios';
import { SocialPlatform } from '@prisma/client';
import { AvatarService } from './avatar.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const cryptoStub: any = { decrypt: jest.fn().mockReturnValue('token-da-giai-ma') };
const prismaStub: any = { socialAccount: { findUnique: jest.fn() } };

function makeService(): any {
  return new AvatarService(prismaStub, cryptoStub);
}

describe('AvatarService — thứ tự URL sẽ thử', () => {
  let service: any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('Facebook: dạng vĩnh viễn đứng TRƯỚC URL đã lưu — nó không bao giờ hết hạn', async () => {
    const urls = await service.candidateUrls({
      platform: SocialPlatform.FACEBOOK,
      platform_id: '123',
      avatar_url: 'https://scontent.xx.fbcdn.net/anh.jpg?oe=DEADBEEF',
    });

    expect(urls[0]).toBe('https://graph.facebook.com/123/picture?type=large');
    expect(urls[1]).toContain('scontent');
  });

  it('Facebook: bỏ tiền tố "page_" khỏi platform_id trước khi ghép vào URL', async () => {
    const urls = await service.candidateUrls({
      platform: SocialPlatform.FACEBOOK,
      platform_id: 'page_456',
      avatar_url: null,
    });

    expect(urls[0]).toBe('https://graph.facebook.com/456/picture?type=large');
  });

  it('Instagram: hỏi Graph API lấy URL mới, vì Instagram không có dạng vĩnh viễn', async () => {
    mockedAxios.get.mockResolvedValue({ data: { profile_picture_url: 'https://cdn/moi.jpg' } } as any);

    const urls = await service.candidateUrls({
      platform: SocialPlatform.INSTAGRAM,
      platform_id: 'IG1',
      avatar_url: 'https://scontent.xx.fbcdn.net/cu.jpg?oe=DEADBEEF',
      access_token_enc: 'enc',
      extra_data: { igUserId: 'IG_USER_1' },
    });

    expect(urls).toContain('https://cdn/moi.jpg');
    expect(String(mockedAxios.get.mock.calls[0][0])).toContain('IG_USER_1');
  });

  it('Instagram: Graph API lỗi thì vẫn trả URL đã lưu, không ném lỗi', async () => {
    mockedAxios.get.mockRejectedValue(new Error('token het han'));

    const urls = await service.candidateUrls({
      platform: SocialPlatform.INSTAGRAM,
      platform_id: 'IG1',
      avatar_url: 'https://scontent.xx.fbcdn.net/cu.jpg',
      access_token_enc: 'enc',
      extra_data: {},
    });

    expect(urls).toEqual(['https://scontent.xx.fbcdn.net/cu.jpg']);
  });

  it('Instagram: thiếu token thì không gọi Graph API', async () => {
    const urls = await service.candidateUrls({
      platform: SocialPlatform.INSTAGRAM,
      platform_id: 'IG1',
      avatar_url: 'https://scontent.xx.fbcdn.net/cu.jpg',
      access_token_enc: null,
      extra_data: {},
    });

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(urls).toHaveLength(1);
  });

  it('Threads: hỏi API Threads lấy URL mới — dùng host và tên trường riêng, không phải của Instagram', async () => {
    mockedAxios.get.mockResolvedValue({ data: { threads_profile_picture_url: 'https://cdn/threads-moi.jpg' } } as any);

    const urls = await service.candidateUrls({
      platform: SocialPlatform.THREADS,
      platform_id: 'TH1',
      avatar_url: 'https://cdninstagram.com/cu.jpg',
      access_token_enc: 'enc',
      extra_data: { platformId: 'TH_USER_1' },
    });

    expect(urls).toContain('https://cdn/threads-moi.jpg');
    expect(String(mockedAxios.get.mock.calls[0][0])).toContain('graph.threads.net');
    expect(String(mockedAxios.get.mock.calls[0][0])).toContain('TH_USER_1');
  });

  it('Threads: API lỗi thì vẫn trả URL đã lưu, không ném lỗi', async () => {
    mockedAxios.get.mockRejectedValue(new Error('token het han'));

    const urls = await service.candidateUrls({
      platform: SocialPlatform.THREADS,
      platform_id: 'TH1',
      avatar_url: 'https://cdninstagram.com/cu.jpg',
      access_token_enc: 'enc',
      extra_data: {},
    });

    expect(urls).toEqual(['https://cdninstagram.com/cu.jpg']);
  });

  it('không có avatar_url và không phải Facebook thì không có gì để thử', async () => {
    const urls = await service.candidateUrls({
      platform: SocialPlatform.YOUTUBE,
      platform_id: 'YT1',
      avatar_url: null,
    });

    expect(urls).toEqual([]);
  });
});

describe('AvatarService — resolveAvatarFile', () => {
  let service: any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('tài khoản không tồn tại thì trả null thay vì ném lỗi', async () => {
    prismaStub.socialAccount.findUnique.mockResolvedValue(null);
    await expect(service.resolveAvatarFile('khong-co-that')).resolves.toBeNull();
  });

  it('mọi URL đều hỏng và không có cache cũ thì trả null — giao diện tự hiện chữ cái đầu', async () => {
    prismaStub.socialAccount.findUnique.mockResolvedValue({
      id: 'A1', platform: SocialPlatform.THREADS, platform_id: 'TH1',
      avatar_url: 'https://cdninstagram.com/chet.jpg', access_token_enc: null, extra_data: {},
    });
    mockedAxios.get.mockRejectedValue({ response: { status: 403 } });

    await expect(service.resolveAvatarFile('A1')).resolves.toBeNull();
  });
});
