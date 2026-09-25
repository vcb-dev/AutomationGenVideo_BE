import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { normalizeTargetCount } from '../../common/utils/target-count.util';
import { extractThreadsUsername } from '../../common/utils/channel-url.util';
import {
  ThreadsScraperService,
  TOGGLE_FIELDS,
  type ThreadsToggleField,
} from './threads-scraper.service';
import { ThreadsScraperReadService } from './threads-scraper-read.service';

function parseBigIntParam(val: string, name = 'id'): bigint {
  try {
    return BigInt(val);
  } catch {
    throw new HttpException(`Tham số ${name} không hợp lệ`, HttpStatus.BAD_REQUEST);
  }
}

@UseGuards(JwtAuthGuard)
@Controller('scraper/threads')
export class ThreadsScraperController {
  private readonly logger = new Logger(ThreadsScraperController.name);

  constructor(
    private readonly service: ThreadsScraperService,
    private readonly readService: ThreadsScraperReadService,
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
      this.logger.error(`[THREADS-SYNC-ALL] Lỗi đồng bộ: ${err.message}`);
    });
    const scopeLabel = body?.scope === 'bookmarked' ? 'kênh đã lưu' : body?.scope === 'all' ? 'tất cả kênh' : 'kênh chú ý';
    const detailLabel = body?.mode === 'days' ? `${body.days || 7} ngày gần nhất` : `${body?.count || 20} bài viết mới nhất`;
    return {
      status: 'ok',
      message: `Đã bắt đầu cào dữ liệu Threads (${scopeLabel}, ${detailLabel}) trong nền!`,
    };
  }

  @Post('profiles/batch-scrape')
  async batchScrape(
    @Body() body: { usernames: string[]; count?: number; mode?: 'count' | 'days'; days?: number },
  ) {
    const list = Array.isArray(body.usernames) ? body.usernames : [];
    if (list.length === 0) {
      throw new HttpException('Danh sách username không được để trống', HttpStatus.BAD_REQUEST);
    }
    const count = normalizeTargetCount(body.count);
    return this.service.batchScrape(list, count, { mode: body.mode, days: body.days });
  }

  @Post('profiles/scrape')

  async scrape(
    @Body() body: { username?: string; target_count?: number; count?: number; mode?: 'count' | 'days'; days?: number },
  ) {
    const raw = (body.username || '').trim();
    if (!raw) {
      throw new HttpException('Username Threads không được để trống', HttpStatus.BAD_REQUEST);
    }
    const username = extractThreadsUsername(raw);
    if (!username) {
      throw new HttpException(
        'Username Threads không hợp lệ. Hãy dán link TRANG CÁ NHÂN (threads.net/@username) hoặc nhập username.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const count = normalizeTargetCount(body.target_count || body.count);
    return this.service.scrapeByUsername(username, count, { mode: body.mode, days: body.days });
  }

  @Post('search/top')
  async searchTop(
    @Body() body: { query?: string; count?: number; mode?: 'count' | 'days'; days?: number },
  ) {
    const query = (body.query || '').trim();
    if (!query) {
      throw new HttpException('Từ khoá tìm kiếm không được để trống', HttpStatus.BAD_REQUEST);
    }
    const count = normalizeTargetCount(body.count);
    return this.service.searchHotPosts(query, count, { mode: body.mode, days: body.days });
  }

  @Post('posts/ingest-hot')
  async ingestHotPosts(
    @Body() body: { posts?: any[] },
  ) {
    const posts = body.posts || [];
    return this.service.ingestHotPosts(posts);
  }

  @Get('posts')
  async allPosts(
    @Query('search') search?: string,
    @Query('media_type') mediaType?: string,
    @Query('sort_by') sortBy?: 'date' | 'likes' | 'views' | 'replies',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.readService.listAllPosts({
      search,
      media_type: mediaType,
      sort_by: sortBy,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('profiles')
  async list(
    @Query('search') search?: string,
    @Query('is_tracked') isTracked?: string,
    @Query('is_bookmarked') isBookmarked?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.readService.listProfiles({
      search,
      is_tracked: isTracked !== undefined ? isTracked === 'true' : undefined,
      is_bookmarked: isBookmarked !== undefined ? isBookmarked === 'true' : undefined,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('profiles/:id')
  async detail(@Param('id') id: string) {
    const profileId = parseBigIntParam(id);
    return this.readService.getProfileDetail(profileId);
  }

  @Get('profiles/:id/posts')
  async posts(
    @Param('id') id: string,
    @Query('search') search?: string,
    @Query('media_type') mediaType?: string,
    @Query('sort_by') sortBy?: 'date' | 'likes' | 'views' | 'replies',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const profileId = parseBigIntParam(id);
    return this.readService.getProfilePosts(profileId, {
      search,
      media_type: mediaType,
      sort_by: sortBy,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Patch('profiles/:id/toggle')
  async toggle(
    @Param('id') id: string,
    @Body() body: { field: ThreadsToggleField; value: boolean },
  ) {
    const profileId = parseBigIntParam(id);
    if (!TOGGLE_FIELDS.includes(body.field)) {
      throw new HttpException(`Trường ${body.field} không hợp lệ`, HttpStatus.BAD_REQUEST);
    }
    return this.service.toggle(profileId, body.field, Boolean(body.value));
  }

  @Delete('profiles/:id')
  async delete(@Param('id') id: string) {
    const profileId = parseBigIntParam(id);
    return this.service.deleteProfile(profileId);
  }
}
