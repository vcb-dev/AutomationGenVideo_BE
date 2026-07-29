import { IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GetPagesQueryDto {
  @ApiPropertyOptional({ description: 'Buộc làm mới cache' })
  @IsOptional()
  @IsBoolean()
  refresh?: boolean;
}
