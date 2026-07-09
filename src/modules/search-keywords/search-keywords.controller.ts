import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SearchKeywordsService } from './search-keywords.service';

// Thay thế keyword_suggest / keyword_hit / keyword_list / keyword_create bên AI
// (đã xóa) — route giữ nguyên path cũ để FE (scraperService.ts) không cần đổi gì.
@UseGuards(JwtAuthGuard)
@Controller('scraper/keywords')
export class SearchKeywordsController {
  constructor(private readonly service: SearchKeywordsService) {}

  @Get('suggest')
  async suggest(@Query('q') q?: string) {
    return this.service.suggest((q || '').trim());
  }

  @Post('hit')
  async hit(@Body() body: { keyword?: string }) {
    const keywordText = (body?.keyword || '').trim();
    if (!keywordText) throw new HttpException({ error: 'keyword is required' }, HttpStatus.BAD_REQUEST);
    return this.service.hit(keywordText);
  }

  @Get()
  async list() {
    return this.service.list();
  }

  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: { keyword?: string }) {
    const keywordText = (body?.keyword || '').trim();
    if (!keywordText) throw new HttpException({ error: 'keyword is required' }, HttpStatus.BAD_REQUEST);
    return this.service.create(keywordText);
  }
}
