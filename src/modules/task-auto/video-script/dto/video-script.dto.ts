import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class GenerateVideoScriptDto {
  @ApiPropertyOptional() @IsString() @IsOptional() fileUrl?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() scriptText?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() contentTitle?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() contentLine?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() contentMarket?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() productName?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() productSku?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() productPrice?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() productMaterial?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() productPriceSegment?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() productLine?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() productMarket?: string | null
  @ApiPropertyOptional() @IsBoolean() @IsOptional() force?: boolean
}

export class UpdateVideoScriptTranslationDto {
  @ApiProperty() @IsString() content: string
  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  hashtags?: string[]
}

export class UpdateVideoScriptDto {
  @ApiProperty() @IsString() content: string
  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  hashtags?: string[]

  @ApiPropertyOptional({ type: UpdateVideoScriptTranslationDto })
  @ValidateNested()
  @Type(() => UpdateVideoScriptTranslationDto)
  @IsOptional()
  translation?: UpdateVideoScriptTranslationDto
}

export class TranslateVideoScriptDto {
  @ApiPropertyOptional({
    description:
      "Thị trường mục tiêu (vd 'Indonesia') — dùng để AI tự xác định ngôn ngữ khi task chưa từng có bản dịch nào",
  })
  @IsString()
  @IsOptional()
  market?: string | null
}
