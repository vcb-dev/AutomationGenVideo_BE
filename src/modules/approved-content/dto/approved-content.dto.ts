import { IsString, IsOptional, IsNotEmpty, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateApprovedContentDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    script: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    content_type: string;

    @ApiPropertyOptional()
    @IsString()
    @IsOptional()
    content_type_display?: string;

    @ApiPropertyOptional()
    @IsNumber()
    @IsOptional()
    word_count?: number;

    @ApiPropertyOptional()
    @IsString()
    @IsOptional()
    source_video_id?: string;

    @ApiPropertyOptional()
    @IsString()
    @IsOptional()
    source_video_title?: string;

    @ApiPropertyOptional()
    @IsString()
    @IsOptional()
    source_video_desc?: string;

    @ApiPropertyOptional()
    @IsString()
    @IsOptional()
    source_video_url?: string;

    @ApiPropertyOptional()
    @IsString()
    @IsOptional()
    product_id?: string;

    @ApiPropertyOptional()
    @IsString()
    @IsOptional()
    product_name?: string;

    @ApiPropertyOptional()
    @IsString()
    @IsOptional()
    product_category?: string;

    @ApiPropertyOptional()
    @IsString()
    @IsOptional()
    product_sku?: string;
}
