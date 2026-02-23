import { Body, Controller, Get, Post, Query, UseGuards, Request } from '@nestjs/common';
import { SearchRecommendationService } from './search-recommendations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

@ApiTags('Search Recommendations')
@Controller('search-recommendations')
export class SearchRecommendationController {
    constructor(private readonly searchService: SearchRecommendationService) { }

    @Get('suggest')
    @ApiOperation({ summary: 'Get AI-powered search suggestions (Gemini)' })
    @ApiQuery({ name: 'q', description: 'Search query', required: true })
    @ApiQuery({ name: 'count', description: 'Max suggestions (default: 10)', required: false })
    async getSuggestions(
        @Query('q') query: string,
        @Query('count') count?: string,
    ) {
        const maxCount = count ? Math.min(parseInt(count, 10), 20) : 10;
        return this.searchService.getSuggestions(query, maxCount);
    }

    @Post('record')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Record a search term for analytics' })
    async recordSearch(@Request() req, @Body('query') query: string, @Body('term') term: string) {
        const searchTerm = query || term;
        if (searchTerm) {
            await this.searchService.recordSearch(searchTerm);
        }
        return { success: true };
    }
}
