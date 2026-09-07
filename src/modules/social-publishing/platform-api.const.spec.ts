import {
  FACEBOOK_GRAPH_BASE,
  FACEBOOK_RUPLOAD_BASE,
  INSTAGRAM_GRAPH_BASE,
  THREADS_GRAPH_BASE,
  FACEBOOK_GRAPH_ROOT,
  INSTAGRAM_GRAPH_ROOT,
  THREADS_GRAPH_ROOT,
  YOUTUBE_API_BASE,
  YOUTUBE_UPLOAD_BASE,
  FACEBOOK_OAUTH_DIALOG,
} from './platform-api.const';

describe('platform-api.const — phiên bản API khai báo một chỗ', () => {
  it('các điểm cuối Meta dùng chung một phiên bản Graph', () => {
    const version = FACEBOOK_GRAPH_BASE.split('/').pop();
    expect(INSTAGRAM_GRAPH_BASE.endsWith(`/${version}`)).toBe(true);
    expect(FACEBOOK_RUPLOAD_BASE.endsWith(`/${version}`)).toBe(true);
    expect(FACEBOOK_OAUTH_DIALOG).toContain(`/${version}/`);
  });

  it('Threads đánh phiên bản riêng, không đi theo Graph API', () => {
    expect(THREADS_GRAPH_BASE).toBe('https://graph.threads.net/v1.0');
  });

  it('host nạp bytes của Reels khác host Graph — dùng nhầm là hỏng pha upload', () => {
    expect(FACEBOOK_RUPLOAD_BASE).toContain('rupload.facebook.com');
    expect(FACEBOOK_GRAPH_BASE).toContain('graph.facebook.com');
  });

  it('bản không kèm phiên bản đúng là gốc host — vài điểm cuối Meta từ chối phiên bản', () => {
    expect(FACEBOOK_GRAPH_ROOT).toBe('https://graph.facebook.com');
    expect(INSTAGRAM_GRAPH_ROOT).toBe('https://graph.instagram.com');
    expect(THREADS_GRAPH_ROOT).toBe('https://graph.threads.net');
  });

  it('YouTube tách riêng host đọc và host upload', () => {
    expect(YOUTUBE_API_BASE).toBe('https://www.googleapis.com/youtube/v3');
    expect(YOUTUBE_UPLOAD_BASE).toBe('https://www.googleapis.com/upload/youtube/v3');
  });

  it('không điểm cuối nào kết thúc bằng dấu gạch chéo — người gọi luôn tự thêm', () => {
    for (const url of [
      FACEBOOK_GRAPH_BASE, FACEBOOK_RUPLOAD_BASE, INSTAGRAM_GRAPH_BASE, THREADS_GRAPH_BASE,
      FACEBOOK_GRAPH_ROOT, INSTAGRAM_GRAPH_ROOT, THREADS_GRAPH_ROOT,
      YOUTUBE_API_BASE, YOUTUBE_UPLOAD_BASE,
    ]) {
      expect(url.endsWith('/')).toBe(false);
    }
  });
});
