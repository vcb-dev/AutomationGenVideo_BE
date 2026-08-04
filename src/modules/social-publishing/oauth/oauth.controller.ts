import { Controller, Get, Query, Param, Res, UseGuards, Request, Logger } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { OAuthService } from './oauth.service';

@ApiTags('Social OAuth')
@Controller('social/oauth')
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);

  constructor(private readonly oauthService: OAuthService) {}

  /** Trả về URL đăng nhập OAuth cho một platform */
  @Get(':platform/url')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Lấy OAuth login URL (mở popup). Với Instagram, truyền ?igMode=direct để dùng Instagram Login trực tiếp (không cần FB Page).' })
  getAuthUrl(
    @Param('platform') platform: string,
    @Query('igMode') igMode: string | undefined,
    @Request() req,
  ) {
    return this.oauthService.getAuthUrl(platform.toUpperCase(), req.user.id, { igMode });
  }

  /** Callback từ Facebook */
  @Get('facebook/callback')
  @ApiOperation({ summary: 'Facebook OAuth callback' })
  async facebookCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    return this.handleCallback('FACEBOOK', code, state, null, res);
  }

  /** Callback từ Instagram */
  @Get('instagram/callback')
  @ApiOperation({ summary: 'Instagram OAuth callback' })
  async instagramCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    return this.handleCallback('INSTAGRAM', code, state, null, res);
  }

  /** Callback từ Threads */
  @Get('threads/callback')
  @ApiOperation({ summary: 'Threads OAuth callback' })
  async threadsCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    return this.handleCallback('THREADS', code, state, null, res);
  }

  /** Callback từ YouTube */
  @Get('youtube/callback')
  @ApiOperation({ summary: 'YouTube OAuth callback' })
  async youtubeCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    return this.handleCallback('YOUTUBE', code, state, null, res);
  }

  private async handleCallback(platform: string, code: string, state: string, extra: any, res: Response) {
    const feUrl = process.env.FE_URL || process.env.FE_REDIRECT_URL || 'http://localhost:3001';
    try {
      await this.oauthService.handleCallback(platform, code, state, extra);
      const params = new URLSearchParams({ type: `${platform.toLowerCase()}-oauth-success`, platform: platform.toLowerCase() });
      res.redirect(`${feUrl}/auth/oauth-close?${params}`);
    } catch (err: any) {
      // Log chi tiết server-side, KHÔNG nhúng err.message vào URL (tránh lộ thông tin nhạy cảm)
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      this.logger.error(`OAuth callback error [${platform}]: ${detail}`);
      const params = new URLSearchParams({
        type: `${platform.toLowerCase()}-oauth-error`,
        platform: platform.toLowerCase(),
        error: 'oauth_failed',
      });
      res.redirect(`${feUrl}/auth/oauth-close?${params}`);
    }
  }
}
