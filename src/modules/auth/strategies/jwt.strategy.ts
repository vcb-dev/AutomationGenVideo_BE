import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { CacheService } from "../../../common/cache/cache.service";
import { getRuntimeJwtSecret } from "../jwt-secret.util";

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
      // Accept token from Authorization header OR ?access_token= (needed for video stream in <video> tags)
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
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
          custom_permissions: true,
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
