import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BorrowHistoryQueryDto, ListRequestsQueryDto } from '../dto';

/**
 * Chức năng: kiểm tham số lọc của màn Duyệt phiếu và màn Nhật ký mượn TRƯỚC khi chạm Prisma.
 *
 * Vì sao đáng một file test riêng: cả hai endpoint từng nhận `@Query('...')` rời rồi ép thẳng
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

describe('BorrowHistoryQueryDto — nhật ký mượn của cả kho', () => {
  it('không lọc thì hợp lệ', () => {
    expect(errorsFor(BorrowHistoryQueryDto, {})).toHaveLength(0);
  });

  it('ba trạng thái của một lượt mượn đều qua', () => {
    for (const status of ['HOLDING', 'OVERDUE', 'RETURNED']) {
      expect(errorsFor(BorrowHistoryQueryDto, { status })).toHaveLength(0);
    }
  });

  it('trạng thái lạ bị chặn', () => {
    // `PENDING_APPROVAL` là trạng thái của PHIẾU, không phải của một lượt mượn — gửi nhầm sang
    // đây thì bảng trả về rỗng một cách khó hiểu chứ không báo gì.
    expect(errorsFor(BorrowHistoryQueryDto, { status: 'PENDING_APPROVAL' }).length).toBeGreaterThan(0);
  });

  it('ngày phải đúng định dạng', () => {
    expect(errorsFor(BorrowHistoryQueryDto, { from: '2026-08-01' })).toHaveLength(0);
    expect(errorsFor(BorrowHistoryQueryDto, { from: 'hôm qua' }).length).toBeGreaterThan(0);
    expect(errorsFor(BorrowHistoryQueryDto, { to: '32/13/2026' }).length).toBeGreaterThan(0);
  });

  it('số trang chuyển thành số và không nhận giá trị vô lý', () => {
    const dto = plainToInstance(BorrowHistoryQueryDto, { page: '2', pageSize: '50' });

    expect(validateSync(dto as object)).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(50);
    expect(errorsFor(BorrowHistoryQueryDto, { page: '0' }).length).toBeGreaterThan(0);
    expect(errorsFor(BorrowHistoryQueryDto, { page: 'ba' }).length).toBeGreaterThan(0);
  });

  it('ô lọc để trống vẫn tính là không lọc', () => {
    const dto = plainToInstance(BorrowHistoryQueryDto, { status: '', from: '', to: '' });

    expect(validateSync(dto as object)).toHaveLength(0);
    expect(dto.status).toBeUndefined();
  });
});
