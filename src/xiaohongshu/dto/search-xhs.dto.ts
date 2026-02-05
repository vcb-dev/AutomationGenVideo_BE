import { IsNotEmpty, IsString, IsOptional, IsNumber, Min, Max, IsEnum } from 'class-validator';

export class XhsSearchDto {
  @IsNotEmpty()
  @IsString()
  searchTerm: string;

  @IsOptional()
  @IsString()
  @IsEnum(['general', 'hot', 'latest'])
  sortType?: 'general' | 'hot' | 'latest' = 'general';

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  maxPosts?: number = 20;
}

export interface XhsNote {
  note_id: string;
  type: string;
  title: string;
  desc: string;
  likes_count: number;
  author_name: string;
  cover_url: string;
  note_url: string;
  // ... other fields matching Python service output
}

export interface XhsSearchResponse {
  success: boolean;
  data: {
    notes: XhsNote[];
    total: number;
    has_more: boolean;
  };
}
