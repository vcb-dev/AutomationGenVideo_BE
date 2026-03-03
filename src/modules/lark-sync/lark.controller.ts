

import { Controller, Get, Post, Query, Param, Res, Body } from '@nestjs/common';
import { Response } from 'express';
import { LarkService } from './lark.service';
import { LarkSyncService } from './lark-sync.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Lark Report')
@Controller('lark')
export class LarkController {
    constructor(
        private readonly larkService: LarkService,
        private readonly larkSyncService: LarkSyncService,
    ) { }

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
            await this.larkService.syncPermissionData();
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
            await this.larkService.syncPermissionData();
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

    @Post('sync-report-kpi')
    @ApiOperation({ summary: 'Manually trigger Report KPI sync from Lark (Task Progress)' })
    async syncReportKPIData() {
        try {
            const result = await this.larkService.syncReportKPIData();
            return {
                message: 'Report KPI sync completed successfully',
                ...result
            };
        } catch (error) {
            return { message: 'Report KPI sync failed', error: error.message };
        }
    }

    @Post('cleanup-kpi')
    @ApiOperation({ summary: 'Manually trigger cleanup of invalid KPI records' })
    async cleanupKPI() {
        try {
            await this.larkService.handleCleanup();
            return { message: 'KPI cleanup triggered successfully' };
        } catch (error) {
            return { message: 'KPI cleanup failed', error: error.message };
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
    async getUserActivityReports(
        @Query('date') date?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('team') team?: string,
        @Query('requesterEmail') requesterEmail?: string,
        @Query('timeType') timeType?: string
    ) {
        const filters = {};
        if (date) filters['date'] = date;
        if (startDate) filters['startDate'] = startDate;
        if (endDate) filters['endDate'] = endDate;
        if (team) filters['team'] = team;
        if (requesterEmail) filters['requesterEmail'] = requesterEmail;
        if (timeType) filters['timeType'] = timeType;

        return this.larkService.getUserActivityReports(filters);
    }

    @Get('personal-history')
    @ApiOperation({ summary: 'Get historical KPI data for a specific user' })
    async getPersonalHistory(
        @Query('email') email: string,
        @Query('name') name?: string
    ) {
        return this.larkService.getPersonalHistory(email, name);
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

    @Post('sync-permission')
    @ApiOperation({ summary: 'Manually trigger permission sync from Lark to DB' })
    async syncPermissionData() {
        try {
            await this.larkService.syncPermissionData();
            return { message: 'Permission sync completed successfully' };
        } catch (error) {
            return { message: 'Permission sync failed', error: error.message };
        }
    }

    @Get('permissions')
    @ApiOperation({ summary: 'Get all permissions from Database' })
    async getPermissions() {
        return this.larkService.getPermissionData();
    }

    @Get('user-permission')
    @ApiOperation({ summary: 'Get permission for a specific user by email' })
    async getUserPermission(@Query('email') email: string) {
        return this.larkService.getPermissionByEmail(email);
    }

    @Post('update-outstanding-status')
    @ApiOperation({ summary: 'Update status of a ReportOutstanding record' })
    async updateOutstandingStatus(
        @Body('id') id: string,
        @Body('status') status: string
    ) {
        return this.larkService.updateOutstandingStatus(id, status);
    }
    @Get('inspect-generic')
    @ApiOperation({ summary: 'Inspect any Lark table structure' })
    async inspectGeneric(
        @Query('baseId') baseId: string,
        @Query('tableId') tableId: string
    ) {
        return this.larkService.inspectTableGeneric(baseId, tableId);
    }

    @Post('sync-huyk-channel')
    @ApiOperation({ summary: 'Manually trigger Huyk Channel data sync from Lark' })
    async syncHuykChannelData() {
        try {
            await this.larkService.syncHuykChannelData();
            return { message: 'Huyk Channel sync completed successfully' };
        } catch (error) {
            return { message: 'Huyk Channel sync failed', error: error.message };
        }
    }

    @Post('reset-huyk-channel')
    @ApiOperation({ summary: 'Clear and re-sync Huyk Channel data' })
    async resetHuykChannelData() {
        try {
            await this.larkService.clearHuykChannels();
            await this.larkService.syncHuykChannelData();
            return { message: 'Huyk Channel reset and sync completed successfully' };
        } catch (error) {
            return { message: 'Huyk Channel reset failed', error: error.message };
        }
    }

    @Get('huyk-channel')
    @ApiOperation({ summary: 'Get Huyk Channel data from Database' })
    async getHuykChannel() {
        return this.larkService.getHuykChannelData();
    }

    @Post('sync-hr')
    @ApiOperation({ summary: 'Manually trigger HR sync from Lark (User accounts)' })
    async syncHRData() {
        try {
            const result = await this.larkSyncService.syncFromLark();
            return { message: 'HR sync completed successfully', data: result };
        } catch (error) {
            return { message: 'HR sync failed', error: error.message };
        }
    }

    @Get('hr-status')
    @ApiOperation({ summary: 'Get HR sync status - compare Lark vs local DB' })
    async getHRStatus() {
        return this.larkSyncService.getSyncStatus();
    }

    @Get('list-task')
    @ApiOperation({ summary: 'Get List Task data from Database' })
    async getListTask() {
        return this.larkService.getListTaskData();
    }

    @Get('dashboard-analytics')
    @ApiOperation({ summary: 'Get aggregated dashboard analytics for video production' })
    async getDashboardAnalytics(
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('team') team?: string,
    ) {
        return this.larkService.getDashboardAnalytics({ startDate, endDate, team });
    }

    @Post('sync-list-task')
    @ApiOperation({ summary: 'Manually trigger List Task data sync from Lark' })
    async syncListTaskData() {
        try {
            const result = await this.larkService.syncListTaskData();
            return { message: 'List Task sync completed successfully', ...result };
        } catch (error) {
            return { message: 'List Task sync failed', error: error.message };
        }
    }
}
