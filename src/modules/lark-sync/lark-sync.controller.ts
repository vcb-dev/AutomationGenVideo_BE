import {
    Controller,
    Get,
    Post,
    UseGuards,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiBearerAuth,
} from '@nestjs/swagger';
import { LarkSyncService } from './lark-sync.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('lark-sync')
@Controller('lark-sync')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class LarkSyncController {
    constructor(private readonly larkSyncService: LarkSyncService) { }

    @Post('sync')
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Sync HR data from Lark Base to local DB (Admin only)' })
    @ApiResponse({
        status: 200,
        description: 'Sync completed successfully',
    })
    async syncFromLark() {
        return this.larkSyncService.syncFromLark();
    }

    @Get('status')
    @Roles(UserRole.ADMIN, UserRole.MANAGER)
    @ApiOperation({ summary: 'Get sync status - compare Lark vs local DB' })
    @ApiResponse({
        status: 200,
        description: 'Sync status retrieved',
    })
    async getSyncStatus() {
        return this.larkSyncService.getSyncStatus();
    }
}
