import { IsString, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpgradeTransformDto {
  @ApiPropertyOptional({ description: 'ID bản ghi lịch sử cần sửa nâng cấp (ưu tiên dùng nếu có)' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  history_id?: string;

  // Dùng khi không truyền history_id — phải kèm đủ 3 field dưới đây.
  @ApiPropertyOptional({ description: 'Kịch bản thô gốc (bắt buộc nếu không dùng history_id)' })
  @IsOptional()
  @IsString()
  input_text?: string;

  @ApiPropertyOptional({ description: 'Character ID hoặc slug (bắt buộc nếu không dùng history_id)' })
  @IsOptional()
  @IsString()
  character_id?: string;

  @ApiPropertyOptional({ description: 'Kịch bản kết quả hiện tại cần sửa (bắt buộc nếu không dùng history_id)' })
  @IsOptional()
  @IsString()
  output_text?: string;
}
