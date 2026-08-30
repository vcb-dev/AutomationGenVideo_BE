import { InstagramPublisher } from './instagram.platform';
import axios from 'axios';
import * as fs from 'fs';
import { Readable } from 'stream';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('InstagramPublisher', () => {
  let publisher: InstagramPublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    publisher = new InstagramPublisher();
  });

  describe('publish single photo', () => {
    it('tạo container ảnh, chờ FINISHED, publish và lấy permalink thành công', async () => {
      mockedAxios.post
        .mockResolvedValueOnce({ data: { id: 'container_photo_1' } }) // createContainer
        .mockResolvedValueOnce({ data: { id: 'post_123' } }); // media_publish

      mockedAxios.get
        .mockResolvedValueOnce({ data: { status_code: 'FINISHED' } }) // waitForContainer
        .mockResolvedValueOnce({ data: { permalink: 'https://instagram.com/p/abc123xyz' } }); // getPermalink

      const res = await publisher.publish('token_abc', {
        caption: 'Hello Instagram',
        mediaUrls: ['https://example.com/photo.jpg'],
        igUserId: 'ig_user_1',
        accountType: 'instagram_direct',
      });

      expect(res).toEqual({
        postId: 'post_123',
        url: 'https://instagram.com/p/abc123xyz',
      });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.instagram.com/v21.0/ig_user_1/media',
        expect.objectContaining({
          image_url: 'https://example.com/photo.jpg',
          caption: 'Hello Instagram',
          access_token: 'token_abc',
        }),
        expect.any(Object),
      );
    });
  });

  describe('publish single video Reel', () => {
    it('dùng video_url khi là URL ngoài không có local file', async () => {
      mockedAxios.post
        .mockResolvedValueOnce({ data: { id: 'container_reel_1' } }) // createContainer
        .mockResolvedValueOnce({ data: { id: 'reel_post_456' } }); // media_publish

      mockedAxios.get
        .mockResolvedValueOnce({ data: { status_code: 'FINISHED' } }) // waitForContainer
        .mockResolvedValueOnce({ data: { permalink: 'https://instagram.com/reel/def456' } });

      const res = await publisher.publish('token_page', {
        caption: 'Reels test',
        mediaUrls: ['https://cdn.example.com/video.mp4'],
        igUserId: 'ig_page_1',
        accountType: 'instagram_business',
      });

      expect(res).toEqual({
        postId: 'reel_post_456',
        url: 'https://instagram.com/reel/def456',
      });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/ig_page_1/media',
        expect.objectContaining({
          media_type: 'REELS',
          video_url: 'https://cdn.example.com/video.mp4',
          share_to_feed: 'true',
          access_token: 'token_page',
        }),
        expect.any(Object),
      );
    });

    it('dùng resumable upload nhị phân trực tiếp khi có local file', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 * 1024 } as any);
      const mockStream = Readable.from(['mock video chunk']);
      jest.spyOn(fs, 'createReadStream').mockReturnValue(mockStream as any);

      try {
        mockedAxios.post
          .mockResolvedValueOnce({
            data: { id: 'container_resumable_1', uri: 'https://rupload.facebook.com/ig-reels-upload/123' },
          }) // init resumable
          .mockResolvedValueOnce({ data: { success: true } }) // upload binary stream
          .mockResolvedValueOnce({ data: { id: 'reel_resumable_done' } }); // media_publish

        mockedAxios.get
          .mockResolvedValueOnce({ data: { status_code: 'FINISHED' } }) // waitForContainer
          .mockResolvedValueOnce({ data: { permalink: 'https://instagram.com/reel/xyz789' } });

        const res = await publisher.publish('token_page', {
          caption: 'Resumable Reels',
          mediaUrls: ['http://localhost:3000/api/social/media/test_video_ig_mock.mp4'],
          igUserId: 'ig_user_resumable',
          accountType: 'instagram_via_facebook',
        });

        expect(res.postId).toBe('reel_resumable_done');
        expect(res.url).toBe('https://instagram.com/reel/xyz789');

        expect(mockedAxios.post).toHaveBeenCalledWith(
          'https://rupload.facebook.com/ig-reels-upload/123',
          mockStream,
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'OAuth token_page',
              file_size: '1048576',
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
    it('ném lỗi rõ ràng khi container trả status_code ERROR', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { id: 'container_err_1' } });
      mockedAxios.get.mockResolvedValueOnce({
        data: { status_code: 'ERROR', status: 'The video could not be processed' },
      });

      await expect(
        publisher.publish('token_123', {
          caption: 'Fail test',
          mediaUrls: ['https://example.com/bad_video.mp4'],
          igUserId: 'ig_123',
        }),
      ).rejects.toThrow('Instagram container failed: The video could not be processed');
    });

    it('ném lỗi khi mediaUrls rỗng', async () => {
      await expect(
        publisher.publish('token_123', {
          caption: 'Empty media',
          mediaUrls: [],
          igUserId: 'ig_123',
        }),
      ).rejects.toThrow('Instagram yêu cầu ít nhất 1 media');
    });
  });
});
