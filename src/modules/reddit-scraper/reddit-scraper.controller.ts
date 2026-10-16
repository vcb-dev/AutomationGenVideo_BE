import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { normalizeTargetCount } from '../../common/utils/target-count.util';
import { RedditSearchOptions } from './reddit-ai-client.service';
import { normalizeSubredditName, parseRedditSort, parseRedditTimeRange } from './reddit-input.util';
import { RedditScraperService } from './reddit-scraper.service';
import { RedditScraperReadService } from './reddit-scraper-read.service';

interface RedditScrapeBody {
  sort?: string;
  time_range?: string;
  count?: number;
}

function readOptions(body: RedditScrapeBody): RedditSearchOptions {
  const sort = parseRedditSort(body?.sort);
  const timeRange = parseRedditTimeRange(body?.time_range);
  if (!sort) throw new HttpException({ error: 'Cách sắp xếp không hợp lệ' }, HttpStatus.BAD_REQUEST);
  if (!timeRange) throw new HttpException({ error: 'Khoảng thời gian không hợp lệ' }, HttpStatus.BAD_REQUEST);
  return { sort, time_range: timeRange, count: normalizeTargetCount(body?.count) };
}

// Cào gọi TikHub (tính phí theo lượt) nên chỉ ADMIN/LEADER, như tìm kiếm / cào kênh ở các nền tảng khác.
@UseGuards(JwtAuthGuard)
@Controller('scraper/reddit')
export class RedditScraperController {
  constructor(
    private readonly service: RedditScraperService,
    private readonly readService: RedditScraperReadService,
  ) {}

  @Post('search')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async search(@Body() body: RedditScrapeBody & { query?: string }) {
    const query = (body?.query || '').trim();
    if (!query) throw new HttpException({ error: 'Từ khoá tìm kiếm không được để trống' }, HttpStatus.BAD_REQUEST);
    return this.service.searchPosts(query, readOptions(body));
  }

  @Post('subreddits/scrape')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async scrapeSubreddit(@Body() body: RedditScrapeBody & { subreddit?: string }) {
    const name = normalizeSubredditName(body?.subreddit || '');
    if (!name) {
      throw new HttpException(
        { error: 'Không lấy được tên cộng đồng. Hãy nhập r/tên hoặc dán link reddit.com/r/tên' },
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.service.scrapeSubreddit(name, readOptions(body));
  }

  @Get('subreddits')
  async subreddits(@Query('search') search?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.readService.listSubreddits({ search, page: Number(page) || undefined, limit: Number(limit) || undefined });
  }

  @Delete('subreddits/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async deleteSubreddit(@Param('id') id: string) {
    if (!/^\d+$/.test(id)) throw new HttpException({ error: 'id không hợp lệ' }, HttpStatus.BAD_REQUEST);
    return this.service.deleteSubreddit(BigInt(id));
  }

  @Get('posts')
  async posts(@Query() query: Record<string, string>) {
    return this.readService.listPosts({
      search: query.search,
      subreddit: query.subreddit,
      media_type: query.media_type,
      sort_by: query.sort_by,
      page: Number(query.page) || undefined,
      limit: Number(query.limit) || undefined,
    });
  }
}
