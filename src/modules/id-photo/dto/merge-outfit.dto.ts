import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MergeOutfitDto {
  @ApiProperty({
    description:
      'uploadId trả về từ POST /id-photo/upload — dùng để tra lại buffer ảnh gốc đã lưu ' +
      'tạm ở BE, tránh phải gửi lại nguyên ảnh base64 (dễ vượt giới hạn body JSON).',
  })
  @IsString()
  @IsNotEmpty()
  uploadId: string;
}
