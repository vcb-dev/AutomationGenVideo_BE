import axios from 'axios';
import { FacebookPublisher } from '../publish/platforms/facebook.platform';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/** Prisma chỉ được dùng để tra thumbnail — trả null là đủ cho các ca ở đây */
const prismaStub: any = { socialUploadedFile: { findFirst: jest.fn().mockResolvedValue(null) } };

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

  it('xoá ảnh thất bại thì không che mất lỗi gốc — lỗi gốc mới là thứ người dùng cần thấy', async () => {
    mockedAxios.delete.mockRejectedValue({ response: { status: 403, data: { error: 'no permission' } } });
    let uploaded = 0;
    mockedAxios.post.mockImplementation((url: any) => {
      if (String(url).includes('/photos')) {
        uploaded++;
        if (uploaded === 2) return Promise.reject({ response: { status: 400, data: { error: 'bad' } } });
        return Promise.resolve({ data: { id: `PHOTO_${uploaded}` } } as any);
      }
      return Promise.resolve({ data: {} } as any);
    });

    await expect(
      publisher.publish('page-token', {
        message: 'x',
        mediaUrls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
        extraData: { pageId: 'PAGE1', type: 'page' },
      }),
    ).rejects.toThrow(/Chỉ upload thành công 1\/2 ảnh/);
  });

  it('carousel thành công thì không xoá gì', async () => {
    let uploaded = 0;
    mockedAxios.post.mockImplementation((url: any) => {
      if (String(url).includes('/photos')) {
        return Promise.resolve({ data: { id: `PHOTO_${++uploaded}` } } as any);
      }
      return Promise.resolve({ data: { id: 'POST_1' } } as any);
    });

    await publisher.publish('page-token', {
      message: 'ok',
      mediaUrls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
      extraData: { pageId: 'PAGE1', type: 'page' },
    });

    expect(mockedAxios.delete).not.toHaveBeenCalled();
  });
});
