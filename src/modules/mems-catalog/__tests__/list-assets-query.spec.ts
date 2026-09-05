import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListAssetsQueryDto } from '../dto';

/**
 * Chức năng: kiểm tham số lọc của màn Danh sách kho TRƯỚC khi chúng chạm tới Prisma.
 *
 * Vì sao đáng một file test riêng: trước đây `status` và `categoryId` được ép kiểu `as any` rồi
 * đưa thẳng xuống Prisma. Gõ `?status=foo` là Prisma ném lỗi, bộ lọc lỗi toàn cục xếp vào 500 và
 * trả nguyên thông điệp của Prisma về client — vừa sai mã lỗi (đây là lỗi của người gọi, phải là
 * 400), vừa lộ tên model và hình dạng truy vấn ra ngoài.
 */
const errorsFor = (payload: object) =>
  validateSync(plainToInstance(ListAssetsQueryDto, payload) as object);

describe('ListAssetsQueryDto', () => {
  it('không lọc gì cũng hợp lệ', () => {
    expect(errorsFor({})).toHaveLength(0);
  });

  it('trạng thái có thật thì qua', () => {
    expect(errorsFor({ status: 'AVAILABLE' })).toHaveLength(0);
    expect(errorsFor({ status: 'ON_LOAN' })).toHaveLength(0);
  });

  it('trạng thái không có trong enum thì bị chặn ngay, không xuống tới Prisma', () => {
    expect(errorsFor({ status: 'foo' }).length).toBeGreaterThan(0);
    // `IN_USE` là giá trị từng xuất hiện trong danh sách viết tay nhưng KHÔNG có trong enum.
    expect(errorsFor({ status: 'IN_USE' }).length).toBeGreaterThan(0);
  });

  it('danh mục phải là mã định danh hợp lệ', () => {
    expect(errorsFor({ categoryId: '3f8b1f2e-0f4a-4a5c-9e11-6d3a9b2c7e01' })).toHaveLength(0);
    expect(errorsFor({ categoryId: 'không-phải-uuid' }).length).toBeGreaterThan(0);
  });

  it('ô lọc để trống gửi lên chuỗi rỗng vẫn tính là không lọc', () => {
    // Giao diện gửi `?status=&categoryId=` khi người dùng chọn lại "Mọi trạng thái". Chặn ở đây
    // là bấm bỏ lọc thì màn hình ăn 400.
    const dto = plainToInstance(ListAssetsQueryDto, { status: '', categoryId: '' });

    expect(validateSync(dto as object)).toHaveLength(0);
    expect(dto.status).toBeUndefined();
    expect(dto.categoryId).toBeUndefined();
  });
});
