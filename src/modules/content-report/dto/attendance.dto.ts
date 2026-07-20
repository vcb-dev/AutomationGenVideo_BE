import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  IsArray,
  ValidateNested,
  IsNotEmpty,
  ValidateIf,
  IsInt,
  Min,
  Max,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AttendanceStatus } from '@prisma/client';

// ─────────────────────────────────────────────
// Meeting Session
// ─────────────────────────────────────────────

export class CreateMeetingSessionDto {
  @ApiProperty({ example: 'K1', description: 'Tên team (K1–K5)' })
  @IsString()
  team: string;

  @ApiProperty({ description: 'ID của ReportPeriod (type = WEEK)' })
  @IsString()
  period_id: string;

  @ApiProperty({
    example: 'Họp tuần 1 - T7/2026',
    description: 'Tiêu đề buổi họp (optional)',
    required: false,
  })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({
    example: '2026-07-07T09:00:00.000Z',
    description: 'Mốc giờ họp — chỉ để hiển thị/tham khảo, không tự tính LATE',
  })
  @IsDateString()
  scheduled_at: string;

  @ApiProperty({ description: 'Ghi chú buổi họp', required: false })
  @IsString()
  @IsOptional()
  notes?: string;
}

// ─────────────────────────────────────────────
// Single Attendance (self check-in + manager patch single)
// Note: user_id KHÔNG có trong DTO này.
//   - Self check-in: lấy từ req.user.id (JWT)
//   - Manager single: lấy từ route param :userId
// ─────────────────────────────────────────────

export class UpsertAttendanceDto {
  @ApiProperty({
    enum: ['PRESENT', 'ABSENT'],
    example: AttendanceStatus.PRESENT,
    description: 'Trạng thái điểm danh — chỉ cho phép PRESENT hoặc ABSENT',
  })
  @IsIn(['PRESENT', 'ABSENT'], { message: 'Trạng thái điểm danh phải là PRESENT hoặc ABSENT' })
  status: AttendanceStatus;

  @ApiProperty({
    description:
      'Ghi chú / lý do. Optional khi ABSENT (có thể bổ sung sau).',
    required: false,
    example: 'Nghỉ ốm có lý do',
  })
  @IsOptional()
  @IsString()
  note?: string;
}

// ─────────────────────────────────────────────
// Bulk Attendance (Manager bulk update)
// ─────────────────────────────────────────────

export class BulkAttendanceItemDto {
  @ApiProperty({ description: 'ID của thành viên cần điểm danh' })
  @IsString()
  user_id: string;

  @ApiProperty({
    enum: ['PRESENT', 'ABSENT'],
    example: AttendanceStatus.PRESENT,
  })
  @IsIn(['PRESENT', 'ABSENT'], { message: 'Trạng thái điểm danh phải là PRESENT hoặc ABSENT' })
  status: AttendanceStatus;

  @ApiProperty({ required: false, description: 'Ghi chú / lý do' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class BulkAttendanceDto {
  @ApiProperty({ type: [BulkAttendanceItemDto], description: 'Mảng điểm danh nhiều người' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkAttendanceItemDto)
  records: BulkAttendanceItemDto[];
}

// ─────────────────────────────────────────────
// Attendance History (read-only queries)
// ─────────────────────────────────────────────

export class AttendanceHistoryQueryDto {
  @ApiProperty({ example: 'K1', description: 'Tên team' })
  @IsString()
  team: string;

  @ApiProperty({ example: 7, description: 'Tháng (1–12)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiProperty({ example: 2026, description: 'Năm (4 chữ số)' })
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  year: number;
}

export class UserHistoryQueryDto {
  @ApiProperty({ example: 7, description: 'Tháng (1–12)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiProperty({ example: 2026, description: 'Năm (4 chữ số)' })
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  year: number;
}
