import { Body, Controller, ForbiddenException, Get, HttpException, HttpStatus, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { resolveShortLink } from '../../common/utils/resolve-short-link.util';
import { normalizeTargetCount } from '../../common/utils/target-count.util';
import { YoutubeScraperService } from './youtube-scraper.service';
import { YoutubeScraperReadService } from './youtube-scraper-read.service';

function assertCanManageChannels(req: any): void {
  const roles: string[] = req.user?.roles ?? [];
  if (!roles.includes(UserRole.ADMIN) && !roles.includes(UserRole.LEADER)) {
    throw new ForbiddenException('Chỉ leader/admin được quản lý kênh chú ý');
  }
}

// Nền tảng mới — toàn bộ route (đọc lẫn ghi) đều native ở BE ngay từ đầu, không có
// gì cần "migrate" từ AI. AI chỉ còn endpoint fetch-only (youtube_fetch_views.py).
@UseGuards(JwtAuthGuard)
@Controller('scraper/youtube')
export class YoutubeScraperController {
  constructor(
    private readonly service: YoutubeScraperService,
    private readonly readService: YoutubeScraperReadService,
  ) {}

  @Get('profiles')
  async profilesList(@Query() query: Record<string, string>) {
    return this.readService.listProfiles(query);
  }

  @Get('shorts')
  async shortsList(@Query() query: Record<string, string>) {
    return this.readService.listShorts(query);
  }

  @Get('profiles/:profileId')
  async profileDetail(@Param('profileId') profileId: string) {
    const result = await this.readService.profileDetail(BigInt(profileId));
    if (!result) throw new HttpException({ error: 'Profile not found' }, HttpStatus.NOT_FOUND);
    return result;
  }

  @Get('profiles/:profileId/shorts')
  async profileShorts(@Param('profileId') profileId: string, @Query() query: Record<string, string>) {
    const result = await this.readService.profileShorts(BigInt(profileId), query);
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
  async profileScrape(@Body() body: { channel_id?: string; is_owned?: boolean; num_of_posts?: number }) {
    const input = (body?.channel_id || '').trim();
    if (!input) throw new HttpException({ error: 'channel_id is required' }, HttpStatus.BAD_REQUEST);

    const targetCount = normalizeTargetCount(body?.num_of_posts);

    // Link rút gọn (youtu.be) trỏ tới VIDEO chứ không phải kênh — resolve về URL
    // watch?v=... đầy đủ, service sẽ đọc HTML trang đó để lấy channelId của chủ video.
    const raw = await resolveShortLink(input);

    // Các dạng nhập được chấp nhận — chỉ /channel/UC... là id chuẩn dùng thẳng được;
    // handle/username/URL video KHÔNG dùng thẳng cho TikHub get_channel_shorts (API đó
    // bắt buộc UC... thật) — service sẽ tự resolve ra UC... thật trước khi cào.
    const channelUrlMatch = raw.match(/youtube\.com\/channel\/(UC[\w-]+)/i);
    const handleUrlMatch = raw.match(/youtube\.com\/@([\w.-]+)/i);
    const legacyUrlMatch = raw.match(/youtube\.com\/(?:c|user)\/([\w.-]+)/i);
    const bareHandleMatch = raw.match(/^@([\w.-]+)$/);

    let candidate: string;
    if (channelUrlMatch) {
      candidate = channelUrlMatch[1];
    } else if (handleUrlMatch || bareHandleMatch) {
      candidate = (handleUrlMatch || bareHandleMatch)![1];
    } else if (legacyUrlMatch) {
      candidate = legacyUrlMatch[1];
    } else {
      // Bare UC.../username trần, hoặc URL video (watch?v=) — service tự resolve.
      candidate = raw;
    }

    return this.service.scrapeChannel(candidate, body?.is_owned, targetCount);
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
