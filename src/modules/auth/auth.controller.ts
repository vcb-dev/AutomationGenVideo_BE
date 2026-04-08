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
  UnauthorizedException,
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
import { RegisterDto } from "./dto/register.dto";
import { TokenResponseDto } from "./dto/token-response.dto";
import { UserResponseDto } from "../users/dto/user-response.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";

@ApiTags("auth")
@Controller("auth")
@SkipThrottle()
@UseInterceptors(ClassSerializerInterceptor)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  @ApiOperation({ summary: "Register a new user" })
  @ApiResponse({
    status: 201,
    description: "User registered successfully",
    type: TokenResponseDto,
  })
  @ApiResponse({ status: 409, description: "Email already exists" })
  register(@Body() registerDto: RegisterDto): Promise<TokenResponseDto> {
    return this.authService.register(registerDto);
  }

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

    // Check if this is a new user or existing user
    if (req.user.isNewUser) {
      // New user - create a temporary token with Google profile data
      const tempToken = this.authService.createTempToken(req.user);

      // Redirect to role selection page
      res.redirect(
        `${frontendUrl}/auth/google/role-selection?tempToken=${tempToken}`,
      );
    } else {
      // Existing user - generate regular token and redirect to dashboard
      const tokenResponse = await this.authService.generateToken(req.user);
      res.redirect(
        `${frontendUrl}/auth/google/callback?token=${tokenResponse.access_token}`,
      );
    }
  }

  @Post("google/complete")
  @ApiOperation({ summary: "Complete Google registration with role selection" })
  @ApiResponse({
    status: 201,
    description: "Registration completed successfully",
    type: TokenResponseDto,
  })
  @ApiResponse({ status: 400, description: "Invalid request" })
  async completeGoogleRegistration(
    @Body() body: { tempToken: string; role: string },
  ): Promise<TokenResponseDto> {
    try {
      // Verify and decode temporary token
      const decoded = this.authService.verifyTempToken(body.tempToken);

      if (!decoded.isTemp || !decoded.googleUser) {
        throw new UnauthorizedException("Invalid temporary token");
      }

      // Complete registration with selected role
      const user = await this.authService.completeGoogleRegistration(
        decoded.googleUser,
        body.role,
      );

      // Generate regular access token
      return this.authService.generateToken(user);
    } catch (error) {
      throw new UnauthorizedException("Failed to complete registration");
    }
  }
}
