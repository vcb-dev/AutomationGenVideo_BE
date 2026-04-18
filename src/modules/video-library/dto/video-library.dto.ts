import { IsString, IsOptional, IsNotEmpty, IsNumber, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CollectionType } from '@prisma/client';

export class SaveToLibraryDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    video_id: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    platform: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    title: string;

    @ApiPropertyOptional()
    @IsString()
    @IsOptional()
    description?: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    video_url: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    author_username: string;

    @ApiPropertyOptional()
    @IsString()
    @IsOptional()
    author_name?: string;

    @ApiPropertyOptional()
    @IsString()
    @IsOptional()
    thumbnail_url?: string;

    @ApiPropertyOptional()
    @IsNumber()
    @IsOptional()
    views_count?: number;

    @ApiPropertyOptional()
    @IsNumber()
    @IsOptional()
    likes_count?: number;

    @ApiPropertyOptional()
    @IsNumber()
    @IsOptional()
    comments_count?: number;

    @ApiPropertyOptional()
    @IsNumber()
    @IsOptional()
    shares_count?: number;

    @ApiPropertyOptional()
    @IsString()
    @IsOptional()
    notes?: string;

    @ApiPropertyOptional({ description: 'URL to the Sourcing Content page' })
    @IsString()
    @IsOptional()
    sourcing_url?: string;
}
