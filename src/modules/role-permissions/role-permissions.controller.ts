import {
    Controller,
    Get,
    Post,
    Body,
    UseGuards,
    Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RolePermissionsService } from './role-permissions.service';
import { UpdateRolePermissionDto } from './dto/update-role-permission.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('role-permissions')
@Controller('role-permissions')
@ApiBearerAuth()
export class RolePermissionsController {
    constructor(private readonly service: RolePermissionsService) { }

    @Get()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Get all role permissions (Admin only)' })
    findAll() {
        return this.service.findAll();
    }

    @Post()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Update permissions for a role (Admin only)' })
    update(@Body() updateDto: UpdateRolePermissionDto) {
        return this.service.update(updateDto);
    }

    @Get('my-tabs')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get allowed tabs for current user' })
    async getMyTabs(@Request() req) {
        const user = await this.service.getUserPermissions(req.user.id);
        if (!user) return [];
        return this.service.getPermissionsForUser(user.roles, user.custom_permissions);
    }
}
