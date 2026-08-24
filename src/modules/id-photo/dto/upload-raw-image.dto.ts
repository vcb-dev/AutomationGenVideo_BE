import { ApiProperty } from '@nestjs/swagger';

/** Chỉ dùng để khai báo Swagger cho multipart/form-data — validate thật nằm ở FileInterceptor
 * (fileFilter + limits) trong id-photo.controller.ts, giống transcribeContentUpload. */
export class UploadRawImageDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'Ảnh gốc nhân viên (JPG/PNG, tối đa 10MB)' })
  file: any;
}
