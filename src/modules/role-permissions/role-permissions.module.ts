import { Module } from '@nestjs/common';
import { RolePermissionsService } from './role-permissions.service';
import { RolePermissionsController } from './role-permissions.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CacheModule } from '../../common/cache/cache.module';

@Module({
    imports: [PrismaModule, CacheModule],
    controllers: [RolePermissionsController],
    providers: [RolePermissionsService],
    exports: [RolePermissionsService],
})
export class RolePermissionsModule { }
