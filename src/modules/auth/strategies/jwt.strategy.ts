import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { CacheService } from "../../../common/cache/cache.service";
import { getRuntimeJwtSecret } from "../jwt-secret.util";
import { extractAccessTokenFromCookie } from "../cookie-auth.service";

/** TTL for cached JWT user lookups — short enough to pick up role changes, long enough to cut DB load. */
const JWT_USER_CACHE_TTL_MS = 45_000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private cacheService: CacheService,
  ) {
    const secret = getRuntimeJwtSecret(configService);
    super({
      // Thứ tự có ý nghĩa: cookie đứng trước để trình duyệt luôn dùng đường an toàn, kể cả khi
      // một đoạn code cũ còn sót lại vẫn gắn Bearer header.
      jwtFromRequest: ExtractJwt.fromExtractors([
        extractAccessTokenFromCookie,
        // Giữ cho Swagger "Try it out", curl và script nội bộ — các client này không có cookie jar.
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // GỠ Ở BƯỚC DEPLOY 4 (xem docs/plans/2026-08-08-auth-cookie-httponly.md). Còn ở đây vì FE
        // bản cũ đang dùng nó cho SSE thông báo (EventSource không set được header). Gỡ sớm thì
        // giữa hai lần deploy người dùng vẫn đăng nhập được nhưng mất sạch thông báo realtime —
        // hỏng âm thầm, rất khó lần ra.
        ExtractJwt.fromUrlQueryParameter('access_token'),
      ]),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: any) {
    const cacheKey = `jwt:user:${payload.sub}`;

    const user = await this.cacheService.get(cacheKey, JWT_USER_CACHE_TTL_MS, () =>
      this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          full_name: true,
          roles: true,
          manager_id: true,
          is_active: true,
          team: true,
          created_at: true,
          updated_at: true,
        },
      }),
    );

    if (!user || !user.is_active) {
      throw new UnauthorizedException("Invalid or inactive user");
    }

    return user;
  }
}
