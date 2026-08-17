import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { GoogleStrategy } from "./strategies/google.strategy";
import { UsersModule } from "../users/users.module";
import { CacheModule } from "../../common/cache/cache.module";
import { getRuntimeJwtSecret } from "./jwt-secret.util";
import { CookieAuthService } from "./cookie-auth.service";

import { PrismaModule } from "../../common/prisma/prisma.module";

@Module({
  imports: [
    PrismaModule,
    UsersModule,
    CacheModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: getRuntimeJwtSecret(configService),
        signOptions: {
          // Cùng biến với AuthService.generateToken — hai chỗ lệch nhau thì token hết hạn một
          // đằng mà body báo một nẻo.
          expiresIn: configService.get<string>("JWT_ACCESS_EXPIRES") || "15m",
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GoogleStrategy, CookieAuthService],
  exports: [AuthService, CookieAuthService],
})
export class AuthModule {}


