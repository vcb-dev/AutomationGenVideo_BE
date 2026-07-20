/**
 * scripts/test-zernio-tiktok.ts
 *
 * Script test nhanh API đăng bài TikTok qua Zernio (https://zernio.com/api/v1).
 *
 * Cần biến môi trường (đặt trong .env hoặc export trước khi chạy):
 *   ZERNIO_API_KEY=sk_xxxxxxxx...   (lấy ở Dashboard Zernio > API Keys)
 *
 * Cách dùng:
 *   1) Chỉ liệt kê các tài khoản đã kết nối (AN TOÀN, không đăng gì):
 *        npx ts-node scripts/test-zernio-tiktok.ts
 *
 *   2) Đăng thật 1 video lên TikTok (CHỈ chạy khi đã chắc chắn):
 *        npx ts-node scripts/test-zernio-tiktok.ts --publish \
 *          --video=https://cdn.example.com/test.mp4 \
 *          --caption="Test đăng bài qua Zernio #test" \
 *          [--account=<accountId>]   # bỏ qua thì tự lấy TikTok account đầu tiên
 *
 * Lưu ý:
 *   - Video phải là URL PUBLIC (TikTok tự tải về), độ dài 3s–10 phút, <=4GB, nên 9:16.
 *   - Trước khi đăng được, bạn phải đã "Connect" 1 tài khoản TikTok trong Dashboard Zernio
 *     (bước 2 trong onboarding). Nếu chưa, lệnh liệt kê sẽ trả về mảng rỗng.
 */

import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const BASE_URL = process.env.ZERNIO_BASE_URL || 'https://zernio.com/api/v1';
const API_KEY = process.env.ZERNIO_API_KEY || '';

// ---- parse args đơn giản: --key=value hoặc --flag ----
function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function client() {
  if (!API_KEY) {
    throw new Error(
      'Thiếu ZERNIO_API_KEY. Hãy thêm vào file .env:  ZERNIO_API_KEY=sk_...',
    );
  }
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  });
}

async function listAccounts(): Promise<any[]> {
  const res = await client().get('/accounts');
  // Tùy response Zernio: có thể là mảng trực tiếp hoặc { data: [...] }
  const data = res.data;
  const accounts: any[] = Array.isArray(data) ? data : data?.data || data?.accounts || [];
  return accounts;
}

async function publishToTiktok(opts: {
  accountId: string;
  caption: string;
  videoUrl: string;
}) {
  const body = {
    content: opts.caption,
    mediaItems: [{ type: 'video', url: opts.videoUrl }],
    platforms: [{ platform: 'tiktok', accountId: opts.accountId }],
    tiktokSettings: {
      privacy_level: 'PUBLIC_TO_EVERYONE',
      allow_comment: true,
      allow_duet: true,
      allow_stitch: true,
      content_preview_confirmed: true,
      express_consent_given: true,
    },
    publishNow: true,
  };

  console.log('\n[POST /posts] Body gửi đi:');
  console.log(JSON.stringify(body, null, 2));

  const res = await client().post('/posts', body);
  return res.data;
}

async function main() {
  console.log(`Zernio base: ${BASE_URL}`);
  console.log(`API key: ${API_KEY ? API_KEY.slice(0, 10) + '…(' + API_KEY.length + ' ký tự)' : '(CHƯA CÓ)'}`);

  // 1) Luôn liệt kê tài khoản trước
  console.log('\n=== GET /accounts ===');
  const accounts = await listAccounts();
  if (!accounts.length) {
    console.log('⚠️  Không có tài khoản nào. Hãy vào Dashboard Zernio > Connections để Connect TikTok trước.');
  } else {
    accounts.forEach((a, i) => {
      console.log(`${i + 1}. platform=${a.platform} id=${a._id || a.id} name=${a.name || a.username || a.displayName || ''}`);
    });
  }

  if (!hasFlag('publish')) {
    console.log('\n(Chế độ chỉ-xem. Thêm --publish --video=<url> để đăng thật.)');
    return;
  }

  // 2) Đăng thật
  const videoUrl = getArg('video');
  if (!videoUrl) throw new Error('Thiếu --video=<url> để đăng.');
  const caption = getArg('caption') || 'Test đăng bài TikTok qua Zernio API';

  let accountId = getArg('account');
  if (!accountId) {
    const tiktok = accounts.find((a) => String(a.platform).toLowerCase() === 'tiktok');
    if (!tiktok) throw new Error('Không tìm thấy tài khoản TikTok đã kết nối. Hãy truyền --account=<id> hoặc Connect TikTok trên Zernio.');
    accountId = tiktok._id || tiktok.id;
  }
  console.log(`\nĐăng lên TikTok accountId=${accountId}`);

  const result = await publishToTiktok({ accountId: accountId!, caption, videoUrl });
  console.log('\n✅ Kết quả:');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err: any) => {
  const detail = err.response?.data ? JSON.stringify(err.response.data, null, 2) : err.message;
  console.error('\n❌ Lỗi:', detail);
  if (err.response?.status) console.error('HTTP status:', err.response.status);
  process.exit(1);
});
