import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { createHash } from "crypto";
import { UsersService } from "../users/users.service";
import { LoginDto } from "./dto/login.dto";
import { TokenResponseDto } from "./dto/token-response.dto";
import { UserResponseDto } from "../users/dto/user-response.dto";
import * as bcrypt from "bcrypt";

function isBcryptPasswordHash(stored: string): boolean {
  return typeof stored === "string" && /^\$2[aby]\$\d{2}\$/.test(stored);
}

export interface GoogleUser {
  email: string;
  firstName: string;
  lastName: string;
  picture: string;
  googleId: string;
  accessToken?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  /** SHA-256 hex — dùng để lưu bản băm refresh token xuống DB, không bao giờ lưu token thô. */
  hashSha256(data: string): string {
    return createHash("sha256").update(data).digest("hex");
  }

  /** Điểm vào duy nhất cho controller /login: kiểm tra thông tin đăng nhập rồi cấp phiên luôn. */
  async login(
    loginDto: LoginDto,
  ): Promise<{ tokenResponse: TokenResponseDto; refreshToken: string }> {
    const user = await this.validateUser(loginDto.email, loginDto.password);

    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }

    if (!user.is_active) {
      throw new UnauthorizedException("User account is inactive");
    }

    return this.issueSession(user);
  }

  /**
   * Cấp một phiên hoàn chỉnh: access token + refresh token (đều là JWT). Refresh token thô chỉ đi
   * ra ngoài qua cookie HttpOnly — người gọi KHÔNG được đưa nó vào body response. Bản băm SHA-256
   * của nó ghi đè users.refresh_token_hash: đăng nhập/refresh ở thiết bị mới sẽ tự đá thiết bị cũ
   * ra ở lần refresh kế tiếp (single-session, khác với rotation theo family trước đây).
   */
  async issueSession(
    user: any,
  ): Promise<{ tokenResponse: TokenResponseDto; refreshToken: string }> {
    const { refreshToken, refreshTokenHash, tokenResponse } = this.generateTokens(user);
    await this.usersService.updateRefreshTokenHash(user.id, refreshTokenHash);
    return { tokenResponse, refreshToken };
  }

  async validateUser(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      return null;
    }

    if (!user.password_hash) {
      return null;
    }

    let isPasswordValid = false;
    if (isBcryptPasswordHash(user.password_hash)) {
      isPasswordValid = await bcrypt.compare(password, user.password_hash);
    } else {
      if (password === user.password_hash) {
        isPasswordValid = true;
        // Fire-and-forget: rehash nền, không block login flow
        this.usersService.rehashPasswordFromPlain(user.id, password).catch(() => {});
      }
    }

    if (!isPasswordValid) {
      return null;
    }

    return user;
  }

  async validateGoogleUser(googleUser: GoogleUser) {
    // Check if user exists by email
    const emailLowerCase = googleUser.email.toLowerCase();
    let user = await this.usersService.findByEmail(emailLowerCase);

    if (user) {
      if (!(user as any).google_id) {
        const updateData: any = {
          google_id: googleUser.googleId,
        };
        // ONLY update image_url if it's currently empty
        if (!user.image_url) {
          updateData.image_url = googleUser.picture;
        }
        await this.usersService.update(user.id, updateData);
        user = await this.usersService.findByEmail(emailLowerCase); // Refresh
      }
      return user;
    }

    // Không tìm thấy tài khoản — không còn tự tạo qua Google nữa. Tài khoản phải
    // được Admin/Leader tạo trước (trang HR-management) mới đăng nhập được.
    return null;
  }

  private generateTokens(user: any): {
    accessToken: string;
    refreshToken: string;
    refreshTokenHash: string;
    tokenResponse: TokenResponseDto;
  } {
    const payload = { sub: user.id, email: user.email, roles: user.roles };

    // Một biến duy nhất chi phối hạn mỗi loại token. Hai chỗ đọc hai biến khác nhau cho cùng một
    // hạn là mời gọi sự cố khi chúng lệch nhau.
    const accessExpires = this.configService.get<string>("JWT_ACCESS_EXPIRES") || "15m";
    const refreshExpires = this.configService.get<string>("JWT_REFRESH_EXPIRES") || "7d";

    const accessToken = this.jwtService.sign(payload, { expiresIn: accessExpires as any });
    const refreshToken = this.jwtService.sign(payload, { expiresIn: refreshExpires as any });
    const refreshTokenHash = this.hashSha256(refreshToken);

    // password_hash và refresh_token_hash KHÔNG BAO GIỜ được lọt vào response.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password_hash: _password_hash, refresh_token_hash: _refresh_token_hash, ...userWithoutSecrets } =
      user;

    const tokenResponse: TokenResponseDto = {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: accessExpires,
      user: new UserResponseDto(userWithoutSecrets),
    };

    return { accessToken, refreshToken, refreshTokenHash, tokenResponse };
  }

  async refreshTokens(
    rawToken: string,
  ): Promise<{ tokenResponse: TokenResponseDto; refreshToken: string }> {
    if (!rawToken) {
      throw new UnauthorizedException("Thiếu Refresh Token");
    }

    let payload: { sub: string };
    try {
      payload = this.jwtService.verify(rawToken);
    } catch {
      throw new UnauthorizedException("Refresh Token không hợp lệ hoặc đã hết hạn");
    }

    const user = await this.usersService.findByIdForAuth(payload.sub);

    if (!user || !user.is_active) {
      throw new UnauthorizedException("Tài khoản không còn hoạt động");
    }

    const incomingHash = this.hashSha256(rawToken);
    if (!user.refresh_token_hash || user.refresh_token_hash !== incomingHash) {
      throw new UnauthorizedException("Refresh Token không hợp lệ hoặc đã bị thu hồi");
    }

    return this.issueSession(user);
  }

  decodeRefreshTokenUserId(rawToken: string): string | null {
    const payload = this.jwtService.decode(rawToken) as { sub?: string } | null;
    return payload?.sub ?? null;
  }

  async logout(userId?: string): Promise<void> {
    if (userId) {
      await this.usersService.updateRefreshTokenHash(userId, null);
    }
  }

  async logoutFromRefreshToken(rawToken?: string): Promise<void> {
    if (!rawToken) return;
    const userId = this.decodeRefreshTokenUserId(rawToken);
    await this.logout(userId ?? undefined);
  }

  private loginErrorRedirect(message: string): string {
    const frontendUrl = this.configService.get<string>("FRONTEND_URL") || "http://localhost:3001";
    return `${frontendUrl}/login?error=${encodeURIComponent(message)}`;
  }

  async resolveGoogleLogin(googleAuthUser: any): Promise<{
    redirectUrl: string;
    session?: { accessToken: string; refreshToken: string };
  }> {
    if (googleAuthUser.isInactiveUser) {
      return {
        redirectUrl: this.loginErrorRedirect(
          "Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ Admin để được kích hoạt lại.",
        ),
      };
    }

    if (googleAuthUser.isNewUser) {
      return {
        redirectUrl: this.loginErrorRedirect(
          "Tài khoản chưa được tạo. Vui lòng liên hệ Leader/Admin để được cấp quyền truy cập.",
        ),
      };
    }

    const { tokenResponse, refreshToken } = await this.issueSession(googleAuthUser);

    return {
      redirectUrl: `${this.configService.get<string>("FRONTEND_URL") || "http://localhost:3001"}/auth/google/callback`,
      session: { accessToken: tokenResponse.access_token, refreshToken },
    };
  }

  googleErrorRedirect(): string {
    return this.loginErrorRedirect(
      "Đăng nhập Google thất bại. Vui lòng thử lại hoặc liên hệ Admin.",
    );
  }
}
