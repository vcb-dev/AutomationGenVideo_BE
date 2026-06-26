import { IsString, IsNotEmpty, IsOptional, IsDateString, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCaseStudyDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  team_id: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  period_id: string;

  @ApiPropertyOptional({ description: 'User ID of creator' })
  @IsString()
  @IsOptional()
  created_by?: string;

  @ApiPropertyOptional({ description: 'Full name of creator' })
  @IsString()
  @IsOptional()
  creator_name?: string;

  @ApiProperty({ example: 'Review dán màn hình cường lực...' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  takeaway?: string;

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
  order_index?: number;
}

export class UpdateCaseStudyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  takeaway?: string;

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
  order_index?: number;
}
