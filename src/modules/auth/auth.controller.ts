import {
  Controller,
  Post,
  Body,
  Get,
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
import { CurrentUser } from "../../common/decorators/current-user.decorator";

@ApiTags("auth")
@Controller("auth")
@SkipThrottle({ long: true, short: true })
@UseInterceptors(ClassSerializerInterceptor)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  @ApiOperation({ summary: "Login user" })
  @ApiResponse({
    status: 200,
    description: "Login successful",
    type: TokenResponseDto,
  })
  @ApiResponse({ status: 401, description: "Invalid credentials" })
  login(@Body() loginDto: LoginDto): Promise<TokenResponseDto> {
    return this.authService.login(loginDto);
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

      const tokenResponse = await this.authService.generateToken(req.user);
      res.redirect(
        `${frontendUrl}/auth/google/callback?token=${tokenResponse.access_token}`,
      );
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
