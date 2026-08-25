import { Body, Controller, Delete, ForbiddenException, Get, HttpException, HttpStatus, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { resolveShortLink } from '../../common/utils/resolve-short-link.util';
import { normalizeTargetCount } from '../../common/utils/target-count.util';
import { DouyinScraperService } from './douyin-scraper.service';
import { DouyinScraperReadService } from './douyin-scraper-read.service';

function assertCanManageChannels(req: any): void {
  const roles: string[] = req.user?.roles ?? [];
  if (!roles.includes(UserRole.ADMIN) && !roles.includes(UserRole.LEADER)) {
    throw new ForbiddenException('Chỉ leader/admin được quản lý kênh chú ý');
  }
}

// Thay thế douyin_keyword_search / douyin_profile_scrape / douyin_profile_toggle bên AI
// (đã xóa) — route giữ nguyên path cũ để FE (scraperService.ts) không cần đổi gì.
// Trước đây AI tự check IsAuthenticated; giờ BE xử lý native nên phải tự guard.
// GET (douyin_videos_list/douyin_keyword_suggest/douyin_profiles_list/douyin_profile_detail/
// douyin_profile_videos) cũng đã chuyển hẳn sang BE (DouyinScraperReadService).
@UseGuards(JwtAuthGuard)
@Controller('scraper/douyin')
export class DouyinScraperController {
  constructor(
    private readonly service: DouyinScraperService,
    private readonly readService: DouyinScraperReadService,
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

  @Get('profiles/:pk')
  async profileDetail(@Param('pk') pk: string) {
    const result = await this.readService.profileDetail(BigInt(pk));
    if (!result) throw new HttpException({ error: 'Not found' }, HttpStatus.NOT_FOUND);
    return result;
  }

  @Get('profiles/:pk/videos')
  async profileVideos(@Param('pk') pk: string, @Query() query: Record<string, string>) {
    const result = await this.readService.profileVideos(BigInt(pk), query);
    if (!result) throw new HttpException({ error: 'Not found' }, HttpStatus.NOT_FOUND);
    return result;
  }

  @Get('profiles/:pk/lookalikes')
  async lookalikes(@Param('pk') pk: string) {
    return this.readService.lookalikes(BigInt(pk));
  }

  @Post('search')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async search(@Body() body: { keyword?: string; num_of_posts?: number; display_keyword?: string }) {
    const keyword = (body?.keyword || '').trim();
    if (!keyword) throw new HttpException({ error: 'keyword is required' }, HttpStatus.BAD_REQUEST);

    // display_keyword = tiếng Việt user gõ (FE đã dịch sang tiếng Trung ở `keyword`).
    // Lưu bản tiếng Việt để bộ lọc/gợi ý dễ đọc; query vẫn dùng tiếng Trung.
    const displayKeyword = (body?.display_keyword || '').trim() || undefined;
    const count = Math.min(200, Math.max(1, Number(body?.num_of_posts) || 30));
    const { created, updated } = await this.service.searchKeyword(keyword, count, displayKeyword);

    // Tới dòng này là việc đã XONG (đã await ở trên) — câu báo phải nói kết quả, không nói là
    // đang chạy. FE chỉ `toast.success(message)` một lần rồi thôi, không poll gì thêm, nên câu
    // "Đang tìm kiếm..." khiến người dùng tưởng còn phải chờ và không biết cào được bao nhiêu.
    // Cùng lối diễn đạt với TikTok/Kuaishou/Bilibili/Xiaohongshu.
    return {
      status: 'ok',
      message: `Đã tìm thấy ${created} video mới cho "${displayKeyword || keyword}".`,
      created,
      updated,
    };
  }

  @Post('profile/scrape')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async profileScrape(@Body() body: { sec_user_id?: string; is_owned?: boolean; num_of_posts?: number }) {
    const input = (body?.sec_user_id || '').trim();
    if (!input) throw new HttpException({ error: 'sec_user_id is required' }, HttpStatus.BAD_REQUEST);

    const targetCount = normalizeTargetCount(body?.num_of_posts);

    // Link rút gọn (v.douyin.com) không chứa sec_user_id — resolve về URL thật trước.
    const raw = await resolveShortLink(input);

    // Cho phép nhập nguyên URL profile (douyin.com/user/<sec_user_id>) hoặc sec_user_id trần.
    // sec_user_id chính là path segment sau /user/ trên URL thật (FE cũng dựng link
    // "xem trên Douyin" y hệt kiểu này) — không cần resolve gì thêm.
    const urlMatch = raw.match(/douyin\.com\/user\/([\w-]+)/i);
    const secUserId = urlMatch ? urlMatch[1] : raw;

    // num_of_posts được kẹp trong [1, 1000] ở normalizeTargetCount — không tin thẳng client.
    return this.service.scrapeProfile(secUserId, body?.is_owned, targetCount);
  }

  @Post('profiles/:pk/toggle')
  async toggle(
    @Param('pk') pk: string,
    @Body() body: { field?: 'is_bookmarked' | 'is_tracked' },
    @Request() req: any,
  ) {
    const field = body?.field;
    if (field !== 'is_bookmarked' && field !== 'is_tracked') {
      throw new HttpException({ error: 'field must be is_bookmarked or is_tracked' }, HttpStatus.BAD_REQUEST);
    }
    if (field === 'is_tracked') assertCanManageChannels(req);
    const newValue = await this.service.toggleProfile(BigInt(pk), field);
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

}
