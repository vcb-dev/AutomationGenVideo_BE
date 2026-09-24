import { Body, Controller, Delete, ForbiddenException, Get, HttpException, HttpStatus, Logger, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { resolveShortLink } from '../../common/utils/resolve-short-link.util';
import { normalizeTargetCount } from '../../common/utils/target-count.util';
import { DouyinScraperService } from './douyin-scraper.service';
import { DouyinScraperReadService } from './douyin-scraper-read.service';
import { DouyinAiClientService } from './douyin-ai-client.service';

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
  private readonly logger = new Logger(DouyinScraperController.name);

  constructor(
    private readonly service: DouyinScraperService,
    private readonly readService: DouyinScraperReadService,
    private readonly aiClient: DouyinAiClientService,
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
      this.logger.error(`[DOUYIN-SYNC-ALL] Lỗi đồng bộ: ${err.message}`);
    });
    const scopeLabel = body?.scope === 'bookmarked' ? 'kênh đã lưu' : body?.scope === 'all' ? 'tất cả kênh' : 'kênh chú ý';
    const detailLabel = body?.mode === 'days' ? `${body.days || 7} ngày gần nhất` : `${body?.count || 20} video mới nhất`;
    return {
      status: 'ok',
      message: `Đã bắt đầu cào video Douyin (${scopeLabel}, ${detailLabel}) trong nền!`,
    };
  }

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
    const rawInput = (body?.sec_user_id || '').trim();
    if (!rawInput) throw new HttpException({ error: 'sec_user_id is required' }, HttpStatus.BAD_REQUEST);

    const targetCount = normalizeTargetCount(body?.num_of_posts);

    // 1. Trích xuất URL nếu user dán đoạn text chia sẻ từ app Douyin (có lẫn chữ tiếng Trung)
    const urlMatch = rawInput.match(/https?:\/\/[^\s"'<>]+/i);
    const cleaned = urlMatch ? urlMatch[0] : rawInput;

    let secUserId: string | null = null;

    // 2. Nếu đã là sec_user_id trần (bắt đầu bằng MS4wLjAB)
    if (/^MS4wLjAB[\w-]+$/i.test(cleaned)) {
      secUserId = cleaned;
    } else {
      // 3. Resolve short link nếu là link rút gọn (v.douyin.com...)
      const resolved = await resolveShortLink(cleaned);

      // 4. Bóc từ URL profile: douyin.com/user/<sec_user_id>
      const profileMatch =
        resolved.match(/(?:douyin\.com\/user\/|sec_uid=)(MS4wLjAB[\w-]+)/i) ||
        resolved.match(/douyin\.com\/user\/([\w-]+)/i);
      if (profileMatch) {
        secUserId = profileMatch[1];
      }

      // 5. Nếu user dán link video (douyin.com/video/<aweme_id> hoặc iesdouyin.com/share/video/<aweme_id>)
      if (!secUserId) {
        const videoMatch = resolved.match(/(?:video|note)\/(\d+)/i) || resolved.match(/modal_id=(\d+)/i);
        if (videoMatch) {
          const awemeId = videoMatch[1];
          const authorSecUid = await this.aiClient.resolveVideoAuthor(awemeId);
          if (authorSecUid && /^MS4wLjAB[\w-]+$/i.test(authorSecUid)) {
            secUserId = authorSecUid;
          }
        }
      }

      // 6. Tìm MS4wLjAB ở bất cứ vị trí nào trong URL (query param hoặc path)
      if (!secUserId) {
        const anySecUidMatch = resolved.match(/(MS4wLjAB[\w-]+)/i);
        if (anySecUidMatch) {
          secUserId = anySecUidMatch[1];
        }
      }

      // 7. Nếu link trỏ về trang chủ douyin.com (thường do link rút gọn v.douyin.com đã hết hạn hoặc bị xoá)
      if (!secUserId) {
        const isHomepage = /^https?:\/\/(?:www\.)?douyin\.com\/?(?:\?.*)?$/i.test(resolved);
        if (isHomepage || cleaned.includes('v.douyin.com')) {
          throw new HttpException(
            {
              error:
                'Link Douyin này không tồn tại, đã hết hạn hoặc chỉ trỏ về trang chủ. Vui lòng dán link trang cá nhân (douyin.com/user/...) hoặc link video còn hoạt động.',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        throw new HttpException(
          {
            error:
              'Không tìm thấy định danh kênh Douyin (sec_user_id) hợp lệ từ link đã nhập. Vui lòng kiểm tra lại URL.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // 8. Đảm bảo secUserId hợp lệ và an toàn trước khi lưu vào DB (tránh lỗi varchar(255))
    if (!secUserId || secUserId.length > 200 || !/^MS4wLjAB[\w-]+$/i.test(secUserId)) {
      throw new HttpException(
        {
          error:
            'Định danh kênh Douyin không hợp lệ. sec_user_id phải bắt đầu bằng MS4wLjAB...',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

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
    const newValue = await this.service.toggleProfile(BigInt(pk), field, req.user);
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
