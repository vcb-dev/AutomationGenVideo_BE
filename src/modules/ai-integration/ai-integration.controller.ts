import { Controller, Post, Get, Put, Delete, Body, Param, Query, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { AiIntegrationService } from './ai-integration.service';
import { SearchVideoDto, UserVideosDto } from './dto/search-video.dto';

@ApiTags('AI Integration')
@Controller('ai')
export class AiIntegrationController {
  constructor(private readonly aiService: AiIntegrationService) {}

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Search for videos using AI service (v2)' })
  @ApiResponse({ status: 200, description: 'Return search results or task ID if async.' })
  @ApiResponse({ status: 202, description: 'Async search started, returns task_id.' })
  async search(@Body() searchDto: SearchVideoDto) {
    return this.aiService.searchVideos(
      searchDto.platform,
      searchDto.keyword,
      searchDto.min_likes || 0,
      searchDto.min_views || 0,
      searchDto.max_results || 20,
      searchDto.use_cache !== false,
      searchDto.async_mode || false,
      searchDto.search_type || 'posts',
    );
  }

  @Post('user-videos')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get videos from a specific user/channel' })
  @ApiResponse({ status: 200, description: 'Return user videos.' })
  async getUserVideos(@Body() userVideosDto: UserVideosDto) {
    return this.aiService.getUserVideos(
      userVideosDto.platform,
      userVideosDto.username,
      userVideosDto.max_results,
      userVideosDto.until_date,
      userVideosDto.start_date,
      userVideosDto.end_date,
    );
  }

  @Get('search/status/:taskId')
  @ApiOperation({ summary: 'Check async search task status' })
  @ApiResponse({ status: 200, description: 'Return task status and results if completed.' })
  async checkTaskStatus(@Param('taskId') taskId: string) {
    return this.aiService.checkTaskStatus(taskId);
  }

  @Get('videos/by-channel')
  @ApiOperation({ summary: 'Get videos by channel from database' })
  @ApiQuery({ name: 'platform', required: true })
  @ApiQuery({ name: 'username', required: true })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['views', 'likes', 'date'] })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'period', required: false, enum: ['yesterday', 'week', 'month', 'all'] })
  @ApiResponse({ status: 200, description: 'Return channel videos.' })
  async getVideosByChannel(
    @Query('platform') platform: string,
    @Query('username') username: string,
    @Query('limit') limit?: number,
    @Query('sortBy') sortBy?: string,
    @Query('order') order?: string,
    @Query('period') period?: string,
  ) {
    return this.aiService.getVideosByChannel(
      platform,
      username,
      limit || 20,
      sortBy || 'views',
      order || 'desc',
      period
    );
  }

  @Get('search/history')
  @ApiOperation({ summary: 'Get search history' })
  @ApiQuery({ name: 'platform', required: false, description: 'Filter by platform' })
  @ApiQuery({ name: 'limit', required: false, description: 'Limit results', type: Number })
  @ApiResponse({ status: 200, description: 'Return search history.' })
  async getSearchHistory(
    @Query('platform') platform?: string,
    @Query('limit') limit?: number,
  ) {
    return this.aiService.getSearchHistory(platform, limit || 50);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get AI service statistics' })
  @ApiResponse({ status: 200, description: 'Return statistics.' })
  async getStats() {
    return this.aiService.getStats();
  }

  @Get('health')
  @ApiOperation({ summary: 'Check AI service health' })
  @ApiResponse({ status: 200, description: 'AI service is healthy.' })
  @ApiResponse({ status: 503, description: 'AI service is unavailable.' })
  async healthCheck() {
    return this.aiService.healthCheck();
  }

  // Collections endpoints
  @Get('collections')
  @ApiOperation({ summary: 'Get all collections' })
  async getCollections() {
    return this.aiService.getCollections();
  }

  @Post('collections')
  @ApiOperation({ summary: 'Create a new collection' })
  async createCollection(@Body() data: any) {
    return this.aiService.createCollection(data);
  }

  @Get('collections/:id')
  @ApiOperation({ summary: 'Get collection detail' })
  async getCollection(@Param('id') id: string) {
    return this.aiService.getCollection(id);
  }

  @Put('collections/:id')
  @ApiOperation({ summary: 'Update collection' })
  async updateCollection(@Param('id') id: string, @Body() data: any) {
    return this.aiService.updateCollection(id, data);
  }

  @Delete('collections/:id')
  @ApiOperation({ summary: 'Delete collection' })
  async deleteCollection(@Param('id') id: string) {
    return this.aiService.deleteCollection(id);
  }

  @Post('collections/:id/add-video')
  @ApiOperation({ summary: 'Add video to collection' })
  async addVideoToCollection(@Param('id') id: string, @Body() data: any) {
    return this.aiService.addVideoToCollection(id, data);
  }

  @Delete('collections/:id/remove-video/:videoId')
  @ApiOperation({ summary: 'Remove video from collection' })
  async removeVideoFromCollection(@Param('id') id: string, @Param('videoId') videoId: string) {
    return this.aiService.removeVideoFromCollection(id, videoId);
  }

  @Get('proxy/avatar')
  @ApiOperation({ summary: 'Proxy avatar image to bypass CORS and expiry issues' })
  @ApiQuery({ name: 'url', required: true, description: 'Original avatar URL to proxy' })
  @ApiResponse({ status: 200, description: 'Returns proxied image' })
  async proxyAvatar(@Query('url') url: string, @Res() res: Response) {
    return this.aiService.proxyAvatar(url, res);
  }
}
