import { IsEnum, IsArray, IsString } from 'class-validator';
import { UserRole } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateRolePermissionDto {
    @ApiProperty({ enum: UserRole })
    @IsEnum(UserRole)
    role: UserRole;

    @ApiProperty({ type: [String] })
    @IsArray()
    @IsString({ each: true })
    menu_ids: string[];
}
