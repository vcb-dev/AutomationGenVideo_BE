import { Body, Controller, ForbiddenException, Get, HttpException, HttpStatus, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { normalizeTargetCount } from '../../common/utils/target-count.util';
import { InstagramScraperService } from './instagram-scraper.service';
import { InstagramScraperReadService } from './instagram-scraper-read.service';

function assertCanManageChannels(req: any): void {
  const roles: string[] = req.user?.roles ?? [];
  if (!roles.includes(UserRole.ADMIN) && !roles.includes(UserRole.LEADER)) {
    throw new ForbiddenException('Chỉ leader/admin được quản lý kênh chú ý');
  }
}

// Thay thế instagram_profile_scrape / instagram_profile_toggle bên AI (đã xóa) —
// route giữ nguyên path cũ để FE (scraperService.ts) không cần đổi gì.
// Trước đây AI tự check IsAuthenticated; giờ BE xử lý native nên phải tự guard.
// GET (instagram_profiles_list/instagram_profile_detail/instagram_profile_reels) cũng
// đã chuyển hẳn sang BE (InstagramScraperReadService).
@UseGuards(JwtAuthGuard)
@Controller('scraper/instagram')
export class InstagramScraperController {
  constructor(
    private readonly service: InstagramScraperService,
    private readonly readService: InstagramScraperReadService,
  ) {}

  @Get('profiles')
  async profilesList(@Query() query: Record<string, string>) {
    return this.readService.listProfiles(query);
  }

  @Get('reels')
  async reelsList(@Query() query: Record<string, string>) {
    return this.readService.listReels(query);
  }

  @Get('profiles/:profileId')
  async profileDetail(@Param('profileId') profileId: string) {
    const result = await this.readService.profileDetail(BigInt(profileId));
    if (!result) throw new HttpException({ error: 'Profile not found' }, HttpStatus.NOT_FOUND);
    return result;
  }

  @Get('profiles/:profileId/reels')
  async profileReels(@Param('profileId') profileId: string, @Query() query: Record<string, string>) {
    const result = await this.readService.profileReels(BigInt(profileId), query);
    if (!result) throw new HttpException({ error: 'Profile not found' }, HttpStatus.NOT_FOUND);
    return result;
  }

  @Get('profiles/:profileId/lookalikes')
  async lookalikes(@Param('profileId') profileId: string) {
    return this.readService.lookalikes(BigInt(profileId));
  }

  @Post('profiles/scrape')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async profileScrape(@Body() body: { username?: string; is_owned?: boolean; num_of_posts?: number }) {
    const raw = (body?.username || '').trim();
    if (!raw) throw new HttpException({ error: 'username is required' }, HttpStatus.BAD_REQUEST);

    const targetCount = normalizeTargetCount(body?.num_of_posts);

    // Cho phép nhập nguyên URL profile (instagram.com/username) hoặc username trần.
    // Loại các path không phải profile (p/reel/tv/stories/explore/accounts/direct).
    const reservedPaths = ['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct'];
    const urlMatch = raw.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
    let username = raw;
    if (urlMatch) username = reservedPaths.includes(urlMatch[1].toLowerCase()) ? '' : urlMatch[1];
    username = username.replace(/^@/, '');

    if (!/^[A-Za-z0-9_.]{1,30}$/.test(username)) {
      throw new HttpException(
        { error: 'Username không hợp lệ (chỉ chứa chữ, số, dấu _ và .)' },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.service.scrapeProfile(username, body?.is_owned, targetCount);
  }

  @Post('profiles/:profileId/toggle')
  async toggle(
    @Param('profileId') profileId: string,
    @Body() body: { field?: 'is_bookmarked' | 'is_tracked' },
    @Request() req: any,
  ) {
    const field = body?.field;
    if (field !== 'is_bookmarked' && field !== 'is_tracked') {
      throw new HttpException({ error: 'field must be is_bookmarked or is_tracked' }, HttpStatus.BAD_REQUEST);
    }
    if (field === 'is_tracked') assertCanManageChannels(req);
    const newValue = await this.service.toggleProfile(BigInt(profileId), field);
    return { status: 'ok', [field]: newValue };
  }
}
