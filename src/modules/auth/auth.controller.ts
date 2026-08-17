import {
  Controller,
  Post,
  Body,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  ClassSerializerInterceptor,
  Req,
  Res,
} from "@nestjs/common";
import { Request, Response } from "express";
import { AuthGuard } from "@nestjs/passport";
import { Throttle, SkipThrottle } from "@nestjs/throttler";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { ForgotPasswordDto, ResetPasswordDto } from "./dto/password-reset.dto";
import { TokenResponseDto } from "./dto/token-response.dto";
import { UserResponseDto } from "../users/dto/user-response.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { CsrfGuard } from "./guards/csrf.guard";
import { CurrentUser } from "./decorators/current-user.decorator";
import { CookieAuthService } from "./cookie-auth.service";
import { COOKIE_REFRESH } from "./cookie.constants";
import { SkipCsrf } from "./decorators/skip-csrf.decorator";

@ApiTags("auth")
@Controller("auth")
@SkipThrottle({ long: true, short: true })
@UseInterceptors(ClassSerializerInterceptor)
@UseGuards(CsrfGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cookieAuthService: CookieAuthService,
  ) {}

  @SkipCsrf()
  @Throttle({ short: { ttl: 60000, limit: 10 } })
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Login user" })
  @ApiResponse({
    status: 200,
    description: "Login successful",
    type: TokenResponseDto,
  })
  @ApiResponse({ status: 401, description: "Invalid credentials" })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponseDto> {
    const { tokenResponse, refreshToken } = await this.authService.login(loginDto);

    this.cookieAuthService.setAuthCookies(res, {
      accessToken: tokenResponse.access_token,
      refreshToken,
    });

    // access_token VẪN nằm trong body cho Swagger / curl / script nội bộ — FE mới không đọc nó.
    // refreshToken thì TUYỆT ĐỐI không: nó chỉ được phép tồn tại trong cookie HttpOnly.
    return tokenResponse;
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Xoay vòng refresh token, cấp lại cookie" })
  @ApiResponse({ status: 200, description: "Cấp lại phiên thành công", type: TokenResponseDto })
  @ApiResponse({ status: 401, description: "Refresh token thiếu, hết hạn hoặc đã bị thu hồi" })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponseDto> {
    const rawToken = (req as Request & { cookies?: Record<string, string> }).cookies?.[
      COOKIE_REFRESH
    ];

    try {
      const { tokenResponse, refreshToken } = await this.authService.refreshTokens(rawToken);
      this.cookieAuthService.setAuthCookies(res, {
        accessToken: tokenResponse.access_token,
        refreshToken,
      });

      return tokenResponse;
    } catch (err) {
      this.cookieAuthService.clearIfUnauthorized(res, err);
      throw err;
    }
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Đăng xuất" })
  @ApiResponse({ status: 200, description: "Đã đăng xuất" })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: boolean }> {
    const rawToken = (req as Request & { cookies?: Record<string, string> }).cookies?.[
      COOKIE_REFRESH
    ];

    await this.authService.logoutFromRefreshToken(rawToken);

    // Xoá cookie kể cả khi không có token: người dùng bấm đăng xuất thì phải được đăng xuất.
    this.cookieAuthService.clearAuthCookies(res);
    return { success: true };
  }

  @SkipCsrf()
  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Đăng ký tài khoản mới (chờ Admin phê duyệt)" })
  @ApiResponse({ status: 201, description: "Đăng ký thành công, chờ phê duyệt" })
  @ApiResponse({ status: 409, description: "Email đã tồn tại" })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @SkipCsrf()
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @Post("forgot-password")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Yêu cầu OTP đặt lại mật khẩu" })
  @ApiResponse({ status: 200, description: "OTP đã được gửi (nếu email tồn tại)" })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @SkipCsrf()
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @Post("reset-password")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Đặt lại mật khẩu bằng OTP" })
  @ApiResponse({ status: 200, description: "Đặt lại mật khẩu thành công" })
  @ApiResponse({ status: 400, description: "OTP sai hoặc hết hạn" })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @SkipCsrf()
  @Get("profile")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get current user profile" })
  @ApiResponse({
    status: 200,
    description: "User profile",
    type: UserResponseDto,
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  getProfile(@CurrentUser() user: any) {
    return new UserResponseDto(user);
  }

  @SkipCsrf()
  @Get("google")
  @UseGuards(AuthGuard("google"))
  @ApiOperation({ summary: "Login with Google" })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async googleAuth(@Req() req: Request) {}

  @SkipCsrf()
  @Get("google/callback")
  @UseGuards(AuthGuard("google"))
  @ApiOperation({ summary: "Google auth callback" })
  async googleAuthRedirect(@Req() req: any, @Res() res: Response) {
    try {
      // Chỉ log email. Log nguyên req.user kéo theo google_id, ảnh, và mọi cột user vừa đọc từ DB
      // vào log gom trên Railway — không cần chỗ đó để lần ra sự cố đăng nhập.
      console.log("[GoogleCallback] Authenticated google user:", req.user?.email);

      const result = await this.authService.resolveGoogleLogin(req.user);

      if (result.session) {
        this.cookieAuthService.setAuthCookies(res, result.session);
      }

      res.redirect(result.redirectUrl);
    } catch (err: any) {
      // Stack chỉ để lại trong log server. Đây là đích của một redirect từ Google nên người dùng
      // cuối nhìn thẳng vào response — trả stack ra là phơi đường dẫn file và cấu trúc nội bộ cho
      // bất kỳ ai bấm được nút "Đăng nhập với Google".
      console.error("[GoogleCallback] CRITICAL ERROR:", err);
      res.redirect(this.authService.googleErrorRedirect());
    }
  }
}

