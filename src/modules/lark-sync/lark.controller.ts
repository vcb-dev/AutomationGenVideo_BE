

import { Controller, Get, Post, Query, Param, Res, Body, UploadedFiles, UseInterceptors, Header, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { LarkService } from './lark.service';
import { LarkSyncService } from './lark-sync.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Lark Report')
@Controller('lark')
@SkipThrottle({ long: true, short: true })
export class LarkController {
    private readonly logger = new Logger(LarkController.name);

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
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({ summary: 'Manually trigger sync from Lark to DB (non-blocking)' })
    async syncData() {
        // Fire-and-forget — return immediately so clients are not left waiting 10-60s
        Promise.resolve()
            .then(() => this.larkService.syncReportData())
            .then(() => this.larkService.syncPermissionData())
            .catch(e => this.logger.error('Background sync failed', e));
        return { message: 'Sync queued', status: 'accepted' };
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
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({ summary: 'Clear old data and sync from new Lark table (non-blocking)' })
    async resetAndSync() {
        Promise.resolve()
            .then(() => this.larkService.clearAllReports())
            .then(() => this.larkService.syncReportData())
            .then(() => this.larkService.syncPermissionData())
            .catch(e => this.logger.error('Background reset-and-sync failed', e));
        return { message: 'Reset and sync queued', status: 'accepted' };
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
    @ApiOperation({ summary: 'Manually trigger KPI sync from Lark to DB (blocking)' })
    async syncKPIData() {
        try {
            const result = await this.larkService.syncKPIData();
            this.logger.log(`[sync-kpi] completed: synced=${result?.synced ?? 0}, total=${result?.total ?? 0}`);
            return {
                message: 'KPI sync completed successfully',
                ...result,
            };
        } catch (error) {
            this.logger.error(`[sync-kpi] failed: ${error?.message || error}`, error?.stack);
            return { message: 'KPI sync failed', error: error?.message || String(error) };
        }
    }

    @Get('inspect-kpi-do-da')
    @ApiOperation({ summary: 'Inspect KPI Đồ Da Lark table structure' })
    async inspectKPITableDoDa() {
        return this.larkService.inspectKPITableDoDa();
    }

    @Get('kpi-do-da')
    @ApiOperation({ summary: 'Get KPI Đồ Da data from Database' })
    @ApiResponse({ status: 200, description: 'Returns list of KPI Đồ Da from PostgreSQL (lark_kpi_do_da).' })
    async getKPIDoDa() {
        return this.larkService.getKPIDoDaData();
    }

    @Post('sync-kpi-do-da')
    @ApiOperation({ summary: 'Manually trigger KPI Đồ Da sync from Lark to DB' })
    async syncKPIDoDaData() {
        try {
            const result = await this.larkService.syncKPIDoDaData();
            return {
                message: 'KPI Đồ Da sync completed successfully',
                ...result,
            };
        } catch (error) {
            return { message: 'KPI Đồ Da sync failed', error: error.message };
        }
    }


    @Post('pull-kpi-from-server')
    @ApiOperation({ summary: 'Pull lark_kpi snapshot từ SERVER_DATABASE_URL về local DB (server → local)' })
    async pullKpiFromServer() {
        try {
            const result = await this.larkService.pullKpiFromServer();
            return { message: `Pull completed: ${result.pulled} rows synced to local DB`, ...result };
        } catch (error) {
            this.logger.error(`[pull-kpi-from-server] failed: ${error?.message || error}`, error?.stack);
            return { message: 'Pull KPI from server failed', error: error?.message || String(error) };
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

    @Get('db-targets')
    @ApiOperation({ summary: 'Debug: show sanitized DB targets (no secrets)' })
    dbTargets() {
        return this.larkService.getDbTargetsDebugInfo();
    }

    @Get('user-activity')
    @Header('Cache-Control', 'private, max-age=120, stale-while-revalidate=300')
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
        if (requesterEmail) filters['requesterEmail'] = requesterEmail.toLowerCase().trim();
        if (timeType) filters['timeType'] = timeType;

        return this.larkService.getUserActivityReports(filters);
    }

    @Post('clear-activity-cache')
    @ApiOperation({ summary: 'Clear the user activity cache explicitly after submission' })
    clearActivityCache() {
        this.larkService.invalidateActivityCache();
        return { message: 'Activity data cache cleared successfully' };
    }

    @Get('user-report-details')
    @ApiOperation({ summary: 'Get details of a report for a specific user and date' })
    async getUserReportDetails(
        @Query('email') email: string,
        @Query('date') date: string,
    ) {
        return this.larkService.getUserReportDetails(email, date);
    }

    @Get('personal-history')
    @Header('Cache-Control', 'private, max-age=60, stale-while-revalidate=120')
    @ApiOperation({ summary: 'Get historical KPI data for a specific user' })
    async getPersonalHistory(
        @Query('email') email: string,
        @Query('name') name?: string
    ) {
        return this.larkService.getPersonalHistory(email?.toLowerCase().trim(), name);
    }

    @Get('media/:mediaId')
    @ApiOperation({ summary: 'Proxy Lark media download' })
    async getMedia(@Param('mediaId') mediaId: string, @Query('extra') extra: string, @Res() res: Response) {
        // Ensure browser can read the response even on failures.
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Access-Control-Allow-Origin', '*');

        try {
            const { data, contentType } = await this.larkService.getMedia(mediaId, extra);
            res.setHeader('Content-Type', contentType);
            // Cache for 1 hour but force revalidation
            res.setHeader('Cache-Control', 'public, max-age=3600, no-cache, must-revalidate');
            return res.send(Buffer.from(data));
        } catch (error) {
            const status =
                Number(error?.response?.status) ||
                Number(error?.status) ||
                500;
            const detail =
                (typeof error?.response?.data === 'string' && error.response.data) ||
                error?.response?.data?.msg ||
                error?.message ||
                'Failed to fetch media';

            return res.status(status).send(detail);
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
        @Body('status') status: string,
        @Body('approvedBy') approvedBy?: string
    ) {
        return this.larkService.updateOutstandingStatus(id, status, approvedBy);
    }

    @Post('push-outstanding-data')
    @ApiOperation({ summary: 'Push all local outstanding data to Lark Suite' })
    async pushOutstandingData() {
        return this.larkService.pushAllOutstandingData();
    }

    @Post('sync-outstanding')
    @ApiOperation({ summary: 'Manually trigger Outstanding data sync from Lark to DB' })
    async syncOutstandingData() {
        try {
            await this.larkService.syncOutstandingData();
            return { message: 'Outstanding sync completed successfully' };
        } catch (error) {
            return { message: 'Outstanding sync failed', error: error.message };
        }
    }
    @Get('inspect-generic')
    @ApiOperation({ summary: 'Inspect any Lark table structure' })
    async inspectGeneric(
        @Query('baseId') baseId: string,
        @Query('tableId') tableId: string
    ) {
        return this.larkService.inspectTableGeneric(baseId, tableId);
    }

    @Post('sync-channel')
    @ApiOperation({ summary: 'Manually trigger Channel data sync from Lark' })
    async syncChannelData() {
        try {
            await this.larkService.syncChannelData();
            return { message: 'Channel sync completed successfully' };
        } catch (error) {
            return { message: 'Channel sync failed', error: error.message };
        }
    }

    @Post('import-tracked-from-channels')
    @ApiOperation({
        summary: 'Import tracked_channels từ bảng Channel (DB) cho mọi user khớp email/owner',
    })
    async importTrackedFromChannels() {
        const r = await this.larkService.importTrackedChannelsFromChannelTable();
        return { message: 'Import completed', ...r };
    }

    @Post('reset-channel')
    @ApiOperation({ summary: 'Clear and re-sync Channel data (main + Do Da)' })
    async resetChannelData() {
        try {
            await this.larkService.clearChannels();
            await this.larkService.syncChannelData();
            await this.larkService.syncDoDaChannelData();
            return { message: 'Channel reset and sync completed successfully' };
        } catch (error) {
            return { message: 'Channel reset failed', error: error.message };
        }
    }

    @Get('channel')
    @Header('Cache-Control', 'private, max-age=120, stale-while-revalidate=300')
    @ApiOperation({ summary: 'Get Channel data from Database' })
    async getChannel(
        @Query('owner') owner?: string,
        @Query('team') team?: string,
        @Query('email') email?: string,
    ) {
        return this.larkService.getChannelData(owner, team, email?.toLowerCase().trim());
    }

    @Post('enrich-channel-emails')
    @ApiOperation({ summary: 'Cross-reference Channel.owner with Users.full_name to fill email' })
    async enrichChannelEmails() {
        try {
            const updated = await this.larkService.enrichChannelEmailsFromUsers();
            return { message: `Email enrichment completed: ${updated} channels updated`, updated };
        } catch (error) {
            return { message: 'Email enrichment failed', error: error.message };
        }
    }

    @Post('sync-doda-channel')
    @ApiOperation({ summary: 'Sync Do Da team channels from Lark into Channel table' })
    async syncDoDaChannel() {
        try {
            const result = await this.larkService.syncDoDaChannelData();
            return { message: 'Do Da channel sync completed', ...result };
        } catch (error) {
            return { message: 'Do Da channel sync failed', error: error.message };
        }
    }

    @Post('sync-hr')
    @ApiOperation({ summary: 'Manually trigger HR sync from Lark (User accounts + Permission/Team)' })
    async syncHRData() {
        try {
            const result = await this.larkSyncService.syncFromLark();
            await this.larkService.syncPermissionData();
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
    @Header('Cache-Control', 'private, max-age=60, stale-while-revalidate=120')
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

    @Post('traffic-report')
    @ApiOperation({ summary: 'Submit daily traffic report' })
    async submitTrafficReport(@Body() data: any) {
        return this.larkService.submitTrafficReport(data);
    }

    @Get('debug-traffic-fields')
    @ApiOperation({ summary: 'DEBUG: List all field names in the Traffic Lark table' })
    async debugTrafficFields() {
        return this.larkService.getTrafficTableFields();
    }

    @Post('upload-evidence')
    @ApiOperation({ summary: 'Upload evidence images to Lark Drive and return file tokens' })
    @UseInterceptors(FilesInterceptor('files', 5, {
        limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
    }))
    async uploadEvidence(@UploadedFiles() files: Array<Express.Multer.File>) {
        if (!files || files.length === 0) {
            return { message: 'No files uploaded', fileTokens: [] };
        }

        const fileTokens: string[] = [];
        for (const file of files) {
            const token = await this.larkService.uploadEvidenceToLark(
                file.buffer,
                file.originalname,
                file.mimetype
            );
            fileTokens.push(token);
        }

        return { message: 'Files uploaded successfully', fileTokens };
    }
}
