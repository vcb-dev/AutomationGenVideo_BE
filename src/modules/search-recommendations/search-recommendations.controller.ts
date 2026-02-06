import { Body, Controller, Get, Post, Query, UseGuards, Request } from '@nestjs/common';
import { SearchRecommendationService } from './search-recommendations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Search Recommendations')
@Controller('search-recommendations')
export class SearchRecommendationController {
    constructor(private readonly searchService: SearchRecommendationService) { }

    @Post('record')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Record a search term and log activity' })
    async recordSearch(@Request() req, @Body('term') term: string) {
        if (term) {
            await this.searchService.recordSearch(term, req.user.id);
        }
        return { success: true };
    }

    @Get('suggest')
    @ApiOperation({ summary: 'Get search suggestions (Public)' })
    async getSuggestions(@Query('q') query: string) {
        const suggestions = await this.searchService.getSuggestions(query);
        return { suggestions };
    }

    @Get('history')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.MANAGER, UserRole.ADMIN)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get search audit logs (Manager only)' })
    async getHistory(@Query('limit') limit: number) {
        return this.searchService.getSearchHistory(limit ? Number(limit) : 50);
    }
}
