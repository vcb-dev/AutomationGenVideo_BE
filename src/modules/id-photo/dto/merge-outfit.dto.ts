import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Khớp đúng 2 giá trị `outfit_type` mà AI service nhận (xem id_photo_views.py#merge_outfit). */
export type IdPhotoOutfitType = 'office' | 'workshop';

export class MergeOutfitDto {
  @ApiProperty({
    description:
      'uploadId trả về từ POST /id-photo/upload — dùng để tra lại buffer ảnh gốc đã lưu ' +
      'tạm ở BE, tránh phải gửi lại nguyên ảnh base64 (dễ vượt giới hạn body JSON).',
  })
  @IsString()
  @IsNotEmpty()
  uploadId: string;

  @ApiPropertyOptional({
    enum: ['office', 'workshop'],
    default: 'office',
    description:
      'Loại đồng phục ghép vào ảnh — "office" (áo vest cổ tim, mặc định, hành vi cũ) hoặc ' +
      '"workshop" (áo polo đen có logo công ty, ghép kèm ảnh logo thật). Bỏ trống = "office".',
  })
  @IsOptional()
  @IsIn(['office', 'workshop'])
  outfitType?: IdPhotoOutfitType;
}
