import { IsString, Matches } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class KpiPayrollSyncQueryDto {
  @ApiProperty({ example: "2026-09", description: "Tháng cần lấy KPI, định dạng YYYY-MM" })
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: "month phải có dạng YYYY-MM" })
  month: string;
}
