import { Body, Controller, Delete, ForbiddenException, Get, HttpException, HttpStatus, Logger, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
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
  private readonly logger = new Logger(YoutubeScraperController.name);

  constructor(
    private readonly service: YoutubeScraperService,
    private readonly readService: YoutubeScraperReadService,
  ) {}

  @Post(['profiles/sync-all', 'periodic-refresh'])
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async syncAll(
    @Body()
    body?: {
      scope?: 'tracked' | 'bookmarked' | 'all';
      mode?: 'count' | 'days';
      count?: number;
      days?: number;
    },
  ) {
    this.service.periodicRefresh(body).catch((err: any) => {
      this.logger.error(`[YT-SYNC-ALL] Lỗi đồng bộ: ${err.message}`);
    });
    const scopeLabel = body?.scope === 'bookmarked' ? 'kênh đã lưu' : body?.scope === 'all' ? 'tất cả kênh' : 'kênh chú ý';
    const detailLabel = body?.mode === 'days' ? `${body.days || 7} ngày gần nhất` : `${body?.count || 20} video mới nhất`;
    return {
      status: 'ok',
      message: `Đã bắt đầu cào video YouTube (${scopeLabel}, ${detailLabel}) trong nền!`,
    };
  }

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
    const newValue = await this.service.toggleProfile(BigInt(profileId), field, req.user);
    return { status: 'ok', [field]: newValue };
  }

  // Xoá cứng kênh: bản ghi kênh + toàn bộ video/lịch sử của nó biến mất vĩnh viễn.
  // Chỉ ADMIN/LEADER, khớp phân quyền của mọi thao tác quản lý kênh khác.
  @Delete('profiles/:profileId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async remove(@Param('profileId') profileId: string) {
    return this.service.deleteProfile(BigInt(profileId));
  }

  @Patch('profiles/:profileId/classification')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async updateClassification(
    @Param('profileId') profileId: string,
    @Body() body: { channel_type?: string; product_lines?: string[] },
  ) {
    const channel_type = body.channel_type === 'content' ? 'content' : 'product';
    const product_lines = Array.isArray(body.product_lines) ? body.product_lines : [];
    return this.service.updateClassification(BigInt(profileId), channel_type, product_lines);
  }
}
