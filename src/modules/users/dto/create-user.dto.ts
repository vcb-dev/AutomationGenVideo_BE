import {
  IsEmail,
  IsString,
  IsEnum,
  IsOptional,
  IsBoolean,
  MinLength,
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
  @IsOptional() // Make password optional for Google users
  password?: string;

  @ApiProperty({ example: "John Doe" })
  @IsString()
  full_name: string;

  @ApiProperty({ enum: UserRole, example: UserRole.EDITOR })
  @IsEnum(UserRole)
  role: UserRole;

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

  @ApiPropertyOptional({ example: "https://avatar.url" })
  @IsOptional()
  @IsString()
  avatar?: string;
}
