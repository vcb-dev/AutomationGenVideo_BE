import { isPermanentPublishError } from '../publish/publish-error.util';

/** Chuỗi lỗi thật Instagram trả về khi container media không đọc được URL ảnh. */
const INSTAGRAM_INVALID_IMAGE =
  'Instagram createContainer (HTTP 400): {"error":{"message":"The image format is not supported.",' +
  '"type":"OAuthException","code":36001,"error_subcode":2207083,"is_transient":false,' +
  '"error_user_title":"Invalid Image Format","error_user_msg":"The image could not be processed ' +
  'because its format is not supported...","fbtrace_id":"ADLs8dl_l3AbasnnAKjYltu"}}';

describe('isPermanentPublishError', () => {
  describe('lỗi vĩnh viễn — không thử lại', () => {
    it('nhận ra lỗi định dạng ảnh của Instagram (subcode 2207083)', () => {
      // Ca thật gây sự cố 28/08/2026: bài bị thử lại 2 lượt vô ích trong ~20 phút,
      // khoá luôn kênh Instagram đó dù Meta đã ghi rõ is_transient=false.
      expect(isPermanentPublishError(INSTAGRAM_INVALID_IMAGE)).toBe(true);
    });

    it.each([
      ['video sai định dạng', 2207026],
      ['không tải được URL media', 2207020],
      ['tạo container thất bại', 2207032],
      ['tỷ lệ khung hình sai', 2207057],
    ])('nhận ra %s (subcode %i)', (_label, subcode) => {
      expect(isPermanentPublishError(`{"error":{"code":100,"error_subcode":${subcode}}}`)).toBe(true);
    });

    it.each([
      ['token hết hạn hoặc bị thu hồi', 190],
      ['thiếu quyền', 200],
      ['ứng dụng không được phép', 10],
    ])('nhận ra %s (code %i)', (_label, code) => {
      expect(isPermanentPublishError(`{"error":{"code":${code},"message":"..."}}`)).toBe(true);
    });
  });

  describe('lỗi tạm thời — vẫn phải thử lại', () => {
    it.each([
      ['giới hạn request ứng dụng', 4],
      ['giới hạn request người dùng', 17],
      ['throttling ở cấp page', 32],
      ['vượt rate limit', 613],
      ['chạm trần ứng dụng', 341],
    ])('coi %s (code %i) là thử lại được', (_label, code) => {
      expect(isPermanentPublishError(`{"error":{"code":${code}}}`)).toBe(false);
    });

    it('ưu tiên rate-limit ngay cả khi Meta gắn kèm is_transient=false', () => {
      // Meta đôi khi gắn is_transient=false cho lỗi throttling; chờ rồi thử lại vẫn đúng.
      expect(
        isPermanentPublishError('{"error":{"code":613,"error_subcode":2207020,"is_transient":false}}'),
      ).toBe(false);
    });

    it.each([
      'Facebook resumable upload (chunk 40%) failed: socket hang up',
      'connect ETIMEDOUT 157.240.15.35:443',
      'Instagram container timeout sau 10 phút',
      'Threads container timeout sau 3 phút',
      '{"error":{"code":1,"message":"An unknown error occurred"}}',
    ])('coi lỗi mạng/timeout là thử lại được: %s', (message) => {
      expect(isPermanentPublishError(message)).toBe(false);
    });

    it('mặc định thử lại khi không nhận ra mã lỗi — thà thử thừa còn hơn bỏ bài', () => {
      expect(isPermanentPublishError('{"error":{"code":999888,"error_subcode":777666}}')).toBe(false);
    });
  });

  describe('đầu vào bất thường', () => {
    it.each([null, undefined, ''])('không vỡ với %p', (message) => {
      expect(isPermanentPublishError(message as any)).toBe(false);
    });

    it('không nhầm số nằm ở chỗ khác trong chuỗi thành mã lỗi', () => {
      expect(isPermanentPublishError('upload 190 bytes tới subcode 2207083 xong')).toBe(false);
    });
  });
});
