import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { UsersService } from "../users/users.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
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

  async register(registerDto: RegisterDto): Promise<TokenResponseDto> {
    // For EDITOR and CONTENT roles, auto-assign the default manager
    // Manager assignment will be handled after login via UI selection
    // if (registerDto.role === "EDITOR" || registerDto.role === "CONTENT") { ... } removed

    const user = await this.usersService.create(registerDto);
    return this.generateToken(user);
  }

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

    // If user has no password (e.g. Google user attempting password login)
    if (!user.password_hash) {
      return null;
    }

    let isPasswordValid = false;
    if (isBcryptPasswordHash(user.password_hash)) {
      isPasswordValid = await bcrypt.compare(password, user.password_hash);
    } else {
      // Legacy: mật khẩu lưu plain text trong DB → cho đăng nhập và chuyển sang bcrypt
      if (password === user.password_hash) {
        isPasswordValid = true;
        try {
          await this.usersService.rehashPasswordFromPlain(user.id, password);
        } catch {
          /* vẫn cho login; lần sau có thể cần sửa DB tay */
        }
      }
    }

    if (!isPasswordValid) {
      return null;
    }

    return this.usersService.findByEmail(email);
  }

  async validateGoogleUser(googleUser: GoogleUser) {
    // Check if user exists by email
    const emailLowerCase = googleUser.email.toLowerCase();
    let user = await this.usersService.findByEmail(emailLowerCase);

    if (user) {
      // If user exists but no google_id, link it
      if (!(user as any).google_id) {
        await this.usersService.update(user.id, {
          google_id: googleUser.googleId,
          image_url: googleUser.picture,
        } as any);
        user = await this.usersService.findByEmail(emailLowerCase); // Refresh
      }
      return user;
    }

    // User does not exist - return null to indicate new user
    // Frontend will handle role selection
    return null;
  }

  async completeGoogleRegistration(googleUser: GoogleUser, role: string) {
    // Check if user already exists
    const emailLowerCase = googleUser.email.toLowerCase();
    const existingUser = await this.usersService.findByEmail(emailLowerCase);
    if (existingUser) {
      throw new UnauthorizedException("User already exists");
    }

    // Prepare user data - always assign MEMBER role for new users
    const userData: any = {
      email: emailLowerCase,
      full_name: `${googleUser.firstName} ${googleUser.lastName}`.trim(),
      password: "", // Will be set to null by UsersService
      roles: ["MEMBER"],
    };

    // Auto-assign default manager for EDITOR and CONTENT roles
    // Manager assignment will be handled after login via UI selection
    // if (role === "EDITOR" || role === "CONTENT") { ... } removed

    // Create user
    const newUser = await this.usersService.create(userData);

    // Update with Google-specific fields
    await this.usersService.update(newUser.id, {
      google_id: googleUser.googleId,
      image_url: googleUser.picture,
      password_hash: null, // Ensure it is null for Google users
    } as any);

    // Fetch updated user
    return this.usersService.findByEmail(googleUser.email);
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

  createTempToken(googleUser: GoogleUser): string {
    return this.jwtService.sign(
      {
        googleUser: {
          email: googleUser.email,
          firstName: googleUser.firstName,
          lastName: googleUser.lastName,
          picture: googleUser.picture,
          googleId: googleUser.googleId,
        },
        isTemp: true,
      },
      { expiresIn: "10m" },
    );
  }

  verifyTempToken(token: string): any {
    return this.jwtService.verify(token);
  }
}
