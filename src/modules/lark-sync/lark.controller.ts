

import { Controller, Get, Post, Query, Param, Res, Body, UploadedFiles, UseInterceptors, Header, Logger } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { LarkService } from './lark.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Lark Report')
@Controller('lark')
@SkipThrottle({ long: true, short: true })
export class LarkController {
    private readonly logger = new Logger(LarkController.name);

    constructor(
        private readonly larkService: LarkService,
        private readonly prisma: PrismaService,
    ) { }

    @Get('report')
    @ApiOperation({ summary: 'Get daily report from Database' })
    @ApiResponse({ status: 200, description: 'Returns list of user reports from PostgreSQL.' })
    async getReport() {
        return this.larkService.getReportData();
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

    @Get('employee')
    @ApiOperation({ summary: 'Get employee data from Database' })
    @ApiResponse({ status: 200, description: 'Returns list of employees from PostgreSQL.' })
    async getEmployees() {
        return this.larkService.getEmployeeData();
    }

    @Get('kpi')
    @ApiOperation({ summary: 'Get KPI data from Database with pagination' })
    @ApiResponse({ status: 200, description: 'Returns paginated KPI data from PostgreSQL.' })
    async getKPI(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
        const pageNum = Math.max(1, parseInt(page || '1', 10));
        const size = Math.min(100, Math.max(10, parseInt(pageSize || '50', 10)));
        return this.larkService.getKPIData(pageNum, size);
    }

    @Get('kpi-do-da')
    @ApiOperation({ summary: 'Get KPI Đồ Da data from Database' })
    @ApiResponse({ status: 200, description: 'Returns KPI Đồ Da rows from PostgreSQL (table depends on configured KPI Đồ Da source).' })
    async getKPIDoDa() {
        return this.larkService.getKPIDoDaData();
    }

    @Get('user-activity')
    @Header('Cache-Control', 'private, max-age=120, stale-while-revalidate=300')
    @ApiOperation({ summary: 'Get combined user activity reports (ChecklistReport + Kpi)' })
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

        const result = await this.larkService.getUserActivityReports(filters);

        // Enrich DoDa avatars from users.image_url (post-cache, guaranteed fresh)
        const teamKey = (team || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0111/g, 'd').replace(/\s+/g, '');
        if (teamKey === 'doda' && result?.reports?.length) {
            const normName = (v: string) =>
                String(v || '').toLowerCase().normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '').replace(/\u0111/g, 'd')
                    .trim().replace(/\s+/g, ' ');

            const users = await this.prisma.user.findMany({
                where: { is_active: true, image_url: { not: null } },
                select: { email: true, full_name: true, image_url: true },
            });
            const avByName = new Map<string, string>();
            const avByEmail = new Map<string, string>();
            for (const u of users) {
                const nk = normName(u.full_name || '');
                if (nk && u.image_url) avByName.set(nk, u.image_url);
                if (u.email && u.image_url) avByEmail.set(u.email.toLowerCase().trim(), u.image_url);
            }

            for (const r of result.reports) {
                const nk = normName(r.name || '');
                const ek = String(r.email || '').toLowerCase().trim();
                const raw = (ek ? avByEmail.get(ek) : null) || (nk ? avByName.get(nk) : null) || null;
                if (raw) {
                    const converted = this.larkService.convertDriveUrl(raw);
                    if (converted) {
                        r.avatar = converted;
                        r.image_url = converted;
                    }
                }
            }
            this.logger.log(`[DoDa-Avatar] Enriched ${result.reports.length} reports with users.image_url`);
        }

        return result;
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

    @Post('checklist-report')
    @ApiOperation({ summary: 'Submit daily checklist report (replaces Django AI endpoint)' })
    async submitChecklistReport(@Body() data: any) {
        try {
            const result = await this.larkService.submitChecklistReport(data);
            return result;
        } catch (error) {
            this.logger.error(`[checklist-report] Failed: ${error?.message}`, error?.stack);
            return { success: false, message: error?.message || 'Lỗi gửi báo cáo', error: error?.message };
        }
    }

    @Post('traffic-report')
    @ApiOperation({ summary: 'Submit daily traffic report' })
    async submitTrafficReport(@Body() data: any) {
        return this.larkService.submitTrafficReport(data);
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
