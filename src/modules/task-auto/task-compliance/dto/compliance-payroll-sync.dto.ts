import { Type } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const DATE_ONLY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;

export const PAYROLL_GROUP_BY = ["line", "person_day"] as const;
export type PayrollGroupBy = (typeof PAYROLL_GROUP_BY)[number];

export class TaskCompliancePayrollSyncQueryDto {
  @ApiProperty({
    example: "2026-09-01",
    description: "Ngày bắt đầu, YYYY-MM-DD (giờ Việt Nam)",
  })
  @IsDateString({ strict: true }, { message: "from phải là ngày hợp lệ" })
  @Matches(DATE_ONLY_PATTERN, { message: "from phải có dạng YYYY-MM-DD" })
  from: string;

  @ApiProperty({
    example: "2026-09-30",
    description: "Ngày kết thúc, YYYY-MM-DD (giờ Việt Nam)",
  })
  @IsDateString({ strict: true }, { message: "to phải là ngày hợp lệ" })
  @Matches(DATE_ONLY_PATTERN, { message: "to phải có dạng YYYY-MM-DD" })
  to: string;

  @ApiPropertyOptional({ description: "User ID bên AutomationGenVideo" })
  @IsUUID("4", { message: "user_id phải là UUID hợp lệ" })
  @IsOptional()
  user_id?: string;

  @ApiPropertyOptional({
    enum: PAYROLL_GROUP_BY,
    default: "line",
    description:
      "line: mỗi record một tuyến thiếu, phân trang theo tuyến (như 1.0). person_day: phân trang theo người × ngày giống màn Nhiệm vụ còn thiếu, trả thêm days[]",
  })
  @IsIn(PAYROLL_GROUP_BY, { message: "group_by phải là line hoặc person_day" })
  @IsOptional()
  group_by?: PayrollGroupBy = "line";

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
