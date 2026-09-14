import { MulterError } from 'multer';
import { MulterErrorFilter } from '../multer-error.filter';

/**
 * Trần kích thước ảnh nằm ở tầng Multer, không ở service — kiểm trong service là đã muộn vì lúc
 * đó file đã nằm trọn trong RAM.
 *
 * Cái giá của việc chuyển lên đó: lỗi vượt trần giờ là `MulterError`, mà lớp này KHÔNG kế thừa
 * `HttpException`, nên `AllExceptionsFilter` toàn cục xếp nó vào 500 kèm câu tiếng Anh
 * "File too large". Người tải nhầm ảnh lớn đọc thấy "lỗi hệ thống" và đi báo hỏng, thay vì
 * chụp lại nhỏ hơn.
 */
function buildHost() {
  const response: any = {
    status: jest.fn(() => response),
    json: jest.fn(() => response),
  };
  const host: any = { switchToHttp: () => ({ getResponse: () => response }) };
  return { host, response };
}

describe('MulterErrorFilter', () => {
  it('ảnh vượt trần ra 400 kèm lời nhắc tiếng Việt, không phải 500', () => {
    const { host, response } = buildHost();

    new MulterErrorFilter().catch(new MulterError('LIMIT_FILE_SIZE', 'photo'), host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'Ảnh vượt quá 10MB, chụp lại ở kích thước nhỏ hơn',
      }),
    );
  });

  it('gửi nhiều tệp hoặc sai tên trường cũng ra 400 nói rõ việc phải làm', () => {
    for (const code of ['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE'] as const) {
      const { host, response } = buildHost();

      new MulterErrorFilter().catch(new MulterError(code, 'photo'), host);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Mỗi lần chỉ tải lên được một ảnh' }),
      );
    }
  });

  it('mã lỗi lạ vẫn ra 400 và giữ nguyên nội dung gốc, không nuốt mất sự cố', () => {
    const { host, response } = buildHost();

    new MulterErrorFilter().catch(new MulterError('LIMIT_PART_COUNT', 'photo'), host);

    expect(response.status).toHaveBeenCalledWith(400);
    const body = response.json.mock.calls[0][0];
    expect(body.message).toContain('Không nhận được tệp tải lên');
  });
});
