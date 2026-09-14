import {
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { UserRole } from "@prisma/client";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateApiKeyDto {
  @ApiProperty({
    description: 'Nhãn nhận diện hệ thống được cấp key, vd "OMS"',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({
    enum: UserRole,
    isArray: true,
    description: "Quyền cấp cho tài khoản dịch vụ của key. Mặc định [ADMIN].",
  })
  @IsOptional()
  @IsArray()
  @IsEnum(UserRole, { each: true })
  roles?: UserRole[];

  @ApiPropertyOptional({
    description: "Thời điểm hết hạn (ISO-8601). Bỏ trống = không hết hạn.",
    example: "2026-12-31T23:59:59.000Z",
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
