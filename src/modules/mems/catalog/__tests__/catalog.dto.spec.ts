import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateAssetDto,
  CreateLocationDto,
  UpdateAssetDto,
  UpdateLocationDto,
  ListAssetsQueryDto,
} from '../dto/catalog.dto';

describe('DTO thiết bị', () => {
  /**
   * Ô select rỗng trong form gửi lên CHUỖI RỖNG, không phải `null`.
   *
   * `@IsOptional()` chỉ bỏ qua `undefined` và `null`, nên chuỗi rỗng vẫn rơi vào `@IsUUID()` và
   * ăn 400. Hậu quả thật: bấm "Chưa xếp chỗ" để gỡ máy khỏi vị trí thì không lưu được — mà đó lại
   * là cách duy nhất dọn sạch một vị trí trước khi xoá nó, vì `deleteLocation` chặn khi còn thiết bị.
   */
  const errorsFor = (cls: any, payload: object) => validateSync(plainToInstance(cls, payload) as object);

  describe('UpdateAssetDto — gỡ thiết bị khỏi vị trí lưu kho', () => {
    it('chuỗi rỗng được nhận và quy về null', () => {
      const dto = plainToInstance(UpdateAssetDto, { locationId: '' });

      expect(validateSync(dto as object)).toHaveLength(0);
      expect(dto.locationId).toBeNull();
    });

    it('chuỗi toàn khoảng trắng cũng tính là bỏ trống', () => {
      const dto = plainToInstance(UpdateAssetDto, { locationId: '   ' });

      expect(validateSync(dto as object)).toHaveLength(0);
      expect(dto.locationId).toBeNull();
    });

    it('phân biệt được "không gửi" với "gửi rỗng"', () => {
      // Tầng service dựa vào đúng khác biệt này: `undefined` giữ nguyên vị trí cũ, `null` xoá đi.
      const khongGui = plainToInstance(UpdateAssetDto, { condition: 'GOOD' });
      expect(khongGui.locationId).toBeUndefined();

      const guiRong = plainToInstance(UpdateAssetDto, { locationId: '' });
      expect(guiRong.locationId).toBeNull();
    });

    it('UUID hợp lệ vẫn qua', () => {
      expect(errorsFor(UpdateAssetDto, { locationId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' })).toHaveLength(
        0,
      );
    });

    it('chuỗi rác vẫn bị chặn — nới cho chuỗi rỗng không được nới cho mọi thứ', () => {
      const errors = errorsFor(UpdateAssetDto, { locationId: 'khong-phai-uuid' });

      expect(errors).toHaveLength(1);
      expect(errors[0].constraints).toHaveProperty('isUuid');
    });
  });

  describe('Các DTO khác dùng cùng quy ước', () => {
    it.each([
      [
        'CreateAssetDto.locationId',
        CreateAssetDto,
        {
          modelId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
          serialNumber: 'SN-001',
          locationId: '',
        },
      ],
      ['CreateLocationDto.parentId', CreateLocationDto, { name: 'Kệ A', parentId: '' }],
      ['UpdateLocationDto.parentId', UpdateLocationDto, { name: 'Kệ A', parentId: '' }],
    ])('%s nhận chuỗi rỗng', (_label, cls, payload) => {
      expect(errorsFor(cls, payload)).toHaveLength(0);
    });
  });

  describe('UpdateAssetDto — danh sách trạng thái khớp enum của schema', () => {
    it('không còn nhận IN_USE, giá trị không tồn tại trong MemsAssetStatus', () => {
      // Lọt `@IsIn` rồi mới chết ở tầng Prisma nghĩa là người dùng nhận 500 thay vì 400.
      const errors = errorsFor(UpdateAssetDto, { status: 'IN_USE' });

      expect(errors).toHaveLength(1);
      expect(errors[0].constraints).toHaveProperty('isIn');
    });

    it.each([
      'PENDING_INSPECTION',
      'AVAILABLE',
      'ON_LOAN',
      'POST_RETURN_CHECK',
      'UNDER_MAINTENANCE',
      'BROKEN',
      'LOST',
      'DISPOSED',
    ])('nhận %s', (status) => {
      expect(errorsFor(UpdateAssetDto, { status })).toHaveLength(0);
    });
  });
});

describe('Tham số lọc danh sách kho', () => {
  /**
   * Chức năng: kiểm tham số lọc của màn Danh sách kho TRƯỚC khi chúng chạm tới Prisma.
   *
   * Vì sao đáng một file test riêng: trước đây `status` và `categoryId` được ép kiểu `as any` rồi
   * đưa thẳng xuống Prisma. Gõ `?status=foo` là Prisma ném lỗi, bộ lọc lỗi toàn cục xếp vào 500 và
   * trả nguyên thông điệp của Prisma về client — vừa sai mã lỗi (đây là lỗi của người gọi, phải là
   * 400), vừa lộ tên model và hình dạng truy vấn ra ngoài.
   */
  const errorsFor = (payload: object) => validateSync(plainToInstance(ListAssetsQueryDto, payload) as object);

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
});
