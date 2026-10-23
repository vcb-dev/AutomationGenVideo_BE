import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BorrowHistoryQueryDto } from '../dto/borrow-history.dto';

/** Kiểm tham số lọc của màn Nhật ký mượn trước khi chạm Prisma. */
const errorsFor = (cls: any, payload: object) =>
  validateSync(plainToInstance(cls, payload) as object);

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
