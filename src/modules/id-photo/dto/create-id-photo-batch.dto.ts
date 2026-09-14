import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IdPhotoPosition } from '@prisma/client';

/**
 * Tối đa 20 người / 1 lần tạo hàng loạt — CHẶN CỨNG ở BE (ArrayMaxSize dưới đây + kiểm tra lại
 * trong IdPhotoBatchService), không tin vào việc FE đã chặn. Con số này khớp giới hạn FE và đủ
 * để worker tuần tự chạy xong trong ~10-15 phút với khoảng nghỉ 3-5s giữa các lượt Gemini.
 */
export const ID_PHOTO_BATCH_MAX_PEOPLE = 20;

/**
 * 1 người trong batch — ĐÚNG cấu trúc thông tin như luồng tạo đơn lẻ (CreateIdPhotoDto), chỉ
 * khác `uploadId` ở đây là ảnh GỐC đã upload qua POST /id-photo/upload (chưa ghép áo). Batch
 * KHÔNG nhận ảnh base64 trực tiếp trong body: giới hạn body JSON 2mb đặt ở main.ts áp cho mọi
 * route, 20 ảnh base64 sẽ vượt xa — nên FE upload từng ảnh trước để lấy uploadId (multipart,
 * không dính giới hạn 2mb), rồi gửi danh sách uploadId + thông tin nhân viên xuống đây.
 */
export class CreateIdPhotoBatchPersonDto {
  @ApiProperty({
    description:
      'uploadId trả về từ POST /id-photo/upload cho ẢNH GỐC của người này (chưa ghép áo). ' +
      'Worker nền sẽ tự gọi AI ghép áo tuần tự từng người.',
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
    description: 'Cấp bậc — quyết định màu khung khi xuất PDF (ánh xạ trong IdPhotoService).',
  })
  @IsEnum(IdPhotoPosition)
  position: IdPhotoPosition;
}

export class CreateIdPhotoBatchDto {
  @ApiProperty({
    type: [CreateIdPhotoBatchPersonDto],
    description: `Danh sách người cần tạo ảnh thẻ (1..${ID_PHOTO_BATCH_MAX_PEOPLE}).`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ID_PHOTO_BATCH_MAX_PEOPLE)
  @ValidateNested({ each: true })
  @Type(() => CreateIdPhotoBatchPersonDto)
  people: CreateIdPhotoBatchPersonDto[];
}
