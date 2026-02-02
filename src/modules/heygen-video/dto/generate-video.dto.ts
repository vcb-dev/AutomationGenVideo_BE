import { IsString, IsOptional, IsIn } from 'class-validator';

export class GenerateVideoDto {
  @IsString()
  text: string;

  @IsOptional()
  @IsString()
  avatar_id?: string;

  @IsOptional()
  @IsString()
  voice_id?: string;

  @IsOptional()
  @IsIn(['16:9', '9:16', '1:1'])
  aspect_ratio?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'ultra'])
  quality?: string;

  @IsOptional()
  @IsString()
  background_color?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  avatar_style?: string;
}
