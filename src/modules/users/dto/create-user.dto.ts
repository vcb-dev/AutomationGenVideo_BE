import {
  IsEmail,
  IsString,
  IsEnum,
  IsOptional,
  IsBoolean,
  MinLength,
  IsArray,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";

export class CreateUserDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  email: string;

  @ApiProperty({ example: "Password123!" })
  @IsString()
  @MinLength(8)
  @IsOptional()
  password?: string;

  @ApiProperty({ example: "John Doe" })
  @IsString()
  full_name: string;

  @ApiPropertyOptional({ enum: UserRole, example: UserRole.MEMBER, description: "Single role (backward compatible)" })
  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @ApiPropertyOptional({ enum: UserRole, isArray: true, example: [UserRole.MEMBER], description: "Multiple roles" })
  @IsArray()
  @IsEnum(UserRole, { each: true })
  @IsOptional()
  roles?: UserRole[];

  @ApiPropertyOptional({ example: "uuid-of-manager" })
  @IsOptional()
  @IsString()
  manager_id?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ example: "google-id-123" })
  @IsOptional()
  @IsString()
  google_id?: string;

  @ApiPropertyOptional({ example: "https://..." })
  @IsOptional()
  @IsString()
  image_url?: string;

  @ApiPropertyOptional({ example: "Team A,Team B", description: "Tên (các) team, phân cách dấu phẩy — hệ thống gán qua Team/TeamMember, không ghi thẳng vào User.team" })
  @IsOptional()
  @IsString()
  team?: string;

  @ApiPropertyOptional({ type: [String], example: ['performance', 'dashboard'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  custom_permissions?: string[];
}
