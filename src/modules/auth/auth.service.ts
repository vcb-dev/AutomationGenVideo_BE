import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
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
  ) { }

  async login(loginDto: LoginDto): Promise<TokenResponseDto> {
    const user = await this.validateUser(loginDto.email, loginDto.password);

    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }

    if (!user.is_active) {
      throw new UnauthorizedException("User account is inactive");
    }

    return this.generateToken(user);
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
      // KHÔNG throw ở đây: hàm này chạy bên trong passport validate() — exception sẽ bị
      // AuthGuard('google') chặn thành trang 401 JSON thô trước khi controller kịp redirect.
      // Trả user (kể cả inactive) để strategy/controller quyết định điều hướng thân thiện.
      // If user exists but no google_id, link it
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

  async generateToken(user: any): Promise<TokenResponseDto> {
    const payload = {
      sub: user.id,
      email: user.email,
      roles: user.roles,
    };

    const access_token = this.jwtService.sign(payload);
    // Default session lifetime: 5 hours
    const expiresIn = this.configService.get<string>("JWT_EXPIRES_IN") || "5h";

    // Remove password_hash from response
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password_hash: _password_hash, ...userWithoutPassword } = user;

    return {
      access_token,
      token_type: "Bearer",
      expires_in: expiresIn,
      user: new UserResponseDto(userWithoutPassword),
    };
  }

}
