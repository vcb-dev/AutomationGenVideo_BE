import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UserRole } from '@prisma/client';
import { UpdateRolePermissionDto } from './dto/update-role-permission.dto';

@Injectable()
export class RolePermissionsService {
    constructor(private prisma: PrismaService) { }

    async findAll() {
        return this.prisma.rolePermission.findMany({
            orderBy: { role: 'asc' },
        });
    }

    async findByRole(role: UserRole) {
        return this.prisma.rolePermission.findUnique({
            where: { role },
        });
    }

    async update(updateDto: UpdateRolePermissionDto) {
        const { role, menu_ids } = updateDto;
        return this.prisma.rolePermission.upsert({
            where: { role },
            update: { menu_ids },
            create: { role, menu_ids },
        });
    }

    async getUserPermissions(userId: string) {
        return this.prisma.user.findUnique({
            where: { id: userId },
            select: { roles: true, custom_permissions: true },
        });
    }

    /**
     * Get all menu IDs for a user based on their roles and custom overrides
     */
    async getPermissionsForUser(roles: UserRole[], customPermissions: string[] = []) {
        if ((!roles || roles.length === 0) && (!customPermissions || customPermissions.length === 0)) {
            return [];
        }

        const rolePermissions = roles.length > 0
            ? await this.prisma.rolePermission.findMany({
                where: {
                    role: { in: roles },
                },
            })
            : [];

        // Merge all menu_ids from roles
        const roleMenuIds = rolePermissions.flatMap((p) => p.menu_ids);

        // Combine with custom permissions and remove duplicates
        const allMenuIds = [...roleMenuIds, ...customPermissions];
        return Array.from(new Set(allMenuIds));
    }
}
