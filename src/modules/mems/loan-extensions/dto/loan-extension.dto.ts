import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RequestExtensionDto {
  @ApiProperty({ description: 'Hạn trả mới, phải sau hạn trả hiện tại' })
  @IsISO8601()
  toTime: string;

  @ApiProperty({ description: 'Lý do xin gia hạn' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class DecideExtensionDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'])
  decision: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({ description: 'Bắt buộc khi từ chối' })
  @IsOptional()
  @IsString()
  reason?: string;
}
