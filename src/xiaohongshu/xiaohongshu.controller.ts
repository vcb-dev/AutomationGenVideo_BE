import { Controller, Post, Body, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { XiaohongshuService } from './xiaohongshu.service';
import { XhsSearchDto, XhsSearchResponse } from './dto/search-xhs.dto';
// Add AuthGuard imports if needed, currently keeping open for Dashboard
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('xiaohongshu')
export class XiaohongshuController {
  constructor(private readonly xhsService: XiaohongshuService) {}

  @Post('search')
  // @UseGuards(JwtAuthGuard) // Uncomment to protect
  async searchNotes(@Body() searchDto: XhsSearchDto): Promise<XhsSearchResponse> {
    try {
      return await this.xhsService.searchNotes(searchDto);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to search Xiaohongshu',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
