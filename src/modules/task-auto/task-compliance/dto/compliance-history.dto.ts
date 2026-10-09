import { Type } from "class-transformer";
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const DATE_ONLY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;

export class QueryComplianceHistoryDto {
  @ApiPropertyOptional({ description: "Từ ngày làm việc, YYYY-MM-DD" })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: "Đến ngày làm việc, YYYY-MM-DD" })
  @IsDateString()
  @IsOptional()
  to?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  team_id?: string;

  @ApiPropertyOptional({ description: "Admin/Manager mới được lọc tùy ý; Leader chỉ lọc người trong team mình" })
  @IsString()
  @IsOptional()
  user_id?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit = 20;
}

export class QueryComplianceDayDto {
  @ApiProperty({ example: "2026-09-30", description: "Ngày làm việc, YYYY-MM-DD (giờ Việt Nam)" })
  @IsDateString({ strict: true }, { message: "date phải là ngày hợp lệ" })
  @Matches(DATE_ONLY_PATTERN, { message: "date phải có dạng YYYY-MM-DD" })
  date: string;

  @ApiPropertyOptional({ description: "Bỏ trống = chính mình; Member chỉ xem được của mình" })
  @IsString()
  @IsOptional()
  user_id?: string;

  @ApiPropertyOptional({ description: "Giữ đúng bộ lọc team của danh sách" })
  @IsString()
  @IsOptional()
  team_id?: string;
}
