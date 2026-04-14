import {
    Controller,
    Get,
    Post,
    Body,
    UseGuards,
    Request,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RolePermissionsService } from './role-permissions.service';
import { UpdateRolePermissionDto } from './dto/update-role-permission.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('role-permissions')
@Controller('role-permissions')
@SkipThrottle({ long: true, short: true })
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
        // Use roles/custom_permissions already on the JWT-validated user object
        // to avoid an extra DB round-trip on every page navigation.
        const jwtUser = req.user;
        if (!jwtUser) return [];
        const roles = jwtUser.roles ?? [];
        const custom = jwtUser.custom_permissions ?? [];
        return this.service.getPermissionsForUser(roles, custom);
    }
}
