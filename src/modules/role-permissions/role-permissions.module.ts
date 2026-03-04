import { Module } from '@nestjs/common';
import { RolePermissionsService } from './role-permissions.service';
import { RolePermissionsController } from './role-permissions.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [RolePermissionsController],
    providers: [RolePermissionsService],
    exports: [RolePermissionsService],
})
export class RolePermissionsModule { }
