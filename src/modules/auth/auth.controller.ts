import {
  Controller,
  Post,
  Body,
  Get,
  HttpCode,
  NotFoundException,
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
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { CsrfGuard } from "./guards/csrf.guard";
import { CurrentUser } from "./decorators/current-user.decorator";
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

      // findOne NÉM NotFoundException chứ không trả null khi user đã bị xoá. Không nuốt ở đây thì
      // refresh trả 404 — FE bắt 401 để về trang đăng nhập sẽ trượt qua và treo ở màn hình trắng.
      //
      // Nuốt ĐÚNG NotFoundException, không phải mọi lỗi: bắt hết thì một cú rớt kết nối DB cũng
      // hoá thành "user không tồn tại" → 401 → xoá cookie, tức là sự cố hạ tầng thoáng qua lại
      // đăng xuất người dùng. Lỗi hạ tầng phải nổi lên thành 500 để cookie được giữ nguyên.
      const user = await this.usersService
        .findOne(rotated.userId)
        .catch((e) => {
          if (e instanceof NotFoundException) return null;
          throw e;
        });
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
      // CHỈ dọn cookie khi phiên thật sự chết. Để lại cookie chết thì FE lặp vô hạn 401 → refresh
      // → 401; nhưng xoá cookie khi DB chớp lỗi một nhịp thì một sự cố hạ tầng thoáng qua đủ đá
      // văng mọi người đang làm việc — mà phiên của họ vẫn còn hiệu lực hoàn toàn.
      if (err instanceof UnauthorizedException) {
        this.cookieAuthService.clearAuthCookies(res);
      }
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
      // Chỉ log email. Log nguyên req.user kéo theo google_id, ảnh, và mọi cột user vừa đọc từ DB
      // vào log gom trên Railway — không cần chỗ đó để lần ra sự cố đăng nhập.
      console.log("[GoogleCallback] Authenticated google user:", req.user?.email);

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

      // ?token= TẠM THỜI GIỮ LẠI — GỠ Ở BƯỚC DEPLOY 3, cùng lúc với extractor ?access_token=
      // trong jwt.strategy.ts (xem docs/plans/2026-08-08-auth-cookie-httponly.md).
      //
      // Cookie đặt ở trên mới là đường chính và FE mới sẽ chỉ dùng nó. Nhưng FE ĐANG CHẠY bắt
      // buộc phải có ?token= mới cho vào: auth/google/callback/page.tsx đọc searchParams("token"),
      // thiếu là đá thẳng về /login?error=Google login failed. Bỏ ngay ở giai đoạn BE này thì
      // đăng nhập Google chết hẳn trong suốt khoảng giữa hai lần deploy — mà cookie vẫn được đặt
      // đúng, nên nhìn log BE thấy 200 sạch sẽ và không ai hiểu vì sao người dùng không vào được.
      res.redirect(
        `${frontendUrl}/auth/google/callback?token=${encodeURIComponent(tokenResponse.access_token)}`,
      );
    } catch (err: any) {
      // Stack chỉ để lại trong log server. Đây là đích của một redirect từ Google nên người dùng
      // cuối nhìn thẳng vào response — trả stack ra là phơi đường dẫn file và cấu trúc nội bộ cho
      // bất kỳ ai bấm được nút "Đăng nhập với Google".
      console.error("[GoogleCallback] CRITICAL ERROR:", err);
      res.redirect(
        `${frontendUrl}/login?error=${encodeURIComponent(
          "Đăng nhập Google thất bại. Vui lòng thử lại hoặc liên hệ Admin.",
        )}`,
      );
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
