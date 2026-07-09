import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateVideoScoreDto {
  @ApiProperty({ example: 8.5, description: 'Điểm Hook (1-10)' })
  @IsNumber()
  @Min(1)
  @Max(10)
  score_hook: number;

  @ApiProperty({ example: 8.0, description: 'Điểm Content (1-10)' })
  @IsNumber()
  @Min(1)
  @Max(10)
  score_content: number;

  @ApiProperty({ example: 9.0, description: 'Điểm Editing (1-10)' })
  @IsNumber()
  @Min(1)
  @Max(10)
  score_editing: number;

  @ApiProperty({ example: 7.5, description: 'Điểm CTA (1-10)' })
  @IsNumber()
  @Min(1)
  @Max(10)
  score_cta: number;

  @ApiProperty({ example: 8.5, description: 'Điểm Thumbnail (1-10)' })
  @IsNumber()
  @Min(1)
  @Max(10)
  score_thumbnail: number;

  @ApiProperty({ example: 'Video edit mượt, content cuốn hút', description: 'Nhận xét/Góp ý', required: false })
  @IsString()
  @IsOptional()
  comment?: string;
}
