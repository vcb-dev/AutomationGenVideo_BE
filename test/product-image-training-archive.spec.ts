/**
 * Tạo ảnh sản phẩm — lưu ảnh gốc người dùng thả vào lên Google Drive công ty để sau này duyệt nhãn rồi cho model nhận
 * diện túi học (người dùng chốt 15/10: người thả ảnh không phải làm gì thêm, máy không tự học).
 *
 * Khoá: lưu đúng thư mục riêng theo ngày, tên file có tên SP/tên file + nơi thả + mã băm; chạy nền — Drive lỗi hay chưa
 * cấu hình thì lượt tạo ảnh vẫn chạy bình thường; ảnh trùng chỉ lưu một lần (lỗi thì lần sau thử lại); file tạm bị xoá.
 */
import * as fs from 'fs';
import { of } from 'rxjs';
import { ProductImageService } from '../src/modules/product-image/product-image.service';
import {
  ProductImageTrainingArchiveService,
  slugForFileName,
} from '../src/modules/product-image/product-image-training-archive.service';

const USER = { id: 'user-1', email: 'media@vcb.test' };

function makeFile(content = 'fake-image-bytes', overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    buffer: Buffer.from(content),
    mimetype: 'image/jpeg',
    originalname: 'TX018-25-CS-02_Tui-Xach-Moc-Van.jpg',
    size: content.length,
    ...overrides,
  } as Express.Multer.File;
}

function makeDrive(overrides: Record<string, jest.Mock> = {}) {
  const uploaded: { path: string; existedDuringUpload: boolean }[] = [];
  const drive: any = {
    isAvailable: jest.fn(() => true),
    resolveDatedFolder: jest.fn().mockResolvedValue('folder-2026-10-15'),
    uploadFromPath: jest.fn(async (filePath: string) => {
      uploaded.push({ path: filePath, existedDuringUpload: fs.existsSync(filePath) });
      return { fileId: 'f1', url: 'u', webViewUrl: 'w' };
    }),
    ...overrides,
  };
  return { drive, uploaded };
}

function makeService(archive: ProductImageTrainingArchiveService) {
  const post = jest.fn(() => of({ data: { success: true, cutout_image_base64: 'UE5H', width: 1, height: 1 } }));
  const configService: any = { get: jest.fn((key: string) => ({ AI_SERVICE_URL: 'http://ai:8000/' } as any)[key]) };
  const jwtService: any = { sign: jest.fn(() => 'signed.jwt') };
  const generations: any = { record: jest.fn().mockResolvedValue('gen-1') };
  return new ProductImageService({ post } as any, configService, jwtService, generations, archive);
}

/** Lượt tạo ảnh không chờ việc lưu (chạy nền) — test gom các lượt lưu lại để chờ cho xong rồi mới kiểm. */
function track(archive: ProductImageTrainingArchiveService) {
  const pending: Promise<void>[] = [];
  const original = archive.archive.bind(archive);
  jest.spyOn(archive, 'archive').mockImplementation((...args) => {
    const done = original(...args);
    pending.push(done);
    return done;
  });
  return () => Promise.all(pending);
}

describe('Tạo ảnh sản phẩm — lưu ảnh gốc chờ duyệt nhãn', () => {
  it('tách nền: lưu ảnh vào thư mục riêng theo ngày, tên = tên file + nơi thả + mã băm; file tạm bị xoá', async () => {
    const { drive, uploaded } = makeDrive();
    const archive = new ProductImageTrainingArchiveService(drive);
    const settle = track(archive);
    const result = await makeService(archive).cutout(makeFile(), USER);
    await settle();
    expect(result.imageData).toBe('data:image/png;base64,UE5H');
    expect(drive.resolveDatedFolder).toHaveBeenCalledWith(ProductImageTrainingArchiveService.FOLDER_NAME);
    const [, name, mime, user, opts] = drive.uploadFromPath.mock.calls[0];
    expect(name).toMatch(/^tx018-25-cs-02-tui-xach-moc-van__cutout__[0-9a-f]{16}\.jpg$/);
    expect(mime).toBe('image/jpeg');
    expect(user).toBeUndefined();
    expect(opts).toEqual({ folderId: 'folder-2026-10-15' });
    expect(uploaded[0].existedDuringUpload).toBe(true);
    expect(fs.existsSync(uploaded[0].path)).toBe(false);
  });

  it('cùng một ảnh thả lại (thử nền khác) chỉ lưu một lần; ảnh khác thì lưu tiếp', async () => {
    const { drive } = makeDrive();
    const archive = new ProductImageTrainingArchiveService(drive);
    await archive.archive(makeFile('a'), { source: 'cutout' });
    await archive.archive(makeFile('a'), { source: 'cutout' });
    await archive.archive(makeFile('b'), { source: 'cutout' });
    expect(drive.uploadFromPath).toHaveBeenCalledTimes(2);
  });

  it('Drive chưa cấu hình: không lưu, không lỗi — lượt tách nền vẫn trả ảnh', async () => {
    const { drive } = makeDrive({ isAvailable: jest.fn(() => false) });
    const archive = new ProductImageTrainingArchiveService(drive);
    const settle = track(archive);
    const result = await makeService(archive).cutout(makeFile(), USER);
    await settle();
    expect(result.imageData).toBe('data:image/png;base64,UE5H');
    expect(drive.uploadFromPath).not.toHaveBeenCalled();
  });

  it('Drive lỗi: lượt tách nền vẫn trả ảnh; lần sau thả lại cùng ảnh thì thử lưu lại', async () => {
    const failing = jest.fn().mockRejectedValueOnce(new Error('quota')).mockResolvedValue({ fileId: 'f2' });
    const { drive } = makeDrive({ uploadFromPath: failing });
    const archive = new ProductImageTrainingArchiveService(drive);
    const settle = track(archive);
    const result = await makeService(archive).cutout(makeFile(), USER);
    await settle();
    expect(result.imageData).toBe('data:image/png;base64,UE5H');
    await archive.archive(makeFile(), { source: 'cutout' });
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('không có file (thiếu ảnh) thì bỏ qua', async () => {
    const { drive } = makeDrive();
    await new ProductImageTrainingArchiveService(drive).archive(undefined, { source: 'held-auto' });
    expect(drive.uploadFromPath).not.toHaveBeenCalled();
  });

  it('tên SP tiếng Việt thành tên file không dấu; trống thì dùng "anh-sp"', async () => {
    expect(slugForFileName('Túi Xách Hà Trúc · Đỏ TX004-22')).toBe('tui-xach-ha-truc-do-tx004-22');
    expect(slugForFileName('')).toBe('');
    const { drive } = makeDrive();
    await new ProductImageTrainingArchiveService(drive).archive(makeFile('c', { mimetype: 'image/webp' }), { source: 'held-auto' });
    expect(drive.uploadFromPath.mock.calls[0][1]).toMatch(/^anh-sp__held-auto__[0-9a-f]{16}\.webp$/);
  });
});
