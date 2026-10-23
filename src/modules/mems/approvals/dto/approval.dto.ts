import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ApproveRequestDto {
  @ApiPropertyOptional({ description: 'Ghi chú của người duyệt, không bắt buộc' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class RejectRequestDto {
  @ApiProperty({ description: 'BR-20: từ chối bắt buộc nêu lý do' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
