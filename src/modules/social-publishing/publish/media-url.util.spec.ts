import { isVideoUrl } from './media-url.util';

describe('isVideoUrl — nhận diện video dùng chung cho mọi platform', () => {
  it('bắt đuôi .mp4 trực tiếp', () => {
    expect(isVideoUrl('https://cdn.example.com/uploads/social/clip.mp4')).toBe(true);
  });

  it('bắt .mp4 kèm query string', () => {
    expect(isVideoUrl('https://cdn.example.com/clip.mp4?token=abc123')).toBe(true);
  });

  it('bắt .mp4 kèm fragment', () => {
    expect(isVideoUrl('https://cdn.example.com/clip.mp4#t=5')).toBe(true);
  });

  it('bắt dạng tên file nằm trong query — trước đây Facebook bỏ sót dạng này và đẩy video vào /photos', () => {
    const driveStyleUrl = 'https://www.googleapis.com/drive/v3/files/ID?alt=media&filename=reel.mp4';
    expect(isVideoUrl(driveStyleUrl)).toBe(true);
  });

  it('không nhận nhầm ảnh là video', () => {
    expect(isVideoUrl('https://cdn.example.com/photo.jpg')).toBe(false);
    expect(isVideoUrl('https://cdn.example.com/photo.png?w=100')).toBe(false);
  });

  it('không nhận nhầm khi chuỗi "mp4" chỉ nằm trong tên thư mục', () => {
    expect(isVideoUrl('https://cdn.example.com/mp4/cover.jpg')).toBe(false);
  });

  it('chuỗi rỗng hoặc undefined trả về false thay vì ném lỗi', () => {
    expect(isVideoUrl('')).toBe(false);
    expect(isVideoUrl(undefined as unknown as string)).toBe(false);
  });
});
