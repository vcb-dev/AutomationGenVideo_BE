import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { UserRole } from '@prisma/client';
import { UpdateRolePermissionDto } from './dto/update-role-permission.dto';

@Injectable()
export class RolePermissionsService {
    constructor(
        private prisma: PrismaService,
        private cacheService: CacheService,
    ) { }

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
        this.cacheService.invalidate('role-perm:');
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

    async getPermissionsForUser(roles: UserRole[], customPermissions: string[] = []) {
        if ((!roles || roles.length === 0) && (!customPermissions || customPermissions.length === 0)) {
            return [];
        }

        const rolesKey = roles.sort().join(',');
        const customKey = customPermissions.sort().join(',');
        const cacheKey = `role-perm:${rolesKey}:${customKey}`;

        return this.cacheService.get(cacheKey, 5 * 60 * 1000, async () => {
            const rolePermissions = roles.length > 0
                ? await this.prisma.rolePermission.findMany({
                    where: { role: { in: roles } },
                })
                : [];

            const roleMenuIds = rolePermissions.flatMap((p) => p.menu_ids);
            const allMenuIds = [...roleMenuIds, ...customPermissions];
            return Array.from(new Set(allMenuIds));
        });
    }
}
