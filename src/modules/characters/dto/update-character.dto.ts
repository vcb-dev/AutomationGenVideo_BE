import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsInt, Matches, MaxLength, IsISO8601 } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCharacterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'Slug — chỉ chữ thường, số, dấu gạch ngang' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'Slug chỉ được chứa chữ thường, số và dấu gạch ngang (vd: "huyk", "chi-nhan")',
  })
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatar_url?: string;

  // Không @MaxLength — cố ý cho phép độ dài tuỳ ý, không trim/normalize ở bất kỳ đâu.
  @ApiPropertyOptional({ description: 'System prompt — nếu có gửi field này (kể cả rỗng), bản CŨ sẽ được lưu vào lịch sử trước khi ghi đè' })
  @IsOptional()
  @IsString()
  system_prompt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  order_index?: number;

  // Chống 2 người sửa đè nhau: client BẮT BUỘC gửi lại đúng updated_at đã tải lúc mở form/list.
  // Nếu lệch với bản mới nhất trong DB (người khác vừa sửa), từ chối ghi đè.
  @ApiProperty({ description: 'updated_at của bản ghi lúc client tải lên — dùng để phát hiện xung đột ghi đè' })
  @IsISO8601()
  @IsNotEmpty()
  updated_at: string;
}
