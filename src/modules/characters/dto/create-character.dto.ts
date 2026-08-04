import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsInt, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCharacterDto {
  @ApiProperty({ example: 'HuyK', description: 'Tên hiển thị của nhân vật' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: 'huyk', description: 'Slug ổn định — chỉ chữ thường, số, dấu gạch ngang' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'Slug chỉ được chứa chữ thường, số và dấu gạch ngang (vd: "huyk", "chi-nhan")',
  })
  slug: string;

  @ApiPropertyOptional({ description: 'Mô tả ngắn hiển thị trên UI chọn nhân vật' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'URL ảnh đại diện' })
  @IsOptional()
  @IsString()
  avatar_url?: string;

  // Không @MaxLength — cố ý cho phép độ dài tuỳ ý, không trim/normalize ở bất kỳ đâu.
  @ApiProperty({ description: 'System prompt đầy đủ cho AI — giữ nguyên ký tự tuyệt đối' })
  @IsString()
  @IsNotEmpty()
  system_prompt: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  order_index?: number;
}
