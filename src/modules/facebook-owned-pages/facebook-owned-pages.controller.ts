import { Controller, ForbiddenException, Get, Body, HttpException, HttpStatus, Logger, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FacebookOwnedPagesService } from './facebook-owned-pages.service';
import { FacebookOwnedPagesReadService } from './facebook-owned-pages-read.service';
import { InvalidRefreshDaysError, parseRefreshDays } from './parse-refresh-days';

// Kéo lại chỉ số là thao tác nặng (mỗi video một lượt hỏi Graph API) nên siết quyền như thao tác
// quản lý kênh ở các module scraper khác.
function assertCanRefreshMetrics(req: any): void {
  const roles: string[] = req.user?.roles ?? [];
  if (!roles.includes(UserRole.ADMIN) && !roles.includes(UserRole.LEADER)) {
    throw new ForbiddenException('Chỉ leader/admin được kéo lại chỉ số');
  }
}

// Thay thế facebook_import / facebook_sync / facebook_backfill bên AI (đã xóa) —
// route giữ nguyên path cũ để FE (facebookService.ts) không cần đổi gì.
// GET (get_managed_pages/get_synced_videos) cũng đã chuyển hẳn sang BE
// (FacebookOwnedPagesReadService).
// Trước đây AI tự check IsAuthenticated; giờ BE xử lý native nên phải tự guard.
@UseGuards(JwtAuthGuard)
@Controller('facebook')
export class FacebookOwnedPagesController {
  private readonly logger = new Logger(FacebookOwnedPagesController.name);

  constructor(
    private readonly service: FacebookOwnedPagesService,
    private readonly readService: FacebookOwnedPagesReadService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('manage-pages')
  async managedPages(@Query() query: Record<string, string>) {
    return this.readService.getManagedPages(query);
  }

  @Get('page-videos/:pageId')
  async syncedVideos(@Param('pageId') pageId: string, @Query() query: Record<string, string>) {
    return this.readService.getSyncedVideos(pageId, query);
  }

  @Post('import')
  async import(@Body() body: { user_access_token?: string }) {
    try {
      const { created, updated } = await this.service.importManagedPages(body?.user_access_token);
      return {
        status: 'ok',
        created,
        updated,
        message: `Đã đồng bộ xong danh sách Page (Thêm mới: ${created}, Cập nhật: ${updated})`,
      };
    } catch (err: any) {
      throw new HttpException({ status: 'error', message: err.message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('sync')
  async sync(@Body() body: { page_id?: string }) {
    const pageId = body?.page_id;
    if (!pageId) throw new HttpException({ error: 'page_id is required' }, HttpStatus.BAD_REQUEST);

    const page = await this.prisma.video_management_managedfacebookpage.findUnique({ where: { page_id: pageId } });
    if (!page) throw new HttpException({ error: `Page ${pageId} not found` }, HttpStatus.NOT_FOUND);

    if (page.is_scraping) {
      return { status: 'ok', message: `Page ${page.name} đang được cào bởi worker. Vui lòng đợi.`, is_scraping: true };
    }

    // Fire-and-forget — trả về ngay, chạy nền giống Celery worker trước đây.
    this.service.syncPage(pageId, 10).catch((err) => {
      this.logger.error(`[SYNC] ${pageId} thất bại: ${err.message}`);
    });

    return {
      status: 'ok',
      message: `Đã gửi yêu cầu cào video cho ${page.name}. Dữ liệu sẽ cập nhật trong vài phút.`,
      is_scraping: true,
    };
  }

  /**
   * Kéo lại view/like/comment/share cho video đăng trong N ngày gần đây.
   *
   * Vì sao cần endpoint riêng thay vì đợi cron: cron 12:00 gọi cứng 7 ngày, còn delta sync chỉ
   * lấy 10 bài mới nhất mỗi page. Video cũ hơn thế thì KHÔNG đường nào chạm tới. Sự cố
   * 27/07–09/08/2026 để lại 1.584 video có view = 0 nằm đúng vùng chết đó.
   *
   * Khác delta sync ở chỗ quyết định: hàm này lấy danh sách post_id TỪ DB rồi hỏi Facebook đích
   * danh từng video, nên không dính giới hạn 10 bài mới nhất.
   */
  @Post('refresh-metrics')
  async refreshMetrics(@Req() req: any, @Body() body: { days?: number | string }) {
    assertCanRefreshMetrics(req);

    let days: number;
    try {
      days = parseRefreshDays(body?.days);
    } catch (err) {
      if (err instanceof InvalidRefreshDaysError) {
        throw new HttpException({ error: err.message }, HttpStatus.BAD_REQUEST);
      }
      throw err;
    }

    // Chạy nền: 1.584 video vượt xa thời gian chờ của một request HTTP.
    this.service.refreshRecentMetrics(days).then(
      (r) => this.logger.log(`[REFRESH-METRICS] ${days} ngày: cập nhật ${r.updated}/${r.total} video`),
      (err) => this.logger.error(`[REFRESH-METRICS] ${days} ngày thất bại: ${err.message}`),
    );

    return {
      status: 'ok',
      days,
      message: `Đã bắt đầu kéo lại chỉ số cho video đăng trong ${days} ngày gần đây. Theo dõi log [REFRESH-METRICS] để biết kết quả.`,
    };
  }

  @Post('backfill')
  async backfill(@Body() body: { page_id?: string }) {
    const pageId = body?.page_id;
    if (!pageId) throw new HttpException({ error: 'page_id is required' }, HttpStatus.BAD_REQUEST);

    const page = await this.prisma.video_management_managedfacebookpage.findUnique({ where: { page_id: pageId } });
    if (!page) throw new HttpException({ error: `Page ${pageId} not found` }, HttpStatus.NOT_FOUND);

    if (page.is_scraping) {
      return { status: 'ok', message: `Page ${page.name} đang được xử lý. Vui lòng đợi.`, is_scraping: true };
    }

    // Batch đầu SYNCHRONOUS (~20 video, rất nhanh) — trả data ngay cho user
    const result = await this.service.backfillPageSync(pageId, 20);

    // Dispatch cào tiếp tới tổng 300 video (fire-and-forget) — sẽ tự set is_backfilled + unlock
    this.service.backfillPage(pageId, 300).catch((err) => {
      this.logger.error(`[BACKFILL] ${pageId} continuation thất bại: ${err.message}`);
    });

    return {
      status: 'ok',
      message: `Đã cào ${result.created} video đầu cho ${page.name}. Đang tiếp tục cào thêm...`,
      is_scraping: true,
    };
  }
}
