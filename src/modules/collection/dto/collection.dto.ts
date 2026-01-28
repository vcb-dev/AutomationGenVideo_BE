import { IsString, IsOptional, IsNotEmpty, IsHexColor, IsArray, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCollectionDto {
  @ApiProperty({ description: 'Name of the collection' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Description of the collection' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Color code for the label (e.g. #FF0000)' })
  @IsString()
  @IsOptional()
  @IsHexColor()
  color?: string;
}

export class AddVideosToCollectionDto {
  @ApiProperty({ description: 'List of video IDs to add', type: [Number] })
  @IsArray()
  @IsNumber({}, { each: true })
  video_ids: number[];
}
