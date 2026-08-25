import { FacebookOAuthStrategy } from './facebook.strategy';

/**
 * Lượt xem Instagram trên trang Tổng quan kênh nội bộ luôn bằng 0.
 *
 * Đo trên dữ liệu thật: 1.470 reels trong kho thì 1.446 có `play_count = 0`; 947 reels vẫn
 * có lượt thích. Tức là dữ liệu về được, riêng lượt xem thì không.
 *
 * Nguyên nhân nằm ở quyền OAuth chứ không phải ở code cào. Gọi
 * `/{media-id}/insights?metric=views` bằng token thật của 3 kênh đều trả:
 *
 *     (#10) Application does not have permission for this action
 *
 * `debug_token` cho thấy token được cấp 15 quyền (instagram_basic,
 * instagram_content_publish, instagram_manage_comments…) nhưng KHÔNG có
 * `instagram_manage_insights` — quyền duy nhất đọc được lượt xem reels.
 *
 * Tài khoản Instagram loại `instagram_business` sinh ra từ luồng kết nối Facebook, nên nó
 * thừa hưởng scope của FacebookStrategy. instagram.strategy.ts (Flow 1) vốn đã xin quyền
 * này rồi; chỗ thiếu là đây.
 */
describe('FacebookOAuthStrategy — scope OAuth', () => {
  const scopeOf = (url: string): string[] =>
    decodeURIComponent(new URL(url).searchParams.get('scope') || '').split(',');

  const authUrl = () => new FacebookOAuthStrategy().getAuthUrl('state-bat-ky');

  it('xin instagram_manage_insights — thiếu nó thì lượt xem Instagram luôn bằng 0', () => {
    expect(scopeOf(authUrl())).toContain('instagram_manage_insights');
  });

  it('giữ nguyên các quyền đang dùng, không đánh rơi quyền nào', () => {
    const scope = scopeOf(authUrl());
    for (const quyen of [
      'public_profile',
      'pages_show_list',
      'pages_manage_posts',
      'pages_read_engagement',
      'business_management',
      'instagram_basic',
      'instagram_content_publish',
    ]) {
      expect(scope).toContain(quyen);
    }
  });

  it('không xin quyền thừa — Meta App Review từ chối scope không khớp use case', () => {
    // Xem chú thích trong instagram.strategy.ts: hai quyền comments/messages đã bị gỡ vì
    // hiện trên màn hình consent mà app không hề gọi tới.
    const scope = scopeOf(authUrl());
    expect(scope).not.toContain('instagram_manage_messages');
    expect(scope).not.toContain('instagram_business_manage_comments');
  });

  it('không có scope rỗng do thừa dấu phẩy', () => {
    expect(scopeOf(authUrl()).filter((s) => !s.trim())).toHaveLength(0);
  });
});
