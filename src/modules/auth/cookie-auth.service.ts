import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import {
  COOKIE_ACCESS,
  COOKIE_CSRF,
  COOKIE_REFRESH,
  REFRESH_COOKIE_PATH,
} from './cookie.constants';

/** Extractor cho passport-jwt — jwt.strategy.ts đọc access token qua đây. */
export function extractAccessTokenFromCookie(req: Request): string | null {
  return (req as Request & { cookies?: Record<string, string> })?.cookies?.[COOKIE_ACCESS] ?? null;
}

const ALLOWED_SAMESITE = ['lax', 'strict', 'none'] as const;
type SameSite = (typeof ALLOWED_SAMESITE)[number];

/**
 * FE và BE chạy trên domain khác nhau (không cùng site) → request axios/fetch từ FE gọi API là
 * cross-site, trình duyệt CHỈ đính kèm cookie khi SameSite=None. Sai định dạng (vd viết hoa
 * "None") thì trình duyệt âm thầm vứt cookie — login trông như thành công (BE set cookie 200) mà
 * request kế tiếp đã 401, nên phải ném lỗi ngay lúc khởi động thay vì đoán/fallback.
 */
function parseSameSite(value: string): SameSite {
  const normalized = value.trim().toLowerCase();
  if (!(ALLOWED_SAMESITE as readonly string[]).includes(normalized)) {
    throw new Error(
      `COOKIE_SAMESITE="${value}" không hợp lệ. Chỉ nhận ${ALLOWED_SAMESITE.join(' | ')}.`,
    );
  }
  return normalized as SameSite;
}

@Injectable()
export class CookieAuthService {
  constructor(private readonly config: ConfigService) {
    // Đọc ngay trong constructor để config sai làm app CHẾT LÚC KHỞI ĐỘNG chứ không phải lúc
    // người đầu tiên đăng nhập — Nest khởi tạo provider khi bootstrap, đây là thời điểm sớm nhất.
    this.baseOptions();
  }

  private baseOptions(): CookieOptions {
    const secure = this.config.get<string>('COOKIE_SECURE', 'false') === 'true';
    const sameSite = parseSameSite(this.config.get<string>('COOKIE_SAMESITE', 'lax'));

    // Trình duyệt VỨT BỎ cookie SameSite=None không kèm Secure. FE/BE khác domain bắt buộc dùng
    // none, nên cặp này sai là toàn bộ đăng nhập chết ngay ở production.
    if (sameSite === 'none' && !secure) {
      throw new Error(
        'COOKIE_SAMESITE="none" bắt buộc phải đi kèm COOKIE_SECURE="true", nếu không trình duyệt ' +
        'sẽ vứt bỏ toàn bộ cookie phiên.',
      );
    }

    return {
      httpOnly: true,
      secure,
      sameSite,
      path: '/',
    };
  }

  setAuthCookies(res: Response, tokens: { accessToken: string; refreshToken: string }): void {
    const accessMaxAge = this.parseDurationMs(this.config.get<string>('JWT_ACCESS_EXPIRES', '15m'));
    const refreshMaxAge = this.parseDurationMs(this.config.get<string>('JWT_REFRESH_EXPIRES', '7d'));

    res.cookie(COOKIE_ACCESS, tokens.accessToken, { ...this.baseOptions(), maxAge: accessMaxAge });

    res.cookie(COOKIE_REFRESH, tokens.refreshToken, {
      ...this.baseOptions(),
      maxAge: refreshMaxAge,
      // PHẢI khớp setGlobalPrefix('api') trong main.ts — route thật là /api/auth/refresh.
      path: REFRESH_COOKIE_PATH,
    });

    // Readable by FE for double-submit CSRF (not HttpOnly)
    res.cookie(COOKIE_CSRF, randomBytes(32).toString('hex'), {
      ...this.baseOptions(),
      httpOnly: false,
      maxAge: refreshMaxAge,
    });
  }

  clearAuthCookies(res: Response): void {
    const base = this.baseOptions();
    res.clearCookie(COOKIE_ACCESS, base);
    res.clearCookie(COOKIE_REFRESH, { ...base, path: REFRESH_COOKIE_PATH });
    res.clearCookie(COOKIE_CSRF, { ...base, httpOnly: false });
  }

  /** auth.controller.ts gọi ở catch-block /refresh: chỉ dọn cookie khi phiên thật sự chết (401). */
  clearIfUnauthorized(res: Response, err: unknown): void {
    if (err instanceof UnauthorizedException) {
      this.clearAuthCookies(res);
    }
  }

  private parseDurationMs(value: string): number {
    const v = value.trim().toLowerCase();
    const m = /^(\d+)([smhd])$/.exec(v);
    if (!m) return 15 * 60 * 1000;
    const n = Number(m[1]);
    const unit = m[2];
    const mult =
      unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    return n * mult;
  }
}
