import { IsString, IsOptional, IsInt, Min, Max, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MixVideoAutoDto {
  @ApiProperty({
    description: 'Base folder path containing subfolders with videos',
    example: 'D:\\Videos\\MixContent'
  })
  @IsString()
  @IsNotEmpty()
  base_folder_path: string;

  @ApiPropertyOptional({
    description: 'Number of output videos to generate',
    example: 5,
    minimum: 1,
    maximum: 100
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  num_outputs?: number;

  @ApiPropertyOptional({
    description: 'Output video width',
    example: 720,
    minimum: 360,
    maximum: 4096
  })
  @IsOptional()
  @IsInt()
  @Min(360)
  @Max(4096)
  width?: number;

  @ApiPropertyOptional({
    description: 'Output video height',
    example: 1280,
    minimum: 360,
    maximum: 4096
  })
  @IsOptional()
  @IsInt()
  @Min(360)
  @Max(4096)
  height?: number;

  @ApiPropertyOptional({
    description: 'Minimum videos required per folder',
    example: 1,
    minimum: 1
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  min_videos_per_folder?: number;
}
