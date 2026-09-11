import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
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
 *
 * `cropOffsetX/Y/cropScale` ("Điều chỉnh vị trí ảnh trong khung tròn") CŨNG đi qua đây, cùng lý
 * do MIỄN PHÍ như trên: đổi toạ độ cắt không đụng tới ảnh gốc/AI, chỉ đổi cách VẼ ảnh đã có lên
 * PDF. Xem id-photo-crop.util.ts cho công thức toạ độ dùng chung với PDF thật.
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

  // ── "Điều chỉnh vị trí ảnh trong khung tròn" (kéo thả + zoom) ──────────────────────────────
  // Cùng đường PATCH miễn phí này (không đụng AI) — vẽ lại vị trí ảnh chỉ là thay đổi TOẠ ĐỘ
  // cắt, không phải sinh lại ảnh. Biên [-5,5]/[0.1,10] chỉ là chặn RÁC/NaN thô ở tầng DTO; biên
  // THẬT (không hở viền trắng, xem yêu cầu 5) do IdPhotoService#drawIdCardPage tự kẹp lại theo
  // đúng kích thước ảnh thật mỗi lần render (xem id-photo-crop.util.ts#computeCropLayout) — nên
  // dù FE gửi giá trị vượt biên thực tế (vd đổi cỡ ảnh), PDF/preview vẫn KHÔNG BAO GIỜ hở viền.
  @ApiPropertyOptional({ description: 'Độ lệch tâm ảnh theo trục X, tính theo tỉ lệ cạnh khung tròn (0 = giữa khung).' })
  @IsOptional()
  @IsNumber()
  @Min(-5)
  @Max(5)
  cropOffsetX?: number;

  @ApiPropertyOptional({ description: 'Độ lệch tâm ảnh theo trục Y, tính theo tỉ lệ cạnh khung tròn (0 = giữa khung).' })
  @IsOptional()
  @IsNumber()
  @Min(-5)
  @Max(5)
  cropOffsetY?: number;

  @ApiPropertyOptional({ description: 'Hệ số phóng to trên nền "phủ khít khung" (1 = mặc định/ảnh cũ, tối đa 3).' })
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(10)
  cropScale?: number;
}
