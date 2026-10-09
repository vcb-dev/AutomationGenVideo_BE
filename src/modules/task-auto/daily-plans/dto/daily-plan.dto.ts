import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateIf } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { MAX_QUICK_CREATE } from '../types'
import { SEARCH_MARKETS, SearchMarket } from '../steps/system-search'

/** Không truyền gì = hôm nay; `date` = đúng 1 ngày; `from`/`to` = khoảng (thiếu đầu nào thì không giới hạn đầu đó); `all` = mọi ngày. */
export class MyDailyPlansQueryDto {
  @ApiPropertyOptional({ description: 'Ngày kế hoạch YYYY-MM-DD (giờ VN) — thắng from/to' })
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string

  @ApiPropertyOptional({ description: 'Từ ngày YYYY-MM-DD (giờ VN) — khoảng nhiều ngày thì cộng dồn theo tuyến' })
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string

  @ApiPropertyOptional({ description: 'Đến ngày YYYY-MM-DD (giờ VN), tính cả ngày này' })
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string

  @ApiPropertyOptional({ enum: ['true'], description: 'Mọi ngày có kế hoạch (bộ lọc "Tất cả ngày")' })
  @IsOptional() @IsIn(['true']) all?: 'true'
}

export class QuickCreateFromPlanDto {
  @ApiProperty({ type: [String], description: `Id gợi ý của Kế hoạch ngày (tối đa ${MAX_QUICK_CREATE})` })
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(MAX_QUICK_CREATE) @IsString({ each: true }) suggestion_ids: string[]
}

export const PLAN_SEARCH_KINDS = ['content', 'video'] as const
export type PlanSearchKind = (typeof PLAN_SEARCH_KINDS)[number]

export class PlanSearchQueryDto {
  @ApiProperty({ enum: PLAN_SEARCH_KINDS, description: 'content = content trong kho (cá nhân/team/tổng), video = video win Facebook' })
  @IsIn(PLAN_SEARCH_KINDS) kind: PlanSearchKind

  @ApiPropertyOptional({ description: 'Từ khoá — tiêu đề/mã content hoặc caption video (không phân biệt dấu)' })
  @IsOptional() @IsString() @MaxLength(200) q?: string

  @ApiPropertyOptional({ description: 'Id tuyến nội dung; "all" = mọi tuyến; bỏ trống = tuyến của kế hoạch' })
  @IsOptional() @IsString() line?: string

  @ApiPropertyOptional({ enum: SEARCH_MARKETS, description: 'vn = Việt Nam, global = thị trường nước ngoài, all = mọi thị trường; bỏ trống = theo thị trường của team' })
  @IsOptional() @IsIn(SEARCH_MARKETS) market?: SearchMarket

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
}

export class QuickCreateFromSearchDto {
  @ApiProperty({ enum: ['CONTENT', 'WIN_VIDEO'] })
  @IsIn(['CONTENT', 'WIN_VIDEO']) kind: 'CONTENT' | 'WIN_VIDEO'

  @ApiPropertyOptional({ enum: ['editor', 'team', 'global'], description: 'Kho của content (kind=CONTENT)' })
  @ValidateIf(o => o.kind === 'CONTENT') @IsIn(['editor', 'team', 'global']) source?: 'editor' | 'team' | 'global'

  @ApiPropertyOptional({ description: 'Id content trong kho đó (kind=CONTENT)' })
  @ValidateIf(o => o.kind === 'CONTENT') @IsString() content_id?: string

  @ApiPropertyOptional({ description: 'post_id video Facebook (kind=WIN_VIDEO) — BE tự tra caption/link' })
  @ValidateIf(o => o.kind === 'WIN_VIDEO') @IsString() post_id?: string
}
