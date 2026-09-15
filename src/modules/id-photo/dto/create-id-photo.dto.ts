import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IdPhotoPosition } from '@prisma/client';

export class CreateIdPhotoDto {
  @ApiProperty({
    description:
      'uploadId đã gọi qua POST /id-photo/merge-outfit thành công (bắt buộc phải có ảnh đã ' +
      'ghép áo trong bộ nhớ tạm, xem IdPhotoService).',
  })
  @IsString()
  @IsNotEmpty()
  uploadId: string;

  @ApiProperty({ example: 'Nguyễn Văn A' })
  @IsString()
  @IsNotEmpty()
  employeeName: string;

  @ApiProperty({ example: 'Team Content Việt Nam' })
  @IsString()
  @IsNotEmpty()
  employeeTeam: string;

  @ApiProperty({ example: 'NV-00123' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  // [ĐÃ NGỪNG DÙNG từ 2026-09-09] `employeeTitlePrefix` (tiền tố chức danh) đã bị bỏ khỏi
  // nghiệp vụ. API không nhận nữa; cột DB `employee_title_prefix` vẫn giữ cho dữ liệu cũ.

  @ApiProperty({
    enum: IdPhotoPosition,
    example: IdPhotoPosition.STAFF_OVER_3M,
    description:
      'Cấp bậc nhân viên — quyết định màu khung khi xuất PDF (ánh xạ trong IdPhotoService), ' +
      'KHÔNG phải tên màu.',
  })
  @IsEnum(IdPhotoPosition)
  position: IdPhotoPosition;
}
