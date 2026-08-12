import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiIntegrationService } from '../ai-integration/ai-integration.service';
import { SearchKeywordsService } from './search-keywords.service';

// Thay thế keyword_suggest / keyword_hit / keyword_list / keyword_create bên AI
// (đã xóa) — route giữ nguyên path cũ để FE (scraperService.ts) không cần đổi gì.
@UseGuards(JwtAuthGuard)
@Controller('scraper/keywords')
export class SearchKeywordsController {
  constructor(
    private readonly service: SearchKeywordsService,
    private readonly aiIntegration: AiIntegrationService,
  ) {}

  // Dịch từ khoá sang tiếng Trung để FE xem trước trước khi cào (nền tảng Trung Quốc).
  // Theo quy tắc FE → BE → AI: FE gọi vào đây thay vì nối thẳng AI service.
  @Post('translate')
  @HttpCode(HttpStatus.OK)
  async translate(@Body() body: { text?: string }) {
    const text = (body?.text || '').trim();
    if (!text) throw new HttpException({ error: 'text is required' }, HttpStatus.BAD_REQUEST);
    return this.aiIntegration.translateSearchKeyword(text);
  }

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
