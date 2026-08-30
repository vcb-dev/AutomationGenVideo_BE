import axios from 'axios';
import { InstagramPublisher } from '../publish/platforms/instagram.platform';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/** Ghi lại params của mọi lần tạo container để soi payload gửi lên Instagram */
function setupAxios() {
  const containerCalls: any[] = [];
  let counter = 0;

  mockedAxios.post.mockImplementation((url: any, data?: any) => {
    if (String(url).includes('/media_publish')) {
      return Promise.resolve({ data: { id: 'IG_POST_1' } } as any);
    }
    if (String(url).includes('/media')) {
      containerCalls.push(data);
      return Promise.resolve({ data: { id: `CONTAINER_${++counter}` } } as any);
    }
    return Promise.resolve({ data: {} } as any);
  });

  // waitForContainer đọc status_code, getPermalink đọc permalink — trả cả hai
  mockedAxios.get.mockResolvedValue({
    data: { status_code: 'FINISHED', permalink: 'https://instagram.com/p/abc' },
  } as any);

  return containerCalls;
}

describe('InstagramPublisher — media_type cho video', () => {
  let publisher: InstagramPublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    publisher = new InstagramPublisher();
  });

  it('video đăng đơn lẻ dùng REELS kèm share_to_feed', async () => {
    const containers = setupAxios();

    await publisher.publish('token', {
      caption: 'reel đơn',
      mediaUrls: ['https://cdn.example.com/clip.mp4'],
      igUserId: 'IG1',
      accountType: 'instagram_business',
    });

    expect(containers).toHaveLength(1);
    expect(containers[0].media_type).toBe('REELS');
    expect(containers[0].share_to_feed).toBe('true');
    expect(containers[0].video_url).toBe('https://cdn.example.com/clip.mp4');
  });

  it('video làm phần tử con của carousel dùng VIDEO, không phải REELS — docs: "reels are not supported" cho carousel item', async () => {
    const containers = setupAxios();

    await publisher.publish('token', {
      caption: 'carousel',
      mediaUrls: ['https://cdn.example.com/clip.mp4', 'https://cdn.example.com/photo.jpg'],
      igUserId: 'IG1',
      accountType: 'instagram_business',
    });

    const videoChild = containers.find((c) => c.video_url);
    expect(videoChild.media_type).toBe('VIDEO');
    expect(videoChild.is_carousel_item).toBe(true);
  });

  it('phần tử con của carousel KHÔNG gửi share_to_feed — tham số này vô nghĩa với item con', async () => {
    const containers = setupAxios();

    await publisher.publish('token', {
      caption: 'carousel',
      mediaUrls: ['https://cdn.example.com/clip.mp4', 'https://cdn.example.com/photo.jpg'],
      igUserId: 'IG1',
      accountType: 'instagram_business',
    });

    const videoChild = containers.find((c) => c.video_url);
    expect(videoChild.share_to_feed).toBeUndefined();
  });

  it('container CAROUSEL cha vẫn gom đủ children', async () => {
    const containers = setupAxios();

    await publisher.publish('token', {
      caption: 'carousel',
      mediaUrls: ['https://cdn.example.com/clip.mp4', 'https://cdn.example.com/photo.jpg'],
      igUserId: 'IG1',
      accountType: 'instagram_business',
    });

    const parent = containers.find((c) => c.media_type === 'CAROUSEL');
    expect(parent.children.split(',')).toHaveLength(2);
    expect(parent.caption).toBe('carousel');
  });

  it('nhận diện được video dạng ?filename=x.mp4 sau khi gom về util chung', async () => {
    const containers = setupAxios();

    await publisher.publish('token', {
      caption: 'drive style',
      mediaUrls: ['https://www.googleapis.com/drive/v3/files/ID?alt=media&filename=reel.mp4'],
      igUserId: 'IG1',
      accountType: 'instagram_business',
    });

    expect(containers[0].media_type).toBe('REELS');
    expect(containers[0].image_url).toBeUndefined();
  });
});
