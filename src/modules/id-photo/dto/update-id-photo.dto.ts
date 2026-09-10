import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IdPhotoPosition } from '@prisma/client';

/**
 * Sửa thông tin của một bản ghi ảnh thẻ ĐÃ TẠO (bước 4 — màn xuất PDF), khi người dùng phát
 * hiện gõ sai tên/team/ID/cấp bậc mà không muốn làm lại từ đầu.
 *
 * KHÔNG có field ảnh ở đây, và đó là chủ ý: ảnh không đổi khi chỉ sửa chữ, nên PATCH này
 * TUYỆT ĐỐI không gọi lại Gemini (xem IdPhotoService#update — PDF được dựng lại từ
 * `processed_image_data` đã lưu sẵn trong DB). Muốn đổi ảnh thì dùng
 * POST /id-photo/:id/remerge-outfit — đường đi riêng vì nó có phát sinh chi phí AI.
 *
 * Mọi field đều optional để FE gửi được patch từng phần; service từ chối body rỗng hoàn toàn.
 * Riêng các field bắt buộc trên thẻ (name/team/id) nếu ĐƯỢC gửi thì không được rỗng —
 * @IsNotEmpty chỉ chạy khi field có mặt vì đứng sau @IsOptional.
 */
export class UpdateIdPhotoDto {
  @ApiPropertyOptional({ example: 'Nguyễn Văn A' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'employeeName không được để trống' })
  employeeName?: string;

  @ApiPropertyOptional({ example: 'Team Content Việt Nam' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'employeeTeam không được để trống' })
  employeeTeam?: string;

  @ApiPropertyOptional({ example: 'NV-00123' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'employeeId không được để trống' })
  employeeId?: string;

  // [ĐÃ NGỪNG DÙNG từ 2026-09-09] `employeeTitlePrefix` (tiền tố chức danh) đã bị bỏ khỏi
  // nghiệp vụ. PATCH không nhận nữa; cột DB `employee_title_prefix` vẫn giữ cho dữ liệu cũ.

  @ApiPropertyOptional({
    enum: IdPhotoPosition,
    description: 'Cấp bậc nhân viên — quyết định màu khung khi dựng lại PDF.',
  })
  @IsOptional()
  @IsEnum(IdPhotoPosition)
  position?: IdPhotoPosition;
}
