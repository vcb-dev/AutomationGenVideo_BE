import { resolvePublicBaseUrl, isUnreachableForMeta } from '../publish/publish.service';

/**
 * Bảo vệ fix "Instagram lên lịch bị FAILED sau khi tạo":
 * - IG/Threads chỉ đăng qua `video_url` (Meta tự tải) → URL media phải công khai.
 * - publish.service trước đây chỉ đọc PUBLIC_BASE_URL, không fallback API_BASE_URL
 *   như các strategy OAuth → deploy chỉ set API_BASE_URL thì IG luôn nhận link
 *   127.0.0.1 và fail, còn Facebook không sao vì nó stream bytes thẳng.
 */
describe('resolvePublicBaseUrl', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.API_BASE_URL;
    delete process.env.GOOGLE_CALLBACK_URL;
    delete process.env.FB_REDIRECT_URI;
    delete process.env.PORT;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('ưu tiên PUBLIC_BASE_URL và cắt dấu / thừa', () => {
    process.env.PUBLIC_BASE_URL = 'https://api.example.com/';
    expect(resolvePublicBaseUrl()).toBe('https://api.example.com');
  });

  it('fallback API_BASE_URL và bỏ hậu tố /api', () => {
    process.env.API_BASE_URL = 'https://api.example.com/api';
    expect(resolvePublicBaseUrl()).toBe('https://api.example.com');
  });

  it('suy origin từ GOOGLE_CALLBACK_URL khi thiếu 2 biến trên', () => {
    process.env.GOOGLE_CALLBACK_URL = 'https://api.example.com/api/auth/google/callback';
    expect(resolvePublicBaseUrl()).toBe('https://api.example.com');
  });

  it('cuối cùng mới rơi về localhost theo PORT', () => {
    process.env.PORT = '4000';
    expect(resolvePublicBaseUrl()).toBe('http://127.0.0.1:4000');
  });
});

describe('isUnreachableForMeta', () => {
  it('bắt URL localhost / 127.0.0.1', () => {
    expect(isUnreachableForMeta('http://127.0.0.1:3000/api/social/media/x.mp4')).toBe(true);
    expect(isUnreachableForMeta('http://localhost:3000/api/social/media/x.mp4')).toBe(true);
  });

  it('bắt link Google Drive chưa được tải về local', () => {
    expect(isUnreachableForMeta('https://drive.google.com/file/d/abc123/view')).toBe(true);
    expect(isUnreachableForMeta('https://lh3.googleusercontent.com/d/abc123')).toBe(true);
  });

  it('cho qua URL công khai bình thường', () => {
    expect(isUnreachableForMeta('https://api.example.com/api/social/media/x.mp4')).toBe(false);
    expect(isUnreachableForMeta('https://cdn.example.com/video/x.mp4')).toBe(false);
  });
});
