import { Controller, Post, Body, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { DouyinService, DouyinSearchDto, DouyinSearchResponse } from './douyin.service';

@Controller('douyin')
export class DouyinController {
  private readonly logger = new Logger(DouyinController.name);

  constructor(private readonly douyinService: DouyinService) {}

  @Post('search')
  async searchVideos(@Body() searchDto: DouyinSearchDto): Promise<DouyinSearchResponse> {
    // Validation
    if (!searchDto.searchTerm || !searchDto.searchTerm.trim()) {
      throw new HttpException(
        'searchTerm is required',
        HttpStatus.BAD_REQUEST
      );
    }

    if (!['keyword', 'hashtag'].includes(searchDto.searchType)) {
      throw new HttpException(
        'searchType must be "keyword" or "hashtag"',
        HttpStatus.BAD_REQUEST
      );
    }

    // Set defaults
    const dto: DouyinSearchDto = {
      searchTerm: searchDto.searchTerm.trim(),
      searchType: searchDto.searchType,
      maxPosts: searchDto.maxPosts || 50,
      sortBy: searchDto.sortBy || 'general',
      publishTime: searchDto.publishTime || 'all',
    };

    // Validate maxPosts range
    if (dto.maxPosts > 100) {
      dto.maxPosts = 100;
    } else if (dto.maxPosts < 1) {
      dto.maxPosts = 50;
    }

    this.logger.log(
      `Douyin search request - Term: ${dto.searchTerm}, ` +
      `Type: ${dto.searchType}, Max: ${dto.maxPosts}`
    );

    try {
      return await this.douyinService.searchVideos(dto);
    } catch (error) {
      this.logger.error(`Douyin search failed: ${error.message}`);
      throw new HttpException(
        error.message || 'Search failed',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
