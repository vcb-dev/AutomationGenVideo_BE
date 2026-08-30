import { ThreadsPublisher } from './threads.platform';
import axios from 'axios';
import * as fs from 'fs';
import { Readable } from 'stream';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ThreadsPublisher', () => {
  let publisher: ThreadsPublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    publisher = new ThreadsPublisher();
  });

  describe('publish text post', () => {
    it('đăng bài text thuần không có media', async () => {
      mockedAxios.post
        .mockResolvedValueOnce({ data: { id: 'container_txt_1' } }) // createContainer
        .mockResolvedValueOnce({ data: { id: 'threads_post_101' } }); // publishContainer

      mockedAxios.get
        .mockResolvedValueOnce({ data: { permalink: 'https://threads.net/@user/post/101' } });

      const res = await publisher.publish('threads_token_123', {
        text: 'Hello Threads!',
        userId: 'threads_user_1',
      });

      expect(res).toEqual({
        postId: 'threads_post_101',
        url: 'https://threads.net/@user/post/101',
      });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.threads.net/v1.0/threads_user_1/threads',
        expect.objectContaining({
          media_type: 'TEXT',
          text: 'Hello Threads!',
          access_token: 'threads_token_123',
        }),
        expect.any(Object),
      );
    });
  });

  describe('publish video post', () => {
    it('dùng resumable binary upload khi có local file', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 2048 * 1024 } as any);
      const mockStream = Readable.from(['mock threads chunk']);
      jest.spyOn(fs, 'createReadStream').mockReturnValue(mockStream as any);

      try {
        mockedAxios.post
          .mockResolvedValueOnce({
            data: { id: 'cid_threads_vid', uri: 'https://rupload.threads.net/video/upload/1' },
          }) // init resumable
          .mockResolvedValueOnce({ data: { success: true } }) // binary upload
          .mockResolvedValueOnce({ data: { id: 'threads_vid_post_202' } }); // publishContainer

        mockedAxios.get
          .mockResolvedValueOnce({ data: { status: 'FINISHED' } }) // waitForContainer
          .mockResolvedValueOnce({ data: { permalink: 'https://threads.net/@user/post/202' } });

        const res = await publisher.publish('threads_token_123', {
          text: 'Check this video out',
          mediaUrls: ['http://localhost:3000/api/social/media/test_threads_vid.mp4'],
          userId: 'threads_user_1',
        });

        expect(res.postId).toBe('threads_vid_post_202');
        expect(res.url).toBe('https://threads.net/@user/post/202');

        expect(mockedAxios.post).toHaveBeenCalledWith(
          'https://rupload.threads.net/video/upload/1',
          mockStream,
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'OAuth threads_token_123',
              file_size: '2097152',
              'Content-Type': 'application/octet-stream',
            }),
          }),
        );
      } finally {
        jest.restoreAllMocks();
      }
    });
  });

  describe('error handling', () => {
    it('ném lỗi khi container thất bại với status ERROR', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { id: 'cid_err_threads' } });
      mockedAxios.get.mockResolvedValueOnce({
        data: { status: 'ERROR', error_message: 'Video processing failed' },
      });

      await expect(
        publisher.publish('threads_token_123', {
          text: 'Fail threads',
          mediaUrls: ['https://example.com/bad_video.mp4'],
          userId: 'threads_user_1',
        }),
      ).rejects.toThrow('Threads container error: Video processing failed');
    });
  });
});
