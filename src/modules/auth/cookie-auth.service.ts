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

function parseSameSite(value: string): SameSite {
  const normalized = (value || '').trim().toLowerCase();
  if (!(ALLOWED_SAMESITE as readonly string[]).includes(normalized)) {
    return 'lax';
  }
  return normalized as SameSite;
}

@Injectable()
export class CookieAuthService {
  constructor(private readonly config: ConfigService) {}

  private baseOptions(): CookieOptions {
    const domain = this.config.get<string>('COOKIE_DOMAIN', '').trim();
    const secure = this.config.get<string>('COOKIE_SECURE', 'false') === 'true';
    const sameSite = parseSameSite(this.config.get<string>('COOKIE_SAMESITE', 'lax'));
    return {
      httpOnly: true,
      secure,
      sameSite,
      path: '/',
      ...(domain ? { domain } : {}),
    };
  }

  setAuthCookies(
    res: Response,
    tokens: { accessToken: string; refreshToken: string },
  ): void {
    const accessMaxAge = this.parseDurationMs(
      this.config.get<string>('JWT_ACCESS_EXPIRES', '7d'),
    );
    const refreshMaxAge = this.parseDurationMs(
      this.config.get<string>('JWT_REFRESH_EXPIRES', '30d'),
    );
    const csrf = randomBytes(32).toString('hex');

    res.cookie(COOKIE_ACCESS, tokens.accessToken, {
      ...this.baseOptions(),
      maxAge: accessMaxAge,
    });

    res.cookie(COOKIE_REFRESH, tokens.refreshToken, {
      ...this.baseOptions(),
      maxAge: refreshMaxAge,
      path: REFRESH_COOKIE_PATH,
    });

    res.cookie(COOKIE_CSRF, csrf, {
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
    if (!m) return 7 * 24 * 60 * 60 * 1000;
    const n = Number(m[1]);
    const unit = m[2];
    const mult =
      unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    return n * mult;
  }
}

