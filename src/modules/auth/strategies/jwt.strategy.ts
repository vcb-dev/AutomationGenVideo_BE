import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../common/prisma/prisma.service";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    const secret =
      configService.get<string>("JWT_SECRET") ||
      "default-dev-secret-change-in-production";
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        full_name: true,
        role: true,
        manager_id: true,
        is_active: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!user || !user.is_active) {
      throw new UnauthorizedException("Invalid or inactive user");
    }

    return user;
  }
}
