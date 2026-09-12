import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

  @ApiPropertyOptional({
    example: 'HĐ.',
    description: 'Tiền tố chức danh in trước tên trên thẻ (vd "HĐ." → "HĐ. BẢO VIỆT"). Bỏ trống thì chỉ in tên.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  employeeTitlePrefix?: string;

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
