import axios from 'axios';
import { InstagramOAuthStrategy } from './instagram.strategy';
import { INSTAGRAM_GRAPH_BASE } from '../../platform-api.const';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('InstagramOAuthStrategy — direct flow (Instagram Login)', () => {
  let strategy: InstagramOAuthStrategy;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.IG_APP_ID = 'test-ig-app-id';
    process.env.IG_APP_SECRET = 'test-ig-app-secret';
    process.env.IG_REDIRECT_URI = 'https://example.com/api/social/oauth/instagram/callback';
    strategy = new InstagramOAuthStrategy();
  });

  it('lấy profile qua /me thay vì /{user_id} — user_id bước 1 là ID cũ, gọi thẳng bị lỗi "Object does not exist" (code 100, subcode 33)', async () => {
    // Bước 1: exchange code → short token, kèm user_id KIỂU CŨ (không dùng được trên graph.instagram.com)
    mockedAxios.post.mockResolvedValueOnce({
      data: { access_token: 'short-token', user_id: '26978866438459016' },
    });
    // Bước 2: long-lived token; Bước 3: profile /me trả scoped-ID thật
    mockedAxios.get
      .mockResolvedValueOnce({ data: { access_token: 'long-token', expires_in: 5184000 } })
      .mockResolvedValueOnce({
        data: { id: '17841400000000001', username: 'vcb_test', name: 'VCB Test', profile_picture_url: 'https://cdn/avatar.jpg' },
      });

    const result = await strategy.exchangeCode('auth-code', 'direct');

    // Call profile phải là /me với long-lived token
    const profileCall = mockedAxios.get.mock.calls[1];
    expect(profileCall[0]).toBe(`${INSTAGRAM_GRAPH_BASE}/me`);
    expect(profileCall[1]).toMatchObject({
      params: expect.objectContaining({ access_token: 'long-token' }),
    });

    // platformId/igUserId phải lấy từ /me, KHÔNG phải user_id bước 1
    expect(result.platformId).toBe('17841400000000001');
    expect(result.extraData.igUserId).toBe('17841400000000001');
    expect(result.platformId).not.toBe('26978866438459016');
    expect(result.accessToken).toBe('long-token');
    expect(result.username).toBe('vcb_test');
  });

  it('không còn call nào chứa user_id bước 1 trong URL', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { access_token: 'short-token', user_id: '26978866438459016' },
    });
    mockedAxios.get
      .mockResolvedValueOnce({ data: { access_token: 'long-token', expires_in: 5184000 } })
      .mockResolvedValueOnce({ data: { id: '17841400000000001', username: 'vcb_test' } });

    await strategy.exchangeCode('auth-code', 'direct');

    for (const call of mockedAxios.get.mock.calls) {
      expect(String(call[0])).not.toContain('26978866438459016');
    }
  });

  it('chấp nhận response token bọc trong mảng data (format theo Meta docs)', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { data: [{ access_token: 'short-token', user_id: '26978866438459016', permissions: 'instagram_business_basic' }] },
    });
    mockedAxios.get
      .mockResolvedValueOnce({ data: { access_token: 'long-token', expires_in: 5184000 } })
      .mockResolvedValueOnce({ data: { id: '17841400000000001', username: 'vcb_test' } });

    const result = await strategy.exchangeCode('auth-code', 'direct');
    expect(result.platformId).toBe('17841400000000001');
    expect(result.accessToken).toBe('long-token');
  });

  it('báo lỗi rõ ràng khi token exchange không trả access_token', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { error_type: 'OAuthException', error_message: 'Invalid code' } });
    await expect(strategy.exchangeCode('bad-code', 'direct')).rejects.toThrow('không trả access_token');
  });

  it('getAuthUrl mode=direct dùng www.instagram.com + IG_APP_ID', () => {
    const url = strategy.getAuthUrl('state-abc', 'direct');
    expect(url).toContain('https://www.instagram.com/oauth/authorize');
    expect(url).toContain('client_id=test-ig-app-id');
    expect(url).toContain('instagram_business_content_publish');
  });
});
