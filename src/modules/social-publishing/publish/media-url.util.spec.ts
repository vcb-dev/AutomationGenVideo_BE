import { isVideoUrl, VIDEO_EXTENSIONS } from './media-url.util';

describe('isVideoUrl — nhận diện video dùng chung cho mọi platform', () => {
  // Duyệt theo danh sách thay vì viết cứng từng URL: thêm định dạng vào
  // VIDEO_EXTENSIONS là bộ test tự phủ luôn, không phải nhớ bổ sung ca mới.
  describe.each(VIDEO_EXTENSIONS)('đuôi .%s', (ext) => {
    it('bắt được khi nằm trực tiếp trên đường dẫn', () => {
      expect(isVideoUrl(`https://cdn.example.com/uploads/social/clip.${ext}`)).toBe(true);
    });

    it('bắt được khi kèm query string', () => {
      expect(isVideoUrl(`https://cdn.example.com/clip.${ext}?token=abc123`)).toBe(true);
    });

    it('bắt được khi kèm fragment', () => {
      expect(isVideoUrl(`https://cdn.example.com/clip.${ext}#t=5`)).toBe(true);
    });

    it('bắt được dạng tên file nằm trong query — Facebook từng bỏ sót và đẩy video vào /photos', () => {
      const driveStyleUrl = `https://www.googleapis.com/drive/v3/files/ID?alt=media&filename=reel.${ext}`;
      expect(isVideoUrl(driveStyleUrl)).toBe(true);
    });

    it('không phân biệt hoa thường', () => {
      expect(isVideoUrl(`https://cdn.example.com/clip.${ext.toUpperCase()}`)).toBe(true);
    });
  });

  it('hỗ trợ đúng các định dạng Facebook/Instagram/Threads nhận', () => {
    expect([...VIDEO_EXTENSIONS]).toEqual(['mp4', 'mov']);
  });

  it('không nhận nhầm ảnh là video', () => {
    expect(isVideoUrl('https://cdn.example.com/photo.jpg')).toBe(false);
    expect(isVideoUrl('https://cdn.example.com/photo.png?w=100')).toBe(false);
  });

  it('không nhận nhầm định dạng video mà nền tảng không hỗ trợ', () => {
    expect(isVideoUrl('https://cdn.example.com/clip.avi')).toBe(false);
    expect(isVideoUrl('https://cdn.example.com/clip.mkv')).toBe(false);
  });

  it('không nhận nhầm khi đuôi chỉ nằm trong tên thư mục', () => {
    expect(isVideoUrl('https://cdn.example.com/mp4/cover.jpg')).toBe(false);
    expect(isVideoUrl('https://cdn.example.com/mov/cover.jpg')).toBe(false);
  });

  it('chuỗi rỗng hoặc undefined trả về false thay vì ném lỗi', () => {
    expect(isVideoUrl('')).toBe(false);
    expect(isVideoUrl(undefined as unknown as string)).toBe(false);
  });
});
