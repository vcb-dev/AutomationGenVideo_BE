import axios from 'axios';
import { YoutubePublisher } from '../publish/platforms/youtube.platform';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const VIDEO_URL = 'https://cdn.example.com/clip.mp4';
const SESSION_URL = 'https://upload.googleapis.com/session/abc';
const FILE_SIZE = 1000;

/** Luồng giả — chỉ cần có destroy() để code dọn dẹp gọi được */
function fakeStream(contentLength: number | null, status = 200) {
  return {
    status,
    headers: contentLength === null ? {} : { 'content-length': String(contentLength) },
    data: { destroy: jest.fn() },
  };
}

/** Phân biệt PUT hỏi mốc (Content-Range: bytes *\/N) với PUT nạp dữ liệu */
function isOffsetQuery(config?: any): boolean {
  return String(config?.headers?.['Content-Range'] ?? '').startsWith('bytes */');
}

describe('YoutubePublisher — kích thước file và metadata', () => {
  let publisher: YoutubePublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    publisher = new YoutubePublisher();
    mockedAxios.post.mockResolvedValue({ headers: { location: SESSION_URL } } as any);
    mockedAxios.put.mockResolvedValue({ data: { id: 'YT_1' } } as any);
  });

  it('lấy Content-Length từ chính luồng tải, không mở request HEAD riêng — hai request có thể trả kích thước khác nhau', async () => {
    mockedAxios.get.mockResolvedValue(fakeStream(FILE_SIZE) as any);

    await publisher.publish('token', { title: 'Tiêu đề', mediaUrls: [VIDEO_URL] });

    expect(mockedAxios.head).not.toHaveBeenCalled();
    const initCall = mockedAxios.post.mock.calls[0];
    expect((initCall[2] as any).headers['X-Upload-Content-Length']).toBe(FILE_SIZE);
  });

  it('quay lại đo bằng HEAD khi luồng tải không khai content-length', async () => {
    mockedAxios.get.mockResolvedValue(fakeStream(null) as any);
    mockedAxios.head.mockResolvedValue({ headers: { 'content-length': '2048' } } as any);

    await publisher.publish('token', { title: 'Tiêu đề', mediaUrls: [VIDEO_URL] });

    expect(mockedAxios.head).toHaveBeenCalled();
    const initCall = mockedAxios.post.mock.calls[0];
    expect((initCall[2] as any).headers['X-Upload-Content-Length']).toBe(2048);
  });

  it('gửi tags lên YouTube — trước đây trường này luôn là mảng rỗng', async () => {
    mockedAxios.get.mockResolvedValue(fakeStream(FILE_SIZE) as any);

    await publisher.publish('token', {
      title: 'Món ngon',
      mediaUrls: [VIDEO_URL],
      tags: ['anuong', 'monngon'],
    });

    const metadata = mockedAxios.post.mock.calls[0][1] as any;
    expect(metadata.snippet.tags).toEqual(['anuong', 'monngon']);
  });
});

describe('YoutubePublisher — tiếp tục upload dở dang', () => {
  let publisher: YoutubePublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    publisher = new YoutubePublisher();
    mockedAxios.post.mockResolvedValue({ headers: { location: SESSION_URL } } as any);
  });

  it('đứt giữa chừng thì hỏi mốc đã nhận rồi tải tiếp từ đó, không upload lại từ đầu', async () => {
    // Lần mở luồng đầu: đầy đủ. Lần thứ hai: có Range → 206 Partial Content.
    mockedAxios.get
      .mockResolvedValueOnce(fakeStream(FILE_SIZE) as any)
      .mockResolvedValueOnce(fakeStream(FILE_SIZE - 400, 206) as any);

    mockedAxios.put.mockImplementation((_url: any, _data: any, config?: any) => {
      if (isOffsetQuery(config)) {
        // 308 Resume Incomplete: đã nhận 600 byte đầu (0-599)
        return Promise.resolve({ status: 308, headers: { range: 'bytes=0-599' } } as any);
      }
      const isResumed = String(config?.headers?.['Content-Range'] ?? '').startsWith('bytes 600-');
      if (!isResumed) return Promise.reject(new Error('mạng đứt'));
      return Promise.resolve({ data: { id: 'YT_RESUMED' } } as any);
    });

    const result = await publisher.publish('token', { title: 'T', mediaUrls: [VIDEO_URL] });

    expect(result.videoId).toBe('YT_RESUMED');
    // Luồng thứ hai phải xin đúng phần còn thiếu
    expect((mockedAxios.get.mock.calls[1][1] as any).headers.Range).toBe('bytes=600-');
  });

  it('nguồn không hỗ trợ Range (không trả 206) thì dừng, không nối nhầm dữ liệu', async () => {
    mockedAxios.get
      .mockResolvedValueOnce(fakeStream(FILE_SIZE) as any)
      .mockResolvedValueOnce(fakeStream(FILE_SIZE, 200) as any); // 200 = trả lại từ đầu

    mockedAxios.put.mockImplementation((_url: any, _data: any, config?: any) => {
      if (isOffsetQuery(config)) {
        return Promise.resolve({ status: 308, headers: { range: 'bytes=0-599' } } as any);
      }
      return Promise.reject(new Error('mạng đứt'));
    });

    await expect(
      publisher.publish('token', { title: 'T', mediaUrls: [VIDEO_URL] }),
    ).rejects.toThrow(/YouTube video upload failed/);
  });

  it('không hỏi được mốc thì dừng thay vì thử lại mù', async () => {
    mockedAxios.get.mockResolvedValue(fakeStream(FILE_SIZE) as any);
    mockedAxios.put.mockImplementation((_url: any, _data: any, config?: any) => {
      if (isOffsetQuery(config)) return Promise.reject(new Error('không hỏi được'));
      return Promise.reject(new Error('mạng đứt'));
    });

    await expect(
      publisher.publish('token', { title: 'T', mediaUrls: [VIDEO_URL] }),
    ).rejects.toThrow(/YouTube video upload failed/);

    // 1 lần nạp + 1 lần hỏi mốc — không có lần nạp thứ hai
    const uploadAttempts = mockedAxios.put.mock.calls.filter(c => !isOffsetQuery(c[2])).length;
    expect(uploadAttempts).toBe(1);
  });
});
