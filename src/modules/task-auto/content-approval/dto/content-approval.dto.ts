import { Type } from 'class-transformer'
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class ReviewContentApprovalDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsEnum(['APPROVED', 'REJECTED'])
  action: 'APPROVED' | 'REJECTED'

  @ApiPropertyOptional() @IsString() @IsOptional() reject_reason?: string
}

export class QueryContentApprovalDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  @IsOptional()
  status?: 'PENDING' | 'APPROVED' | 'REJECTED'

  @ApiPropertyOptional() @IsString() @IsOptional() team_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() assignee_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() search?: string
  // Bộ lọc chung màn Nhiệm vụ: tuyến / dòng SP của task + khoảng ngày GỬI yêu cầu duyệt (YYYY-MM-DD, giờ VN)
  @ApiPropertyOptional() @IsString() @IsOptional() content_line_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() product_line_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() date_from?: string
  @ApiPropertyOptional() @IsString() @IsOptional() date_to?: string

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1

  @ApiPropertyOptional({ default: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 10
}
