import { Logger } from '@nestjs/common';
import axios from 'axios';
import { OAuthService } from '../oauth.service';

/**
 * Cấp quyền Facebook xong thì token MỚI phải được lưu lại, không được vứt đi.
 *
 * ── Vì sao cần ──────────────────────────────────────────────────────────────────
 * `handleFacebookCallback` đổi code → long-lived token, dùng token đó gọi /me/accounts rồi
 * BỎ LUÔN. Hệ quả đo được ngày 16/08/2026: cấp thêm quyền `instagram_manage_insights` xong,
 * hệ thống vẫn chạy bằng token cũ trong .env và vẫn nhận `(#10) Application does not have
 * permission` — người cấp quyền tưởng đã xong, thực tế không có gì thay đổi.
 *
 * Quyền Facebook đóng cứng vào token lúc phát hành: app được duyệt thêm quyền KHÔNG làm token
 * cũ mạnh lên, và `fb_exchange_token` chỉ đổi hạn chứ không thêm quyền (đã đo: token vừa gia
 * hạn vẫn thiếu đúng quyền đó). Đường duy nhất để có quyền mới là qua màn hình đồng ý — tức
 * chính luồng này. Nên đánh rơi token ở đây là làm hỏng cách duy nhất còn lại.
 *
 * Token store nằm bên AI (file .fb_token.json, AI giữ FERNET_KEY và là nơi duy nhất đọc nó),
 * nên BE không tự ghi file mà gọi endpoint của AI — giữ đúng ranh giới sẵn có giữa hai repo.
 */
describe('handleFacebookCallback — token mới phải được lưu vào token store', () => {
  const LONG_LIVED = 'EAA-token-dai-han-moi';

  let service: OAuthService;
  let prisma: any;
  let config: any;
  let aiPost: jest.Mock;

  beforeEach(() => {
    prisma = {
      businessChannelConnection: { upsert: jest.fn(async ({ create }: any) => ({ id: 'x', ...create })) },
    };
    config = {
      get: jest.fn((k: string, d?: string) => {
        const bang: Record<string, string> = {
          FACEBOOK_APP_ID: '2220149378725104',
          FACEBOOK_APP_SECRET: 'secret',
          FACEBOOK_CALLBACK_URL: 'http://localhost:3000/api/oauth/facebook/callback',
          AI_SERVICE_URL: 'http://localhost:8001',
        };
        return bang[k] ?? d;
      }),
    };
    service = new OAuthService(config, prisma);

    aiPost = jest.fn(async () => ({ data: { status: 'ok' } }));
    jest.spyOn(axios, 'post').mockImplementation(aiPost as any);
    jest.spyOn(axios, 'get').mockImplementation((async (url: string) => {
      if (url.includes('oauth/access_token')) return { data: { access_token: LONG_LIVED } };
      if (url.includes('/me/accounts')) return { data: { data: [] } };
      return { data: {} };
    }) as any);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('gửi token dài hạn sang AI để lưu vào token store', async () => {
    await service.handleFacebookCallback('code-gia');

    const [url, body] = aiPost.mock.calls[0];
    expect(url).toContain('/api/facebook/fetch/token-save/');
    expect(body.access_token).toBe(LONG_LIVED);
  });

  it('lưu token hỏng KHÔNG được làm hỏng cả lượt cấp quyền', async () => {
    // Page đã lưu vào DB xong rồi mới tới bước này. Ném lỗi ở đây là người dùng thấy màn hình
    // đỏ dù việc chính đã thành công, rồi bấm cấp quyền lại từ đầu — vô ích.
    aiPost.mockRejectedValue(new Error('AI service 502'));

    await expect(service.handleFacebookCallback('code-gia')).resolves.toBeDefined();
  });

  it('không có code thì báo lỗi rõ, không gọi Facebook', async () => {
    await expect(service.handleFacebookCallback('')).rejects.toThrow();
  });
});
