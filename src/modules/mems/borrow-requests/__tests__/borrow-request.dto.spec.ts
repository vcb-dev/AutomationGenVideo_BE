import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListRequestsQueryDto } from '../dto/borrow-request.dto';

/**
 * Chức năng: kiểm tham số lọc của màn Duyệt phiếu TRƯỚC khi chạm Prisma.
 *
 * Vì sao đáng một file test riêng: endpoint từng nhận `@Query('...')` rời rồi ép thẳng
 * xuống Prisma — `status as any`, và `new Date(query.from)` không kiểm. Gõ `?from=hôm-qua` cho ra
 * `Invalid Date`, Prisma ném lỗi, bộ lọc toàn cục xếp vào 500 và trả nguyên thông điệp Prisma về
 * client. Sai mã lỗi và lộ hình dạng truy vấn cùng lúc.
 */
const errorsFor = (cls: any, payload: object) =>
  validateSync(plainToInstance(cls, payload) as object);

describe('ListRequestsQueryDto — lọc phiếu theo trạng thái', () => {
  it('không lọc thì hợp lệ', () => {
    expect(errorsFor(ListRequestsQueryDto, {})).toHaveLength(0);
  });

  it('một trạng thái có thật thì qua', () => {
    expect(errorsFor(ListRequestsQueryDto, { status: 'PENDING_APPROVAL' })).toHaveLength(0);
  });

  it('nhiều trạng thái ngăn bằng dấu phẩy vẫn qua', () => {
    // Màn Nhận trả gọi kèm `ON_LOAN,PARTIALLY_RETURNED`; chặn dạng này là hỏng màn đó.
    expect(
      errorsFor(ListRequestsQueryDto, { status: 'ON_LOAN,PARTIALLY_RETURNED' }),
    ).toHaveLength(0);
    expect(errorsFor(ListRequestsQueryDto, { status: 'ON_LOAN, PREPARING' })).toHaveLength(0);
  });

  it('trạng thái lạ thì bị chặn, kể cả khi lẫn trong danh sách hợp lệ', () => {
    expect(errorsFor(ListRequestsQueryDto, { status: 'foo' }).length).toBeGreaterThan(0);
    expect(
      errorsFor(ListRequestsQueryDto, { status: 'ON_LOAN,foo' }).length,
    ).toBeGreaterThan(0);
  });
});
