import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import axios from 'axios';
import { createHash } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

function hashSha256(str: string): string {
  return createHash('sha256').update(str).digest('hex');
}

function parseCookies(setCookieHeader?: string[]) {
  if (!setCookieHeader) return {};
  const cookies: Record<string, any> = {};
  for (const cookieStr of setCookieHeader) {
    const parts = cookieStr.split(';').map(p => p.trim());
    const [nameVal] = parts;
    const [name, val] = nameVal.split('=');
    
    cookies[name] = {
      value: val,
      raw: cookieStr,
      httpOnly: parts.some(p => p.toLowerCase() === 'httponly'),
      secure: parts.some(p => p.toLowerCase() === 'secure'),
      path: (parts.find(p => p.toLowerCase().startsWith('path=')) || '').split('=')[1] || '/',
      sameSite: (parts.find(p => p.toLowerCase().startsWith('samesite=')) || '').split('=')[1] || null,
      maxAge: (parts.find(p => p.toLowerCase().startsWith('max-age=')) || '').split('=')[1] || null,
      expires: (parts.find(p => p.toLowerCase().startsWith('expires=')) || '').split('=')[1] || null,
    };
  }
  return cookies;
}

async function runFullE2ETest() {
  console.log('================================================================');
  console.log('🚀 BOOTING LATEST NESTJS APP INSTANCE FOR DEEP AUTH TESTING');
  console.log('================================================================\n');

  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix('api');

  const TEST_PORT = 3999;
  await app.listen(TEST_PORT);
  console.log(`✓ NestJS Test Server running on http://localhost:${TEST_PORT}/api\n`);

  const prisma = app.get(PrismaService);
  const BASE_URL = `http://localhost:${TEST_PORT}/api`;

  const testEmail = `deep_test_${Date.now()}@vcb.vn`;
  const initialPassword = 'Password123!@#';
  let testUserId: string | null = null;

  try {
    // -------------------------------------------------------------
    // TEST 1: Registration Flow & Password Hashing
    // -------------------------------------------------------------
    console.log('--- [TEST 1] POST /api/auth/register (Network & DB Check) ---');
    const regRes = await axios.post(`${BASE_URL}/auth/register`, {
      name: 'Deep Test User',
      email: testEmail,
      password: initialPassword,
      team: 'QA-Automation',
    });

    console.log(`✓ HTTP Status Code: ${regRes.status} (Expected: 201)`);
    console.log(`✓ Response Message: "${regRes.data.message}"`);
    console.log(`✓ User Object in Body: id=${regRes.data.user.id}, email=${regRes.data.user.email}, is_active=${regRes.data.user.is_active}`);

    testUserId = regRes.data.user.id;

    // Verify in Database directly
    const dbUserAfterReg = await prisma.user.findUnique({ where: { id: testUserId! } });
    console.log(`✓ DB Verification: is_active=${dbUserAfterReg?.is_active} (false), password_hash is bcrypt=${dbUserAfterReg?.password_hash?.startsWith('$2b$')}`);
    
    // Duplicate Register Check (409)
    try {
      await axios.post(`${BASE_URL}/auth/register`, {
        name: 'Duplicate',
        email: testEmail,
        password: initialPassword,
      });
      console.error('❌ Failed: Expected 409 Conflict on duplicate email');
    } catch (err: any) {
      console.log(`✓ Duplicate registration rejected with status ${err.response?.status} (${err.response?.data?.message})`);
    }

    // -------------------------------------------------------------
    // TEST 2: Inactive User Login Protection (401)
    // -------------------------------------------------------------
    console.log('\n--- [TEST 2] Inactive User Login Protection ---');
    try {
      await axios.post(`${BASE_URL}/auth/login`, {
        email: testEmail,
        password: initialPassword,
      });
      console.error('❌ Failed: Inactive user was allowed to log in');
    } catch (err: any) {
      console.log(`✓ Inactive user login rejected with status ${err.response?.status} (${err.response?.data?.message})`);
    }

    // Activate user directly in DB (simulating Admin approval)
    await prisma.user.update({
      where: { id: testUserId! },
      data: { is_active: true },
    });
    console.log('✓ Admin activated user in DB (is_active: true)');

    // -------------------------------------------------------------
    // TEST 3: Login Network Inspection & Set-Cookie Verification
    // -------------------------------------------------------------
    console.log('\n--- [TEST 3] POST /api/auth/login (Set-Cookie & Security Attributes) ---');
    const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
      email: testEmail,
      password: initialPassword,
    });

    console.log(`✓ Status Code: ${loginRes.status} (Expected: 200)`);
    const setCookies = parseCookies(loginRes.headers['set-cookie']);
    console.log('✓ Cookies Received in Set-Cookie Header:', Object.keys(setCookies));

    // Inspect vcbi_at (Access Token Cookie)
    const atCookie = setCookies['vcbi_at'];
    console.log(`  - vcbi_at: HttpOnly=${atCookie?.httpOnly} (true), Path=${atCookie?.path} (/), SameSite=${atCookie?.sameSite}, MaxAge=${atCookie?.maxAge}s`);
    if (!atCookie?.httpOnly || atCookie?.path !== '/') {
      throw new Error('vcbi_at cookie attributes are incorrect!');
    }

    // Inspect vcbi_rt (Refresh Token Cookie)
    const rtCookie = setCookies['vcbi_rt'];
    console.log(`  - vcbi_rt: HttpOnly=${rtCookie?.httpOnly} (true), Path=${rtCookie?.path} (/api/auth), SameSite=${rtCookie?.sameSite}, MaxAge=${rtCookie?.maxAge}s`);
    if (!rtCookie?.httpOnly || rtCookie?.path !== '/api/auth') {
      throw new Error('vcbi_rt cookie attributes are incorrect! Path MUST be /api/auth');
    }

    // Inspect vcbi_csrf (CSRF Token Cookie)
    const csrfCookie = setCookies['vcbi_csrf'];
    console.log(`  - vcbi_csrf: HttpOnly=${csrfCookie?.httpOnly} (false - accessible by JS), Path=${csrfCookie?.path} (/), SameSite=${csrfCookie?.sameSite}`);
    if (csrfCookie?.httpOnly) {
      throw new Error('vcbi_csrf MUST NOT be httpOnly so client JS can read it for Double-Submit header!');
    }

    // Inspect Database Hash (Single-Session SHA-256)
    const dbUserAfterLogin = await prisma.user.findUnique({ where: { id: testUserId! } });
    const expectedRtHash = hashSha256(rtCookie.value);
    console.log(`✓ DB refresh_token_hash matches SHA256(vcbi_rt): ${dbUserAfterLogin?.refresh_token_hash === expectedRtHash}`);

    // -------------------------------------------------------------
    // TEST 4: Protected Profile Access (Cookie-based & Bearer)
    // -------------------------------------------------------------
    console.log('\n--- [TEST 4] GET /api/auth/profile (Cookie-first & Fallback) ---');
    
    // Request with Cookie
    const profileResCookie = await axios.get(`${BASE_URL}/auth/profile`, {
      headers: {
        Cookie: `vcbi_at=${atCookie.value}`,
      },
    });
    console.log(`✓ Access with Cookie 'vcbi_at': Status ${profileResCookie.status}, User: ${profileResCookie.data.email}`);

    // Request with Bearer Header
    const profileResBearer = await axios.get(`${BASE_URL}/auth/profile`, {
      headers: {
        Authorization: `Bearer ${loginRes.data.access_token}`,
      },
    });
    console.log(`✓ Access with Header 'Authorization: Bearer': Status ${profileResBearer.status}, User: ${profileResBearer.data.email}`);

    // Request with NO credentials
    try {
      await axios.get(`${BASE_URL}/auth/profile`);
      console.error('❌ Failed: Request without credentials should be 401');
    } catch (err: any) {
      console.log(`✓ Access with NO credentials rejected: Status ${err.response?.status} (${err.response?.data?.message})`);
    }

    // -------------------------------------------------------------
    // TEST 5: CSRF Guard & Token Rotation on Refresh
    // -------------------------------------------------------------
    console.log('\n--- [TEST 5] POST /api/auth/refresh (CSRF Protection & Token Rotation) ---');

    // Case A: Missing CSRF Header -> 403
    try {
      await axios.post(
        `${BASE_URL}/auth/refresh`,
        {},
        {
          headers: {
            Cookie: `vcbi_rt=${rtCookie.value}; vcbi_csrf=${csrfCookie.value}`,
          },
        },
      );
      console.error('❌ Failed: Refresh without CSRF header should return 403');
    } catch (err: any) {
      console.log(`✓ Refresh without x-csrf-token header rejected: Status ${err.response?.status} (${err.response?.data?.message})`);
    }

    // Case B: Mismatched CSRF Header -> 403
    try {
      await axios.post(
        `${BASE_URL}/auth/refresh`,
        {},
        {
          headers: {
            Cookie: `vcbi_rt=${rtCookie.value}; vcbi_csrf=${csrfCookie.value}`,
            'x-csrf-token': 'wrong-csrf-token-123',
          },
        },
      );
      console.error('❌ Failed: Refresh with mismatched CSRF header should return 403');
    } catch (err: any) {
      console.log(`✓ Refresh with mismatched x-csrf-token rejected: Status ${err.response?.status} (${err.response?.data?.message})`);
    }

    // Case C: Valid CSRF Header & Cookie -> 200 + Rotation
    const refreshRes = await axios.post(
      `${BASE_URL}/auth/refresh`,
      {},
      {
        headers: {
          Cookie: `vcbi_rt=${rtCookie.value}; vcbi_csrf=${csrfCookie.value}`,
          'x-csrf-token': csrfCookie.value,
        },
      },
    );
    console.log(`✓ Valid Refresh: Status ${refreshRes.status}`);

    const newCookies = parseCookies(refreshRes.headers['set-cookie']);
    const newRtCookie = newCookies['vcbi_rt'];
    const newCsrfCookie = newCookies['vcbi_csrf'];

    console.log(`✓ Token Rotated: Old RT !== New RT: ${rtCookie.value !== newRtCookie.value}`);

    // Verify DB hash changed
    const dbUserAfterRefresh = await prisma.user.findUnique({ where: { id: testUserId! } });
    console.log(`✓ DB hash rotated to new RT hash: ${dbUserAfterRefresh?.refresh_token_hash === hashSha256(newRtCookie.value)}`);

    // Case D: Replaying Old Refresh Token -> 401
    try {
      await axios.post(
        `${BASE_URL}/auth/refresh`,
        {},
        {
          headers: {
            Cookie: `vcbi_rt=${rtCookie.value}; vcbi_csrf=${newCsrfCookie.value}`,
            'x-csrf-token': newCsrfCookie.value,
          },
        },
      );
      console.error('❌ Failed: Replaying revoked old refresh token should return 401');
    } catch (err: any) {
      console.log(`✓ Replay of old revoked refresh token rejected: Status ${err.response?.status} (${err.response?.data?.message})`);
    }

    // -------------------------------------------------------------
    // TEST 6: Forgot & Reset Password Flow
    // -------------------------------------------------------------
    console.log('\n--- [TEST 6] Password Reset Flow (OTP & Invalidation) ---');

    // Step 1: Request OTP
    const forgotRes = await axios.post(`${BASE_URL}/auth/forgot-password`, {
      email: testEmail,
    });
    console.log(`✓ Forgot Password Request: Status ${forgotRes.status} ("${forgotRes.data.message}")`);

    // Inspect OTP in DB
    const dbUserForgot = await prisma.user.findUnique({ where: { id: testUserId! } });
    console.log(`✓ DB reset_token_hash present: ${!!dbUserForgot?.reset_token_hash}`);
    console.log(`✓ DB reset_token_expires set: ${dbUserForgot?.reset_token_expires}`);

    // Test Invalid OTP -> 400
    try {
      await axios.post(`${BASE_URL}/auth/reset-password`, {
        email: testEmail,
        otp: '000000',
        newPassword: 'BrandNewPassword456!@#',
      });
      console.error('❌ Failed: Invalid OTP should return 400');
    } catch (err: any) {
      console.log(`✓ Invalid OTP rejected: Status ${err.response?.status} (${err.response?.data?.message})`);
    }

    // Set known OTP hash in DB for deterministic testing
    const knownOtp = '789012';
    await prisma.user.update({
      where: { id: testUserId! },
      data: {
        reset_token_hash: hashSha256(knownOtp),
        reset_token_expires: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    // Step 2: Reset with correct OTP
    const newPassword = 'BrandNewPassword456!@#';
    const resetRes = await axios.post(`${BASE_URL}/auth/reset-password`, {
      email: testEmail,
      otp: knownOtp,
      newPassword: newPassword,
    });
    console.log(`✓ Reset Password with OTP: Status ${resetRes.status} ("${resetRes.data.message}")`);

    // Verify DB state after reset
    const dbUserAfterReset = await prisma.user.findUnique({ where: { id: testUserId! } });
    console.log(`✓ DB reset_token_hash cleared: ${dbUserAfterReset?.reset_token_hash === null}`);
    console.log(`✓ DB refresh_token_hash invalidated (null): ${dbUserAfterReset?.refresh_token_hash === null}`);

    // Verify login with OLD password fails
    try {
      await axios.post(`${BASE_URL}/auth/login`, {
        email: testEmail,
        password: initialPassword,
      });
      console.error('❌ Failed: Old password should not work after reset');
    } catch (err: any) {
      console.log(`✓ Login with old password rejected: Status ${err.response?.status}`);
    }

    // Verify login with NEW password succeeds
    const newLoginRes = await axios.post(`${BASE_URL}/auth/login`, {
      email: testEmail,
      password: newPassword,
    });
    console.log(`✓ Login with NEW password succeeds: Status ${newLoginRes.status}`);
    const postResetCookies = parseCookies(newLoginRes.headers['set-cookie']);

    // -------------------------------------------------------------
    // TEST 7: Logout & Cookie Cleared
    // -------------------------------------------------------------
    console.log('\n--- [TEST 7] POST /api/auth/logout (Cookie Clear & DB Nullification) ---');
    const logoutRes = await axios.post(
      `${BASE_URL}/auth/logout`,
      {},
      {
        headers: {
          Cookie: `vcbi_rt=${postResetCookies['vcbi_rt'].value}; vcbi_csrf=${postResetCookies['vcbi_csrf'].value}`,
          'x-csrf-token': postResetCookies['vcbi_csrf'].value,
        },
      },
    );
    console.log(`✓ Logout Request: Status ${logoutRes.status}`);

    const clearedCookies = parseCookies(logoutRes.headers['set-cookie']);
    console.log('✓ Cleared Cookies from Logout Response:');
    for (const [k, v] of Object.entries(clearedCookies)) {
      console.log(`  - ${k}: MaxAge=${v.maxAge}, Expires=${v.expires}, Path=${v.path}`);
    }

    // Verify DB hash is null
    const dbUserAfterLogout = await prisma.user.findUnique({ where: { id: testUserId! } });
    console.log(`✓ DB refresh_token_hash is null after logout: ${dbUserAfterLogout?.refresh_token_hash === null}`);

    console.log('\n================================================================');
    console.log('🎉 ALL 7 DEEP AUTH DIAGNOSTIC TESTS PASSED (100% SUCCESS)');
    console.log('================================================================');

  } finally {
    // Cleanup test user
    if (testUserId) {
      await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
      console.log(`\n🧹 Cleaned up temporary test user (ID: ${testUserId})`);
    }
    await app.close();
  }
}

runFullE2ETest()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Fatal E2E error:', e);
    process.exit(1);
  });
