
import { Controller, Get, Post } from '@nestjs/common';
import { LarkService } from './lark.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Lark Report')
@Controller('lark')
export class LarkController {
    constructor(private readonly larkService: LarkService) { }

    @Get('report')
    @ApiOperation({ summary: 'Get daily report from Database' })
    @ApiResponse({ status: 200, description: 'Returns list of user reports from PostgreSQL.' })
    async getReport() {
        return this.larkService.getReportData(); // This method name might need updating in service if we want fetching from DB
    }

    @Post('sync')
    @ApiOperation({ summary: 'Manually trigger sync from Lark to DB' })
    async syncData() {
        try {
            await this.larkService.syncReportData();
            return { message: 'Sync completed successfully' };
        } catch (error) {
            return { message: 'Sync failed', error: error.message };
        }
    }
}
