import { BadRequestException } from '@nestjs/common';
import { BASE, buildCreateDeps } from './support/mems-borrow-fixtures';

/**
 * Chức năng: một model chỉ được khai MỘT dòng trong phiếu mượn.
 *
 * Lỗi người dùng gặp: giao diện tính khả dụng theo TỪNG dòng, nên ba dòng cùng một model cùng
 * nhận về "còn 1 máy" — không dòng nào biết dòng trước đã nhận chiếc duy nhất đó — rồi cột tóm
 * tắt cộng thành 3 máy cho model chỉ có 1 chiếc.
 *
 * Dữ liệu không hỏng: dòng sau rơi vào Chờ hàng nhờ phép kiểm chạy trên chính client của giao
 * dịch. Nhưng phiếu mang những dòng chờ hàng mà kho không bao giờ đáp ứng được.
 */

describe('Phiếu mượn — khai trùng model trong cùng một phiếu', () => {
  it('cùng một model ở hai dòng thì từ chối phiếu', async () => {
    const { service } = buildCreateDeps();

    await expect(
      service.create('user-1', {
        ...BASE,
        lines: [
          { modelId: 'model-1', quantity: 1 },
          { modelId: 'model-1', quantity: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('báo rõ phải tăng số lượng thay vì thêm dòng', async () => {
    const { service } = buildCreateDeps();

    await expect(
      service.create('user-1', {
        ...BASE,
        lines: [
          { modelId: 'model-1', quantity: 1 },
          { modelId: 'model-1', quantity: 1 },
        ],
      }),
    ).rejects.toThrow(/tăng số lượng/);
  });

  it('trùng ở dòng thứ ba cũng bị chặn, không chỉ hai dòng liền nhau', async () => {
    const { service } = buildCreateDeps();

    await expect(
      service.create('user-1', {
        ...BASE,
        lines: [
          { modelId: 'model-1', quantity: 1 },
          { modelId: 'model-2', quantity: 1 },
          { modelId: 'model-1', quantity: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('chặn TRƯỚC khi mở giao dịch, không có gì phải dọn ngược', async () => {
    // Từ chối muộn thì phiếu đã sinh mã và đã có dòng, phải dọn ngược — chặn sớm thì không có gì
    // để dọn.
    const { service, prisma, created } = buildCreateDeps();

    await expect(
      service.create('user-1', {
        ...BASE,
        lines: [
          { modelId: 'model-1', quantity: 1 },
          { modelId: 'model-1', quantity: 2 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(created.request).toBeNull();
    expect(created.lines).toHaveLength(0);
  });

  it('các model khác nhau thì vẫn nhận bình thường', async () => {
    const { service, created } = buildCreateDeps();

    await service.create('user-1', {
      ...BASE,
      lines: [
        { modelId: 'model-1', quantity: 1 },
        { modelId: 'model-2', quantity: 2 },
      ],
    });

    expect(created.lines.map((l: any) => l.model_id)).toEqual(['model-1', 'model-2']);
    expect(created.reservations).toHaveLength(3);
  });
});
