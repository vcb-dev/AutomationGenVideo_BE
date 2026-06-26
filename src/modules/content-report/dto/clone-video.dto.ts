import { IsString, IsNotEmpty, IsOptional, IsDateString, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCloneVideoDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  team_id: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  period_id: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  editor_id?: string;

  @ApiPropertyOptional({ example: 'Đỗ Thị Nga', description: 'Editor full name' })
  @IsString()
  @IsOptional()
  editor?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  target_channel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  link?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  post_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  views?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  likes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  comments?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  shares?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  analysis?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  highlights?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  improvements?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  leader_comment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  video_url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  order_index?: number;
}

export class UpdateCloneVideoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  editor_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  editor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  target_channel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  link?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  post_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  views?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  likes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  comments?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  shares?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  analysis?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  highlights?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  improvements?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  leader_comment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  video_url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  order_index?: number;
}
