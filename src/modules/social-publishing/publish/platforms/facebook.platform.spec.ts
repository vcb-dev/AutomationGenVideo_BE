import axios from 'axios';
import { FacebookPublisher } from './facebook.platform';

jest.mock('axios');
jest.mock('../media-probe.util', () => ({
  ...jest.requireActual('../media-probe.util'),
  probeMedia: jest.fn(),
  // Trả null để nhánh cắt ảnh bìa bằng ffmpeg thoát sớm, test không đụng ffmpeg thật.
  resolveFFmpegPath: jest.fn(() => null),
}));

import { probeMedia } from '../media-probe.util';

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedProbe = probeMedia as jest.MockedFunction<typeof probeMedia>;

/** Prisma chỉ được dùng để tra thumbnail — trả null là đủ cho các ca ở đây. */
const prismaStub: any = { socialUploadedFile: { findFirst: jest.fn().mockResolvedValue(null) } };

function probeResult(durationSec: number | null) {
  return { durationSec, width: 1080, height: 1920, hasVideo: true, hasAudio: true };
}

/** Ghi lại mọi lời gọi POST để khẳng định endpoint nào được dùng */
function setupAxios() {
  const calls: { url: string; params?: any }[] = [];
  mockedAxios.post.mockImplementation((url: any, _data?: any, config?: any) => {
    calls.push({ url, params: config?.params });
    if (String(url).includes('/video_reels')) {
      return Promise.resolve({ data: { video_id: 'REEL_123', upload_url: 'https://rupload.facebook.com/video-upload/v21.0/REEL_123' } } as any);
    }
    if (String(url).includes('rupload.facebook.com')) {
      return Promise.resolve({ data: { success: true } } as any);
    }
    if (String(url).includes('/videos')) {
      return Promise.resolve({ data: { id: 'VIDEO_456' } } as any);
    }
    return Promise.resolve({ data: {} } as any);
  });
  return calls;
}

describe('FacebookPublisher — định tuyến Reels theo thời lượng', () => {
  let publisher: FacebookPublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    publisher = new FacebookPublisher(prismaStub);
  });

  it('video 30s đi qua /video_reels — /videos chỉ tới người đã follow nên mất hẳn Reels feed', async () => {
    mockedProbe.mockResolvedValue(probeResult(30));
    const calls = setupAxios();

    const result = await publisher.publish('page-token', {
      message: 'reel test',
      mediaUrls: ['https://cdn.example.com/clip.mp4'],
      extraData: { pageId: 'PAGE1', type: 'page' },
    });

    const urls = calls.map(c => c.url);
    expect(urls.some(u => u.includes('/PAGE1/video_reels'))).toBe(true);
    expect(urls.some(u => u.includes('/PAGE1/videos'))).toBe(false);
    expect(result.postId).toBe('REEL_123');
  });

  it('gọi đủ 3 pha start → rupload → finish với video_state=PUBLISHED', async () => {
    mockedProbe.mockResolvedValue(probeResult(45));
    const calls = setupAxios();

    await publisher.publish('page-token', {
      message: 'reel test',
      mediaUrls: ['https://cdn.example.com/clip.mp4'],
      extraData: { pageId: 'PAGE1', type: 'page' },
    });

    expect(calls[0].params.upload_phase).toBe('start');
    expect(calls[1].url).toContain('rupload.facebook.com');
    expect(calls[2].params.upload_phase).toBe('finish');
    expect(calls[2].params.video_state).toBe('PUBLISHED');
    expect(calls[2].params.video_id).toBe('REEL_123');
  });

  it('video 120s vượt 90s → lui về /videos thay vì lỗi, vì Facebook vẫn có video thường', async () => {
    mockedProbe.mockResolvedValue(probeResult(120));
    const calls = setupAxios();

    const result = await publisher.publish('page-token', {
      message: 'video dài',
      mediaUrls: ['https://cdn.example.com/long.mp4'],
      extraData: { pageId: 'PAGE1', type: 'page' },
    });

    const urls = calls.map(c => c.url);
    expect(urls.some(u => u.includes('/PAGE1/videos'))).toBe(true);
    expect(urls.some(u => u.includes('/video_reels'))).toBe(false);
    expect(result.postId).toBe('VIDEO_456');
  });

  it('video 2s ngắn hơn 3s → lui về /videos', async () => {
    mockedProbe.mockResolvedValue(probeResult(2));
    const calls = setupAxios();

    await publisher.publish('page-token', {
      message: 'quá ngắn',
      mediaUrls: ['https://cdn.example.com/short.mp4'],
      extraData: { pageId: 'PAGE1', type: 'page' },
    });

    expect(calls.map(c => c.url).some(u => u.includes('/videos'))).toBe(true);
  });

  it('không đọc được thời lượng → giữ hành vi cũ (/videos), không đoán mò', async () => {
    mockedProbe.mockResolvedValue(null);
    const calls = setupAxios();

    await publisher.publish('page-token', {
      message: 'không probe được',
      mediaUrls: ['https://cdn.example.com/unknown.mp4'],
      extraData: { pageId: 'PAGE1', type: 'page' },
    });

    expect(calls.map(c => c.url).some(u => u.includes('/videos'))).toBe(true);
  });
});

describe('FacebookPublisher — media hỗn hợp', () => {
  let publisher: FacebookPublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    publisher = new FacebookPublisher(prismaStub);
  });

  it('báo lỗi rõ khi có video lẫn ảnh — trước đây chỉ đăng phần tử đầu và bỏ im lặng phần còn lại', async () => {
    mockedProbe.mockResolvedValue(probeResult(30));
    setupAxios();

    await expect(
      publisher.publish('page-token', {
        message: 'hỗn hợp',
        mediaUrls: ['https://cdn.example.com/clip.mp4', 'https://cdn.example.com/photo.jpg'],
        extraData: { pageId: 'PAGE1', type: 'page' },
      }),
    ).rejects.toThrow(/không đăng được video chung với media khác/);
  });

  it('dùng lại thời lượng do cổng kiểm tra đo được, không chạy ffprobe lần hai', async () => {
    const calls = setupAxios();

    await publisher.publish('page-token', {
      message: 'đã probe sẵn',
      mediaUrls: ['https://cdn.example.com/clip.mp4'],
      extraData: { pageId: 'PAGE1', type: 'page' },
      videoDurationSec: 30,
    });

    expect(mockedProbe).not.toHaveBeenCalled();
    expect(calls.map(c => c.url).some(u => u.includes('/video_reels'))).toBe(true);
  });

  it('videoDurationSec=null từ cổng kiểm tra vẫn lui về /videos, không tự probe lại', async () => {
    const calls = setupAxios();

    await publisher.publish('page-token', {
      message: 'không đo được',
      mediaUrls: ['https://cdn.example.com/clip.mp4'],
      extraData: { pageId: 'PAGE1', type: 'page' },
      videoDurationSec: null,
    });

    expect(mockedProbe).not.toHaveBeenCalled();
    expect(calls.map(c => c.url).some(u => u.includes('/videos'))).toBe(true);
  });

  it('nhận diện được video dạng ?filename=x.mp4 — biểu thức cũ của Facebook bỏ sót và đẩy vào /photos', async () => {
    mockedProbe.mockResolvedValue(probeResult(30));
    const calls = setupAxios();

    await publisher.publish('page-token', {
      message: 'drive style',
      mediaUrls: ['https://www.googleapis.com/drive/v3/files/ID?alt=media&filename=reel.mp4'],
      extraData: { pageId: 'PAGE1', type: 'page' },
    });

    const urls = calls.map(c => c.url);
    expect(urls.some(u => u.includes('/photos'))).toBe(false);
    expect(urls.some(u => u.includes('/video_reels'))).toBe(true);
  });
});

describe('FacebookPublisher — dọn ảnh mồ côi khi carousel hỏng dở', () => {
  let publisher: FacebookPublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    publisher = new FacebookPublisher(prismaStub);
    mockedAxios.delete.mockResolvedValue({ data: { success: true } } as any);
  });

  it('xoá ảnh đã upload khi một ảnh trong bộ thất bại — nếu không, mỗi lần retry lại đẻ thêm một bộ ảnh ẩn trên Page', async () => {
    let uploaded = 0;
    mockedAxios.post.mockImplementation((url: any) => {
      if (String(url).includes('/photos')) {
        uploaded++;
        // Ảnh thứ hai hỏng vĩnh viễn (400 → không retry)
        if (uploaded === 2) {
          return Promise.reject({ response: { status: 400, data: { error: 'bad image' } } });
        }
        return Promise.resolve({ data: { id: `PHOTO_${uploaded}` } } as any);
      }
      return Promise.resolve({ data: {} } as any);
    });

    await expect(
      publisher.publish('page-token', {
        message: 'carousel hỏng',
        mediaUrls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
        extraData: { pageId: 'PAGE1', type: 'page' },
      }),
    ).rejects.toThrow(/Chỉ upload thành công 1\/2 ảnh/);

    expect(mockedAxios.delete).toHaveBeenCalledTimes(1);
    expect(String(mockedAxios.delete.mock.calls[0][0])).toContain('PHOTO_1');
  });

  it('xoá ảnh đã upload khi tạo bài feed thất bại', async () => {
    let uploaded = 0;
    mockedAxios.post.mockImplementation((url: any) => {
      if (String(url).includes('/photos')) {
        return Promise.resolve({ data: { id: `PHOTO_${++uploaded}` } } as any);
      }
      if (String(url).includes('/feed')) {
        return Promise.reject({ response: { status: 400, data: { error: 'feed hỏng' } } });
      }
      return Promise.resolve({ data: {} } as any);
    });

    await expect(
      publisher.publish('page-token', {
        message: 'feed hỏng',
        mediaUrls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
        extraData: { pageId: 'PAGE1', type: 'page' },
      }),
    ).rejects.toThrow(/carousel feed post failed/);

    expect(mockedAxios.delete).toHaveBeenCalledTimes(2);
  });
});
