import { Controller, Get, Query, Res, Logger } from '@nestjs/common';
import { Response } from 'express';
import { OAuthService } from './oauth.service';
import { ConfigService } from '@nestjs/config';

@Controller('oauth')
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);

  constructor(
    private readonly oauthService: OAuthService,
    private readonly config: ConfigService,
  ) {}

  // ────────────────────────────────────────────────
  // META / FACEBOOK
  // ────────────────────────────────────────────────

  /** Redirect người dùng sang trang đăng nhập Facebook */
  @Get('facebook')
  redirectToFacebook(@Res() res: Response) {
    const url = this.oauthService.getFacebookAuthUrl();
    this.logger.log(`🔗 Redirecting to Facebook OAuth: ${url}`);
    return res.redirect(url);
  }

  /** Nhận code callback từ Facebook, xử lý và lưu DB */
  @Get('facebook/callback')
  async facebookCallback(@Query('code') code: string, @Res() res: Response) {
    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3001');
    try {
      const result = await this.oauthService.handleFacebookCallback(code);
      this.logger.log(`✅ Facebook callback OK: ${result.count} channels`);
      return res.redirect(`${frontendUrl}/dashboard/ai/settings?oauth=success&platform=facebook&count=${result.count}`);
    } catch (error) {
      this.logger.error(`❌ Facebook callback error: ${error.message}`);
      return res.redirect(`${frontendUrl}/dashboard/ai/settings?oauth=error&platform=facebook&message=${encodeURIComponent(error.message)}`);
    }
  }

  // ────────────────────────────────────────────────
  // TIKTOK
  // ────────────────────────────────────────────────

  /** Redirect người dùng sang trang đăng nhập TikTok */
  @Get('tiktok')
  redirectToTikTok(@Res() res: Response) {
    const url = this.oauthService.getTikTokAuthUrl();
    this.logger.log(`🔗 Redirecting to TikTok OAuth: ${url}`);
    return res.redirect(url);
  }

  /** Nhận code callback từ TikTok, xử lý và lưu DB */
  @Get('tiktok/callback')
  async tikTokCallback(@Query('code') code: string, @Res() res: Response) {
    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3001');
    try {
      const result = await this.oauthService.handleTikTokCallback(code);
      this.logger.log(`✅ TikTok callback OK: ${result.count} channel`);
      return res.redirect(`${frontendUrl}/dashboard/ai/settings?oauth=success&platform=tiktok&count=${result.count}`);
    } catch (error) {
      this.logger.error(`❌ TikTok callback error: ${error.message}`);
      return res.redirect(`${frontendUrl}/dashboard/ai/settings?oauth=error&platform=tiktok&message=${encodeURIComponent(error.message)}`);
    }
  }
}
