import { buildYoutubeTitle, extractHashtags } from '../publish/youtube-metadata.util';

describe('buildYoutubeTitle', () => {
  it('lấy dòng đầu làm tiêu đề thay vì cắt cụt 100 ký tự giữa từ', () => {
    const message = 'Cách làm bánh mì tại nhà\n\nChi tiết từng bước ở phần mô tả bên dưới.';
    expect(buildYoutubeTitle(message)).toBe('Cách làm bánh mì tại nhà');
  });

  it('bỏ hashtag khỏi tiêu đề — hashtag thuộc về mô tả, không phải tiêu đề', () => {
    expect(buildYoutubeTitle('Review quán cà phê mới #cafe #saigon')).toBe('Review quán cà phê mới');
  });

  it('cắt ở ranh giới từ khi dòng đầu dài quá 100 ký tự', () => {
    const long = 'a'.repeat(40) + ' ' + 'b'.repeat(40) + ' ' + 'c'.repeat(40);
    const title = buildYoutubeTitle(long);
    expect(title.length).toBeLessThanOrEqual(100);
    expect(title.endsWith(' ')).toBe(false);
    expect(title).toBe('a'.repeat(40) + ' ' + 'b'.repeat(40));
  });

  it('bỏ qua dòng trống ở đầu', () => {
    expect(buildYoutubeTitle('\n\n   \nTiêu đề thật')).toBe('Tiêu đề thật');
  });

  it('dùng fallback khi nội dung rỗng hoặc chỉ có hashtag', () => {
    expect(buildYoutubeTitle('')).toBe('Video');
    expect(buildYoutubeTitle('#chionly #hashtag')).toBe('Video');
  });

  it('không cắt giữa từ khi một từ dài chiếm gần hết ngưỡng', () => {
    const oneLongWord = 'x'.repeat(150);
    expect(buildYoutubeTitle(oneLongWord)).toHaveLength(100);
  });
});

describe('extractHashtags', () => {
  it('rút hashtag thành tag, bỏ dấu # — trước đây trường tags luôn rỗng', () => {
    expect(extractHashtags('Món ngon mỗi ngày #anuong #monngon')).toEqual(['anuong', 'monngon']);
  });

  it('giữ được hashtag tiếng Việt có dấu', () => {
    expect(extractHashtags('#ẩmthực #sàigòn')).toEqual(['ẩmthực', 'sàigòn']);
  });

  it('loại trùng lặp không phân biệt hoa thường', () => {
    expect(extractHashtags('#Reels #reels #REELS')).toEqual(['Reels']);
  });

  it('giới hạn 15 tag', () => {
    const many = Array.from({ length: 30 }, (_, i) => `#tag${i}`).join(' ');
    expect(extractHashtags(many)).toHaveLength(15);
  });

  it('trả mảng rỗng khi không có hashtag nào', () => {
    expect(extractHashtags('Không có thẻ nào ở đây')).toEqual([]);
    expect(extractHashtags('')).toEqual([]);
  });
});
