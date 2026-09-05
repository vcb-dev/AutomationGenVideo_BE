import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { MulterError } from 'multer';
import { Response } from 'express';

/**
 * Dịch lỗi của Multer sang lỗi HTTP tử tế.
 *
 * Trần kích thước BẮT BUỘC phải đặt ở tầng Multer, vì kiểm trong service là đã muộn — lúc đó
 * file đã nằm trọn trong RAM. Nhưng `MulterError` không kế thừa `HttpException`, nên
 * `AllExceptionsFilter` toàn cục xếp nó vào 500 kèm câu tiếng Anh "File too large": người dùng
 * tải nhầm ảnh lớn thì thấy "lỗi hệ thống" thay vì lời nhắc chụp lại nhỏ hơn.
 *
 * Chỉ dịch, không nuốt: mã lỗi lạ vẫn ném nguyên để không giấu mất sự cố thật.
 */
@Catch(MulterError)
export class MulterErrorFilter implements ExceptionFilter {
  catch(error: MulterError, host: ArgumentsHost): void {
    const translated = this.translate(error);
    const response = host.switchToHttp().getResponse<Response>();
    const status = translated.getStatus();

    response.status(status).json({
      statusCode: status,
      message: translated.message,
      error: translated.name,
    });
  }

  private translate(error: MulterError): HttpException {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return new BadRequestException('Ảnh vượt quá 10MB, chụp lại ở kích thước nhỏ hơn');
      case 'LIMIT_FILE_COUNT':
      case 'LIMIT_UNEXPECTED_FILE':
        return new BadRequestException('Mỗi lần chỉ tải lên được một ảnh');
      default:
        return new BadRequestException(`Không nhận được tệp tải lên: ${error.message}`);
    }
  }
}
