import { Body, Controller, Delete, ForbiddenException, Get, HttpException, HttpStatus, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { resolveShortLink } from '../../common/utils/resolve-short-link.util';
import { normalizeTargetCount } from '../../common/utils/target-count.util';
import { TiktokScraperService } from './tiktok-scraper.service';
import { TiktokScraperReadService } from './tiktok-scraper-read.service';

// "Kênh chú ý": chỉ LEADER/ADMIN được thêm kênh mới / search-and-scrape / bật
// is_tracked — MEMBER vẫn xem video/profile đã cào bình thường (không gate GET).
function assertCanManageChannels(req: any): void {
  const roles: string[] = req.user?.roles ?? [];
  if (!roles.includes(UserRole.ADMIN) && !roles.includes(UserRole.LEADER)) {
    throw new ForbiddenException('Chỉ leader/admin được quản lý kênh chú ý');
  }
}

// Thay thế tiktok_search / tiktok_profile_scrape / tiktok_profile_toggle bên AI
// (đã xóa) — route giữ nguyên path cũ để FE (scraperService.ts) không cần đổi gì.
// Trước đây AI tự check IsAuthenticated; giờ BE xử lý native nên phải tự guard.
// GET (tiktok_videos/tiktok_keyword_suggest/tiktok_profiles_list/tiktok_profile_detail/
// tiktok_profile_videos) cũng đã chuyển hẳn sang BE (TiktokScraperReadService) — AI
// giờ không còn đụng DB ở đâu nữa cho nền tảng này.
@UseGuards(JwtAuthGuard)
@Controller('scraper/tiktok')
export class TiktokScraperController {
  constructor(
    private readonly service: TiktokScraperService,
    private readonly readService: TiktokScraperReadService,
  ) {}

  @Get('videos')
  async videos(@Query() query: Record<string, string>) {
    return this.readService.listVideos(query);
  }

  @Get('keywords/suggest')
  async keywordSuggest(@Query('q') q?: string) {
    return this.readService.keywordSuggest((q || '').trim());
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

  @Get('profiles/:profileId/lookalikes')
  async lookalikes(@Param('profileId') profileId: string) {
    return this.readService.lookalikes(BigInt(profileId));
  }

  @Post('search')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async search(@Body() body: { keyword?: string; num_of_posts?: number; country?: string }) {
    const keyword = (body?.keyword || '').trim();
    if (!keyword) throw new HttpException({ error: 'keyword is required' }, HttpStatus.BAD_REQUEST);

    const count = Math.min(200, Math.max(1, Number(body?.num_of_posts) || 30));
    const region = body?.country || 'VN';
    const { created, updated, auto_discovered } = await this.service.searchKeyword(keyword, count, region);

    let message = `Đã tìm thấy ${created} video mới cho "${keyword}".`;
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

  @Post('profiles/scrape')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async profileScrape(@Body() body: { username?: string; url?: string; is_owned?: boolean; num_of_posts?: number }) {
    const input = (body?.username || body?.url || '').trim();
    if (!input) throw new HttpException({ error: 'username is required' }, HttpStatus.BAD_REQUEST);

    const targetCount = normalizeTargetCount(body?.num_of_posts);

    // Link rút gọn (vt/vm.tiktok.com) không chứa @username — resolve về URL thật trước.
    const raw = await resolveShortLink(input);

    const urlMatch = raw.match(/tiktok\.com\/@([A-Za-z0-9_.]+)/);
    const username = urlMatch ? urlMatch[1] : raw.replace(/^@/, '').trim();

    if (!username || !/^[A-Za-z0-9_.]+$/.test(username)) {
      throw new HttpException(
        {
          error:
            'Không lấy được username TikTok. Hãy dán link TRANG CÁ NHÂN (tiktok.com/@tenkenh) ' +
            'hoặc nhập thẳng username.',
        },
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
