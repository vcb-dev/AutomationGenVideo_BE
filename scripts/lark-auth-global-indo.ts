/**
 * Script lấy user_access_token cho Global Indo Bot qua OAuth.
 * Chạy: npx ts-node scripts/lark-auth-global-indo.ts
 * Trình duyệt sẽ tự mở, bạn đăng nhập Lark → token được lưu tự động.
 */
import * as http from 'http';
import * as https from 'https';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const APP_ID     = process.env.LARK_KPI_GLOBAL_INDO_APP_ID || 'cli_aabe5c5be5b85eea';
const APP_SECRET = process.env.LARK_KPI_GLOBAL_INDO_APP_SECRET || '4s8lcQklI7QEDl9vvMqifRHkuMmNNiRa';
const REDIRECT   = 'http://localhost:9999/callback';
const STATE      = 'gcindo-' + Date.now();

const AUTH_URL = `https://open.larksuite.com/open-apis/authen/v1/authorize?app_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=bitable:app:readonly offline_access&state=${STATE}`;

function openBrowser(url: string) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`;
  exec(cmd);
}

function post(url: string, body: Record<string, string>, headers: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, port: 443, path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve(JSON.parse(raw)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function exchangeCode(code: string) {
  // Bước 1: lấy app_access_token
  const appTokenRes = await post(
    'https://open.larksuite.com/open-apis/auth/v3/app_access_token/internal',
    { app_id: APP_ID, app_secret: APP_SECRET },
    {},
  );
  const appToken = appTokenRes.app_access_token;
  console.log('app_access_token:', appToken ? appToken.substring(0, 20) + '...' : 'MISSING');

  // Bước 2: exchange code lấy user token
  const res = await post(
    'https://open.larksuite.com/open-apis/authen/v1/access_token',
    { grant_type: 'authorization_code', code },
    { Authorization: `Bearer ${appToken}` },
  );
  console.log('Raw exchange response:', JSON.stringify(res));
  return res.data ?? res;
}

async function main() {
  console.log('\n🚀 Lark OAuth cho Global Indo Bot');
  console.log('   Đang mở trình duyệt để đăng nhập Lark...\n');
  openBrowser(AUTH_URL);

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, 'http://localhost:9999');
      if (url.pathname !== '/callback') { res.end('not found'); return; }

      const code = url.searchParams.get('code');
      if (!code) { res.end('Missing code'); reject(new Error('No code')); return; }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h2>✅ Xác thực thành công! Bạn có thể đóng tab này.</h2>');
      server.close();

      console.log('✅ Nhận được authorization code, đang exchange tokens...');
      try {
        const tokens = await exchangeCode(code);
        console.log('\n========= TOKEN INFO =========');
        console.log('access_token  :', tokens.access_token);
        console.log('refresh_token :', tokens.refresh_token);
        console.log('expires_in    :', tokens.expires_in, 'seconds');
        console.log('==============================\n');

        // Lưu refresh_token vào file tạm
        const out = path.join(__dirname, '../.lark-global-indo-refresh.txt');
        fs.writeFileSync(out, tokens.refresh_token || '');
        console.log(`💾 Refresh token đã lưu vào: ${out}`);
        console.log('   Paste refresh_token vào .env: LARK_KPI_GLOBAL_INDO_REFRESH_TOKEN=...\n');
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    server.listen(9999, () => {
      console.log('🔗 Auth URL (mở thủ công nếu browser không tự mở):');
      console.log('   ' + AUTH_URL + '\n');
      console.log('⏳ Đang chờ callback từ Lark...');
    });

    setTimeout(() => { server.close(); reject(new Error('Timeout sau 3 phút')); }, 180_000);
  });
}

main().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
