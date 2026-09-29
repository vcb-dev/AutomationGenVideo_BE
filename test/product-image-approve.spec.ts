/**
 * Tạo ảnh sản phẩm — bấm/bỏ "Đạt" cho ảnh Gemini đã tạo (PATCH /product-image/generations/:id).
 *
 * "Đạt" là mẫu số của hai chỉ số chính ở tab Chi phí, nên phải chặn đúng: chỉ ảnh Gemini tạo
 * thành công mới đạt được, chỉ người tạo hoặc ADMIN/MANAGER được bấm, bỏ "Đạt" thì xoá dấu thời
 * gian và người duyệt.
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProductImageController } from '../src/modules/product-image/product-image.controller';
import { ProductImageGenerationsService } from '../src/modules/product-image/product-image-generations.service';
import { UpdateGenerationDto } from '../src/modules/product-image/dto/update-generation.dto';

const CREATOR = { id: 'creator', roles: [UserRole.MEMBER] };

function makeService(found: object | null) {
  const prisma: any = {
    productImageGeneration: {
      findUnique: jest.fn().mockResolvedValue(found),
      update: jest.fn(async ({ data }: any) => ({ id: 'gen-1', approved_at: data.approved_at })),
    },
  };
  return { service: new ProductImageGenerationsService(prisma, { get: jest.fn() } as any), prisma };
}

const heldSuccess = { id: 'gen-1', user_id: 'creator', mode: 'HELD_PRODUCT', status: 'SUCCESS' };

describe('Đánh dấu "Đạt" ảnh sản phẩm', () => {
  it('người tạo bấm Đạt → lưu thời điểm + người duyệt', async () => {
    const { service, prisma } = makeService(heldSuccess);

    const result = await service.setApproved('gen-1', true, CREATOR);

    const { data } = prisma.productImageGeneration.update.mock.calls[0][0];
    expect(data.approved_at).toBeInstanceOf(Date);
    expect(data.approved_by).toBe('creator');
    expect(result).toMatchObject({ id: 'gen-1', approved: true });
  });

  it('bỏ Đạt → xoá thời điểm và người duyệt', async () => {
    const { service, prisma } = makeService(heldSuccess);
    const result = await service.setApproved('gen-1', false, CREATOR);
    expect(prisma.productImageGeneration.update.mock.calls[0][0].data).toEqual({ approved_at: null, approved_by: null });
    expect(result.approved).toBe(false);
  });

  it.each([UserRole.ADMIN, UserRole.MANAGER])('%s bấm Đạt được ảnh của người khác', async (role) => {
    const { service } = makeService(heldSuccess);
    await expect(service.setApproved('gen-1', true, { id: 'boss', roles: [role] })).resolves.toMatchObject({ approved: true });
  });

  it.each([UserRole.MEMBER, UserRole.LEADER])('%s không bấm Đạt được ảnh của người khác', async (role) => {
    const { service, prisma } = makeService(heldSuccess);
    await expect(service.setApproved('gen-1', true, { id: 'other', roles: [role] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.productImageGeneration.update).not.toHaveBeenCalled();
  });

  it('không có lượt này → 404', async () => {
    const { service } = makeService(null);
    await expect(service.setApproved('khong-co', true, CREATOR)).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    ['lượt tách nền', { ...heldSuccess, mode: 'CUTOUT' }],
    ['lượt Gemini hỏng', { ...heldSuccess, status: 'FAILED' }],
  ])('%s không đánh dấu Đạt được', async (_label, found) => {
    const { service, prisma } = makeService(found);
    await expect(service.setApproved('gen-1', true, CREATOR)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.productImageGeneration.update).not.toHaveBeenCalled();
  });

  it('DB chưa có bảng → báo migration chưa áp, không đổ lỗi Prisma lên màn hình', async () => {
    const prisma: any = {
      productImageGeneration: { findUnique: jest.fn().mockRejectedValue(Object.assign(new Error('raw prisma'), { code: 'P2021' })) },
    };
    const service = new ProductImageGenerationsService(prisma, { get: jest.fn() } as any);
    const error = await service.setApproved('gen-1', true, CREATOR).catch((e) => e);
    expect(error.message).toContain('migration');
    expect(error.message).not.toContain('raw prisma');
  });

  it('controller chuyển đúng id, giá trị và người bấm', async () => {
    const setApproved = jest.fn().mockResolvedValue({ approved: true });
    const controller = new ProductImageController({} as any, { setApproved } as any);
    await controller.setApproved('gen-1', { approved: true }, { user: CREATOR });
    expect(setApproved).toHaveBeenCalledWith('gen-1', true, CREATOR);
  });

  it('DTO: approved bắt buộc là boolean', async () => {
    expect(await validate(plainToInstance(UpdateGenerationDto, { approved: true }))).toHaveLength(0);
    expect(await validate(plainToInstance(UpdateGenerationDto, { approved: 'yes' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(UpdateGenerationDto, {}))).not.toHaveLength(0);
  });
});
