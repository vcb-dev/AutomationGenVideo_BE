import {
  Controller,
  Post,
  Body,
  Get,
  HttpCode,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
  ClassSerializerInterceptor,
  Req,
  Res,
} from "@nestjs/common";
import { Request, Response } from "express";
import { AuthGuard } from "@nestjs/passport";
import { SkipThrottle } from "@nestjs/throttler";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { TokenResponseDto } from "./dto/token-response.dto";
import { UserResponseDto } from "../users/dto/user-response.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CsrfGuard } from "../../common/guards/csrf.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CookieAuthService } from "./cookie-auth.service";
import { RefreshTokenService, SessionContext } from "./refresh-token.service";
import { COOKIE_REFRESH } from "./cookie.constants";
import { UsersService } from "../users/users.service";

@ApiTags("auth")
@Controller("auth")
@SkipThrottle({ long: true, short: true })
@UseInterceptors(ClassSerializerInterceptor)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cookieAuthService: CookieAuthService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly usersService: UsersService,
  ) {}

  @Post("login")
  @ApiOperation({ summary: "Login user" })
  @ApiResponse({
    status: 200,
    description: "Login successful",
    type: TokenResponseDto,
  })
  @ApiResponse({ status: 401, description: "Invalid credentials" })
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    // passthrough: true — không có nó thì Nest ngừng tự serialize giá trị trả về và request treo
    // cho tới khi timeout.
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponseDto> {
    const user = await this.authService.validateLoginOrThrow(loginDto);
    const { tokenResponse, refreshToken } = await this.authService.issueSession(
      user,
      sessionContext(req),
    );

    this.cookieAuthService.setAuthCookies(res, {
      accessToken: tokenResponse.access_token,
      refreshToken,
    });

    // access_token VẪN nằm trong body cho Swagger / curl / script nội bộ — FE mới không đọc nó.
    // refreshToken thì TUYỆT ĐỐI không: nó chỉ được phép tồn tại trong cookie HttpOnly.
    return tokenResponse;
  }

  @Post("refresh")
  @HttpCode(200)
  @UseGuards(CsrfGuard)
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

    if (!rawToken) {
      throw new UnauthorizedException("Thiếu refresh token");
    }

    try {
      const rotated = await this.refreshTokenService.rotate(
        rawToken,
        this.cookieAuthService.refreshMaxAge(),
        sessionContext(req),
      );

      const user = await this.usersService.findOne(rotated.userId);
      if (!user || !user.is_active) {
        throw new UnauthorizedException("Tài khoản không còn hoạt động");
      }

      const tokenResponse = await this.authService.generateToken(user);
      this.cookieAuthService.setAuthCookies(res, {
        accessToken: tokenResponse.access_token,
        refreshToken: rotated.rawToken,
      });

      return tokenResponse;
    } catch (err) {
      // Refresh hỏng vì bất kỳ lý do gì thì dọn sạch cookie: để lại cookie chết khiến FE lặp vô
      // hạn vòng 401 → refresh → 401.
      this.cookieAuthService.clearAuthCookies(res);
      throw err;
    }
  }

  @Post("logout")
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: "Đăng xuất, thu hồi cả chuỗi phiên" })
  @ApiResponse({ status: 200, description: "Đã đăng xuất" })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: boolean }> {
    const rawToken = (req as Request & { cookies?: Record<string, string> }).cookies?.[
      COOKIE_REFRESH
    ];

    if (rawToken) {
      await this.refreshTokenService.revokeByRawToken(rawToken);
    }

    // Xoá cookie kể cả khi không có token: người dùng bấm đăng xuất thì phải được đăng xuất.
    this.cookieAuthService.clearAuthCookies(res);
    return { success: true };
  }

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

  @Get("google")
  @UseGuards(AuthGuard("google"))
  @ApiOperation({ summary: "Login with Google" })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async googleAuth(@Req() req: Request) {}

  @Get("google/callback")
  @UseGuards(AuthGuard("google"))
  @ApiOperation({ summary: "Google auth callback" })
  async googleAuthRedirect(@Req() req: any, @Res() res: Response) {
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3001";

    try {
      console.log("[GoogleCallback] Authenticated google user:", req.user);

      // Tài khoản bị vô hiệu hóa — về login kèm thông báo
      if (req.user.isInactiveUser) {
        res.redirect(
          `${frontendUrl}/login?error=${encodeURIComponent(
            "Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ Admin để được kích hoạt lại.",
          )}`,
        );
        return;
      }

      // Không còn tự tạo tài khoản qua Google
      if (req.user.isNewUser) {
        res.redirect(
          `${frontendUrl}/login?error=${encodeURIComponent(
            "Tài khoản chưa được tạo. Vui lòng liên hệ Leader/Admin để được cấp quyền truy cập.",
          )}`,
        );
        return;
      }

      const { tokenResponse, refreshToken } = await this.authService.issueSession(
        req.user,
        sessionContext(req),
      );

      this.cookieAuthService.setAuthCookies(res, {
        accessToken: tokenResponse.access_token,
        refreshToken,
      });

      // Không còn ?token= trong URL: token từng lọt vào browser history, header Referer của mọi
      // request kế tiếp, và log truy cập của Nginx. Cookie đã đặt ở trên, trang FE chỉ cần gọi
      // /auth/profile là biết mình là ai.
      res.redirect(`${frontendUrl}/auth/google/callback`);
    } catch (err: any) {
      console.error("[GoogleCallback] CRITICAL ERROR:", err);
      res.status(500).json({
        statusCode: 500,
        message: err?.message || "Internal server error",
        error: err?.name || "Error",
        stack: err?.stack?.split("\n")
      });
    }
  }
}

/** Ghi lại thiết bị và IP để sau này lần ra được token bị trộm từ đâu. */
function sessionContext(req: Request): SessionContext {
  return {
    userAgent: req.headers["user-agent"],
    ipAddress: req.ip,
  };
}
