import { IsString, IsOptional, IsUUID, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UploadVideoDto {
  @ApiPropertyOptional({ description: 'Video title' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Video description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Channel ID where video will be posted' })
  @IsUUID()
  channelId: string;
}

export class CheckDuplicateResponseDto {
  @ApiProperty()
  isDuplicate: boolean;

  @ApiProperty({ required: false })
  matchedVideo?: {
    id: string;
    title: string;
    createdAt: Date;
    platforms: string[];
  };

  @ApiProperty()
  similarity: number;

  @ApiProperty()
  confidence: 'high' | 'medium' | 'low';

  @ApiProperty()
  needsReview: boolean;
}



export class MarkAsPublishedDto {
  @ApiProperty({ description: 'Video ID' })
  @IsUUID()
  videoId: string;

  @ApiProperty({ description: 'Platforms where video was published', type: [String] })
  @IsString({ each: true })
  platforms: string[];

  @ApiPropertyOptional({ description: 'Published date' })
  @IsOptional()
  publishedAt?: Date;
}
