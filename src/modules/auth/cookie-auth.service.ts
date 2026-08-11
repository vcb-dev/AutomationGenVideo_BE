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

const ALLOWED_SAMESITE = ['lax', 'strict', 'none'] as const;
type SameSite = (typeof ALLOWED_SAMESITE)[number];

/**
 * Cùng lý do với parseDurationMs. `COOKIE_SAMESITE="Lax"` viết hoa chữ L thì Express vẫn ghi
 * nguyên vào header, trình duyệt không nhận ra giá trị và VỨT CẢ COOKIE — đăng nhập trông như
 * thành công (BE trả 200) mà request kế tiếp đã là 401.
 */
export function parseSameSite(value: string, envName: string): SameSite {
  const normalized = String(value).trim().toLowerCase();
  if (!(ALLOWED_SAMESITE as readonly string[]).includes(normalized)) {
    throw new Error(
      `${envName}="${value}" không hợp lệ. Chỉ nhận ${ALLOWED_SAMESITE.join(' | ')}.`,
    );
  }
  return normalized as SameSite;
}

/**
 * `=== 'true'` là cái bẫy im lặng nhất trong nhóm này: gõ `COOKIE_SECURE="True"` hay `"1"` đều ra
 * false, tức là production tưởng đang bật secure mà cookie phiên vẫn đi qua HTTP trần. Không có
 * dấu hiệu nào để nhận ra, nên phải ném lỗi thay vì đoán.
 */
export function parseBooleanEnv(value: string, envName: string): boolean {
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`${envName}="${value}" không hợp lệ. Chỉ nhận "true" hoặc "false".`);
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
    this.baseOptions();
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
    const secure = parseBooleanEnv(
      this.config.get<string>('COOKIE_SECURE', 'false'),
      'COOKIE_SECURE',
    );
    const sameSite = parseSameSite(
      this.config.get<string>('COOKIE_SAMESITE', 'lax'),
      'COOKIE_SAMESITE',
    );

    // Trình duyệt VỨT BỎ cookie SameSite=None mà không kèm Secure. Cặp này chỉ dùng khi FE và BE
    // khác site, đúng lúc không ai kịp nhận ra vì sao mọi người vừa deploy xong là đăng nhập hỏng.
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
      ...(domain ? { domain } : {}),
    };
  }
}
