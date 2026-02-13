

import { Controller, Get, Post, Query, Param, Res } from '@nestjs/common';
import { Response } from 'express';
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

    @Get('inspect')
    @ApiOperation({ summary: 'Inspect new Lark table structure' })
    async inspectTable() {
        return this.larkService.inspectTableStructure();
    }

    @Post('clear')
    @ApiOperation({ summary: 'Clear all larkReport data' })
    async clearData() {
        try {
            await this.larkService.clearAllReports();
            return { message: 'All larkReport data cleared successfully' };
        } catch (error) {
            return { message: 'Clear failed', error: error.message };
        }
    }

    @Post('reset-and-sync')
    @ApiOperation({ summary: 'Clear old data and sync from new Lark table' })
    async resetAndSync() {
        try {
            await this.larkService.clearAllReports();
            await this.larkService.syncReportData();
            return { message: 'Reset and sync completed successfully' };
        } catch (error) {
            return { message: 'Reset and sync failed', error: error.message };
        }
    }

    @Get('inspect-employee')
    @ApiOperation({ summary: 'Inspect employee Lark table structure' })
    async inspectEmployeeTable() {
        return this.larkService.inspectEmployeeTable();
    }

    @Get('employee')
    @ApiOperation({ summary: 'Get employee data from Database' })
    @ApiResponse({ status: 200, description: 'Returns list of employees from PostgreSQL.' })
    async getEmployees() {
        return this.larkService.getEmployeeData();
    }

    @Post('sync-employee')
    @ApiOperation({ summary: 'Manually trigger employee sync from Lark to DB' })
    async syncEmployeeData() {
        try {
            const result = await this.larkService.syncEmployeeData();
            return {
                message: 'Employee sync completed successfully',
                ...result
            };
        } catch (error) {
            return { message: 'Employee sync failed', error: error.message };
        }
    }

    @Get('inspect-kpi')
    @ApiOperation({ summary: 'Inspect KPI Lark table structure' })
    async inspectKPITable() {
        return this.larkService.inspectKPITable();
    }

    @Get('kpi')
    @ApiOperation({ summary: 'Get KPI data from Database' })
    @ApiResponse({ status: 200, description: 'Returns list of KPI data from PostgreSQL.' })
    async getKPI() {
        return this.larkService.getKPIData();
    }

    @Post('sync-kpi')
    @ApiOperation({ summary: 'Manually trigger KPI sync from Lark to DB' })
    async syncKPIData() {
        try {
            const result = await this.larkService.syncKPIData();
            return {
                message: 'KPI sync completed successfully',
                ...result
            };
        } catch (error) {
            return { message: 'KPI sync failed', error: error.message };
        }
    }

    @Get('tables')
    @ApiOperation({ summary: 'List all tables in the Lark Base' })
    async listTables() {
        return this.larkService.listTables();
    }

    @Get('user-activity')
    @ApiOperation({ summary: 'Get combined user activity reports (LarkReport + LarkKPI)' })
    @ApiResponse({ status: 200, description: 'Returns combined user activity data with avatars from KPI.' })
    async getUserActivityReports(@Query('date') date?: string, @Query('team') team?: string) {
        const filters = {};
        if (date) filters['date'] = date;
        if (team) filters['team'] = team;

        return this.larkService.getUserActivityReports(filters);
    }

    @Get('media/:mediaId')
    @ApiOperation({ summary: 'Proxy Lark media download' })
    async getMedia(@Param('mediaId') mediaId: string, @Query('extra') extra: string, @Res() res: Response) {
        try {
            const { data, contentType } = await this.larkService.getMedia(mediaId, extra);
            res.setHeader('Content-Type', contentType);
            // Cache for 1 day
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.send(Buffer.from(data));
        } catch (error) {
            return res.status(404).send('Media not found');
        }
    }
}
