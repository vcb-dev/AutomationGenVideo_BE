import { IsString, IsNotEmpty, IsOptional, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEditorPerformanceDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  team_id: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  period_id: string;

  @ApiPropertyOptional({ description: 'Editor user ID' })
  @IsString()
  @IsOptional()
  user_id?: string;

  @ApiPropertyOptional({ example: 'Đỗ Thị Nga', description: 'Editor full name' })
  @IsString()
  @IsOptional()
  editor?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  total_videos?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  win_videos?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  analysis?: string;
}

export class UpdateEditorPerformanceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  user_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  editor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  total_videos?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  win_videos?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  analysis?: string;
}
