import { Body, Controller, Delete, ForbiddenException, Get, HttpException, HttpStatus, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { resolveShortLink } from '../../common/utils/resolve-short-link.util';
import { normalizeTargetCount } from '../../common/utils/target-count.util';
import { BilibiliScraperService } from './bilibili-scraper.service';
import { BilibiliScraperReadService } from './bilibili-scraper-read.service';

function assertCanManageChannels(req: any): void {
  const roles: string[] = req.user?.roles ?? [];
  if (!roles.includes(UserRole.ADMIN) && !roles.includes(UserRole.LEADER)) {
    throw new ForbiddenException('Chỉ leader/admin được quản lý kênh chú ý');
  }
}

// Nền tảng mới — chỉ có kênh ngoài (external), không có is_owned/internal. Toàn
// bộ route (đọc lẫn ghi) đều native ở BE ngay từ đầu. AI chỉ còn endpoint
// fetch-only (bilibili_fetch_views.py).
@UseGuards(JwtAuthGuard)
@Controller('scraper/bilibili')
export class BilibiliScraperController {
  constructor(
    private readonly service: BilibiliScraperService,
    private readonly readService: BilibiliScraperReadService,
  ) {}

  @Get('videos')
  async videos(@Query() query: Record<string, string>) {
    return this.readService.listVideos(query);
  }

  @Get('keywords/suggest')
  async keywordSuggest(@Query('q') q?: string) {
    return this.readService.keywordSuggest((q || '').trim());
  }

  @Post('search')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async search(@Body() body: { keyword?: string; num_of_posts?: number; display_keyword?: string }) {
    const keyword = (body?.keyword || '').trim();
    if (!keyword) throw new HttpException({ error: 'keyword is required' }, HttpStatus.BAD_REQUEST);

    // display_keyword = tiếng Việt user gõ (FE đã dịch sang tiếng Trung ở `keyword`).
    const displayKeyword = (body?.display_keyword || '').trim() || undefined;
    const count = Math.min(200, Math.max(1, Number(body?.num_of_posts) || 30));
    const { created, updated, auto_discovered } = await this.service.searchKeyword(keyword, count, displayKeyword);

    let message = `Đã tìm thấy ${created} video mới cho "${displayKeyword || keyword}".`;
    if (auto_discovered.length > 0) {
      message += ` Đang tự động khám phá ${auto_discovered.length} kênh mới: ${auto_discovered.join(', ')}.`;
    }

    return {
      status: 'ok',
      message,
      created,
      updated,
      auto_discovered,
      auto_discovered_count: auto_discovered.length,
    };
  }

  @Get('profiles')
  async profilesList(@Query() query: Record<string, string>) {
    return this.readService.listProfiles(query);
  }

  @Get('profiles/:profileId')
  async profileDetail(@Param('profileId') profileId: string) {
    const result = await this.readService.profileDetail(BigInt(profileId));
    if (!result) throw new HttpException({ error: 'Profile not found' }, HttpStatus.NOT_FOUND);
    return result;
  }

  @Get('profiles/:profileId/videos')
  async profileVideos(@Param('profileId') profileId: string, @Query() query: Record<string, string>) {
    const result = await this.readService.profileVideos(BigInt(profileId), query);
    if (!result) throw new HttpException({ error: 'Profile not found' }, HttpStatus.NOT_FOUND);
    return result;
  }

  @Post('profiles/scrape')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async profileScrape(@Body() body: { mid?: string; num_of_posts?: number }) {
    const input = (body?.mid || '').trim();
    if (!input) throw new HttpException({ error: 'mid is required' }, HttpStatus.BAD_REQUEST);

    const targetCount = normalizeTargetCount(body?.num_of_posts);

    // Link rút gọn (b23.tv) không chứa mid — resolve về URL thật trước.
    const raw = await resolveShortLink(input);

    // Cho phép nhập nguyên URL profile (space.bilibili.com/xxxx) hoặc mid trần.
    const urlMatch = raw.match(/space\.bilibili\.com\/(\d+)/i);
    const mid = urlMatch ? urlMatch[1] : raw;

    if (!/^\d+$/.test(mid)) {
      throw new HttpException(
        {
          error:
            'Không lấy được ID kênh Bilibili. Hãy dán link TRANG CÁ NHÂN (space.bilibili.com/...), ' +
            'không phải link video.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.service.scrapeProfile(mid, targetCount);
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

  // Xoá cứng kênh: bản ghi kênh + toàn bộ video/lịch sử của nó biến mất vĩnh viễn.
  // Chỉ ADMIN/LEADER, khớp phân quyền của mọi thao tác quản lý kênh khác.
  @Delete('profiles/:profileId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async remove(@Param('profileId') profileId: string) {
    return this.service.deleteProfile(BigInt(profileId));
  }


  /**
   * Đồng bộ tất cả kênh của nền tảng này.
   *
   * Chạy nền và trả ngay: cào hàng chục kênh, mỗi kênh nghỉ 5 giây giữa các lượt, nên chờ
   * đồng bộ chắc chắn vượt timeout HTTP. Kết quả theo dõi qua scraping_status của từng kênh.
   */
  @Post('profiles/sync-all')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async syncAll() {
    if (this.service.isSyncAllRunning()) {
      return { status: 'ok', already_running: true, message: 'Đang có một lượt đồng bộ chạy dở, chờ nó xong đã.' };
    }
    // KHÔNG await: cào hàng chục kênh, mỗi kênh nghỉ 5 giây, chắc chắn vượt timeout HTTP.
    // Service tự ghi log kết quả; UI theo dõi qua scraping_status của từng kênh.
    void this.service.syncAllProfiles().catch(() => undefined);
    return { status: 'ok', message: 'Đã bắt đầu đồng bộ tất cả kênh. Theo dõi trạng thái trên từng thẻ.' };
  }

}
