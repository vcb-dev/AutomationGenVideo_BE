import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import {
  COOKIE_ACCESS,
  COOKIE_CSRF,
  COOKIE_REFRESH,
  REFRESH_COOKIE_PATH,
} from './cookie.constants';

const UNIT_TO_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Sai định dạng thì NÉM LỖI chứ không rơi về mặc định. Bản mẫu tham chiếu trả im lặng 15 phút khi
 * parse hỏng — gõ nhầm `JWT_ACCESS_EXPIRES=15x` là cả công ty bị đá ra sau 15 phút, mà nhìn file
 * config thì mọi thứ vẫn rất hợp lệ. Nổ lúc khởi động đắt vài giây, đoán mò tốn cả buổi.
 */
export function parseDurationMs(value: string, envName: string): number {
  const matched = /^(\d+)([smhd])$/.exec(String(value).trim().toLowerCase());
  if (!matched) {
    throw new Error(
      `${envName}="${value}" sai định dạng. Chỉ nhận <số><s|m|h|d>, ví dụ "15m" hoặc "7d".`,
    );
  }
  return Number(matched[1]) * UNIT_TO_MS[matched[2]];
}

/** Extractor cho passport-jwt. Trả null (không phải undefined) vì ExtractJwt quy ước như vậy. */
export function extractAccessTokenFromCookie(req: Request): string | null {
  return (req as Request & { cookies?: Record<string, string> })?.cookies?.[COOKIE_ACCESS] ?? null;
}

@Injectable()
export class CookieAuthService {
  constructor(private readonly config: ConfigService) {
    // Đọc ngay trong constructor để config sai làm app CHẾT LÚC KHỞI ĐỘNG chứ không phải lúc người
    // đầu tiên đăng nhập. Nest khởi tạo provider khi bootstrap, nên đây là thời điểm sớm nhất phát
    // hiện được. Deploy hỏng vì env sai thì thà biết ngay ở dòng log đầu tiên.
    this.accessMaxAge();
    this.refreshMaxAge();
  }

  accessMaxAge(): number {
    return parseDurationMs(
      this.config.get<string>('JWT_ACCESS_EXPIRES', '15m'),
      'JWT_ACCESS_EXPIRES',
    );
  }

  refreshMaxAge(): number {
    return parseDurationMs(
      this.config.get<string>('JWT_REFRESH_EXPIRES', '7d'),
      'JWT_REFRESH_EXPIRES',
    );
  }

  setAuthCookies(res: Response, tokens: { accessToken: string; refreshToken: string }): void {
    const base = this.baseOptions();

    res.cookie(COOKIE_ACCESS, tokens.accessToken, { ...base, maxAge: this.accessMaxAge() });

    res.cookie(COOKIE_REFRESH, tokens.refreshToken, {
      ...base,
      maxAge: this.refreshMaxAge(),
      path: REFRESH_COOKIE_PATH,
    });

    // Cookie DUY NHẤT không HttpOnly: double-submit chỉ chạy được khi FE đọc được giá trị này rồi
    // gửi lại qua header x-csrf-token. Nó không phải bí mật xác thực — kẻ tấn công CSRF không đọc
    // được cookie của nạn nhân nên không dựng được header khớp.
    res.cookie(COOKIE_CSRF, randomBytes(32).toString('hex'), {
      ...base,
      httpOnly: false,
      maxAge: this.refreshMaxAge(),
    });
  }

  clearAuthCookies(res: Response): void {
    // Dùng chung baseOptions() với setAuthCookies. Trình duyệt chỉ xoá khi path/domain khớp với lúc
    // đặt, nên hai hàm trôi lệch nhau là cookie xoá hụt: người dùng bấm đăng xuất mà phiên vẫn sống.
    // Bản mẫu tham chiếu lặp lại options bằng tay ở cả hai chỗ — chính là cái bẫy đó.
    const base = this.baseOptions();
    res.clearCookie(COOKIE_ACCESS, base);
    res.clearCookie(COOKIE_REFRESH, { ...base, path: REFRESH_COOKIE_PATH });
    res.clearCookie(COOKIE_CSRF, { ...base, httpOnly: false });
  }

  private baseOptions(): CookieOptions {
    const domain = this.config.get<string>('COOKIE_DOMAIN', '').trim();
    return {
      httpOnly: true,
      secure: this.config.get<string>('COOKIE_SECURE', 'false') === 'true',
      sameSite: this.config.get<'lax' | 'strict' | 'none'>('COOKIE_SAMESITE', 'lax'),
      path: '/',
      ...(domain ? { domain } : {}),
    };
  }
}
