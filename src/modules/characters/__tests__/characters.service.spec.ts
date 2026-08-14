import { ConflictException, NotFoundException } from '@nestjs/common';
import { CharactersService } from '../characters.service';

/**
 * `update()` phải lưu vết (audit) bản system_prompt CŨ vào character_system_prompt_history
 * TRƯỚC khi ghi đè, và optimistic-concurrency check phải chặn ghi đè khi 2 người sửa cùng lúc
 * (9d53e9e — "audit logging for system prompts"). Trước đây sửa prompt thủ công không lưu vết,
 * từng gây mất dữ liệu khi ai đó ghi đè nhầm.
 */

const CHAR_ID = 'char-1';
const UPDATED_AT = new Date('2026-08-10T00:00:00.000Z');

function buildPrisma(existing: any) {
  const historyCreate = jest.fn(async (args: any) => args.data);
  const characterUpdate = jest.fn(async (args: any) => ({
    ...existing,
    ...args.data,
  }));

  const tx = {
    characterSystemPromptHistory: { create: historyCreate },
    character: { update: characterUpdate },
  };

  const prisma = {
    character: {
      findUnique: jest.fn(async () => existing),
      findFirst: jest.fn(async () => existing),
      create: jest.fn(),
    },
    characterSystemPromptHistory: {
      create: historyCreate,
      findMany: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };

  return { prisma, historyCreate, characterUpdate };
}

function buildExisting(overrides: Partial<any> = {}) {
  return {
    id: CHAR_ID,
    slug: 'huyk',
    name: 'HuyK',
    system_prompt: 'bản gốc',
    updated_at: UPDATED_AT,
    ...overrides,
  };
}

describe('CharactersService.update — audit log system_prompt', () => {
  it('đổi system_prompt thì lưu bản CŨ vào history trước khi ghi đè', async () => {
    const existing = buildExisting();
    const { prisma, historyCreate } = buildPrisma(existing);
    const service = new CharactersService(prisma as any);

    await service.update('user-1', CHAR_ID, {
      system_prompt: 'bản mới',
      updated_at: UPDATED_AT.toISOString(),
    } as any);

    expect(historyCreate).toHaveBeenCalledWith({
      data: {
        character_id: CHAR_ID,
        old_content: 'bản gốc', // bản CŨ, không phải bản mới vừa gửi lên
        changed_by: 'user-1',
      },
    });
  });

  it('KHÔNG đổi system_prompt thì không tạo bản ghi history', async () => {
    const existing = buildExisting();
    const { prisma, historyCreate } = buildPrisma(existing);
    const service = new CharactersService(prisma as any);

    await service.update('user-1', CHAR_ID, {
      name: 'Tên mới',
      updated_at: UPDATED_AT.toISOString(),
    } as any);

    expect(historyCreate).not.toHaveBeenCalled();
  });

  it('gửi lại ĐÚNG system_prompt cũ (không đổi giá trị) thì cũng không tạo history', async () => {
    const existing = buildExisting();
    const { prisma, historyCreate } = buildPrisma(existing);
    const service = new CharactersService(prisma as any);

    await service.update('user-1', CHAR_ID, {
      system_prompt: 'bản gốc',
      updated_at: UPDATED_AT.toISOString(),
    } as any);

    expect(historyCreate).not.toHaveBeenCalled();
  });

  it('updated_at client gửi lệch với DB (đã bị người khác sửa) thì 409, không ghi đè', async () => {
    const existing = buildExisting();
    const { prisma, characterUpdate } = buildPrisma(existing);
    const service = new CharactersService(prisma as any);

    await expect(
      service.update('user-1', CHAR_ID, {
        system_prompt: 'bản mới',
        updated_at: new Date('2020-01-01T00:00:00.000Z').toISOString(),
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(characterUpdate).not.toHaveBeenCalled();
  });

  it('character không tồn tại thì 404', async () => {
    const { prisma } = buildPrisma(null);
    (prisma.character.findUnique as jest.Mock).mockResolvedValue(null);
    const service = new CharactersService(prisma as any);

    await expect(
      service.update('user-1', CHAR_ID, { updated_at: UPDATED_AT.toISOString() } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('đổi slug trùng với nhân vật khác thì 409 (unique constraint P2002)', async () => {
    const existing = buildExisting();
    const { prisma } = buildPrisma(existing);
    const tx = await (prisma.$transaction as jest.Mock).getMockImplementation();
    // Ghi đè character.update trong transaction để giả lập lỗi unique constraint của Prisma.
    (prisma as any).$transaction = jest.fn(async (fn: any) =>
      fn({
        characterSystemPromptHistory: { create: jest.fn() },
        character: {
          update: jest.fn(async () => {
            const err: any = new Error('Unique constraint failed');
            err.code = 'P2002';
            throw err;
          }),
        },
      }),
    );
    const service = new CharactersService(prisma as any);

    await expect(
      service.update('user-1', CHAR_ID, {
        slug: 'da-ton-tai',
        updated_at: UPDATED_AT.toISOString(),
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('CharactersService.findOneAdmin — tra theo id lẫn slug', () => {
  it('tìm được bằng slug (không chỉ id) — luồng /ai/content-transform/transform truyền slug', async () => {
    const existing = buildExisting();
    const { prisma } = buildPrisma(existing);
    const service = new CharactersService(prisma as any);

    const result = await service.findOneAdmin('huyk');

    expect(result).toEqual(existing);
    expect(prisma.character.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ id: 'huyk' }, { slug: 'huyk' }] },
      }),
    );
  });

  it('không tìm thấy thì 404', async () => {
    const { prisma } = buildPrisma(null);
    const service = new CharactersService(prisma as any);

    await expect(service.findOneAdmin('khong-ton-tai')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CharactersService.getSystemPromptHistory', () => {
  it('character không tồn tại thì 404 thay vì trả mảng rỗng', async () => {
    const { prisma } = buildPrisma(null);
    (prisma.character.findUnique as jest.Mock).mockResolvedValue(null);
    const service = new CharactersService(prisma as any);

    await expect(service.getSystemPromptHistory(CHAR_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('trả lịch sử mới nhất trước (orderBy changed_at desc)', async () => {
    const existing = buildExisting();
    const { prisma } = buildPrisma(existing);
    const service = new CharactersService(prisma as any);

    await service.getSystemPromptHistory(CHAR_ID);

    expect(prisma.characterSystemPromptHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { character_id: CHAR_ID },
        orderBy: { changed_at: 'desc' },
      }),
    );
  });
});
