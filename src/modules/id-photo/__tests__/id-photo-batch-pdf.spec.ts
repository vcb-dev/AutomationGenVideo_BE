import { BadRequestException } from '@nestjs/common';
import { IdPhotoService } from '../id-photo.service';

/**
 * Chức năng: IdPhotoService.buildBatchPdfBuffer — gộp N thẻ thành 1 file PDF N trang khổ CR80
 * cho nút "Xuất PDF hàng loạt". Dùng lại `drawIdCardPage` (cùng bản vẽ với PDF đơn lẻ).
 *
 * Render thật bằng pdfkit + assets đã commit (assets/card-frame-*.png, assets/fonts/*.ttf).
 */

// Render PDF thật (pdfkit + subset font .ttf + nhúng khung PNG) tốn ~1-2s mỗi lượt; test
// "1 vs 3 trang" dựng tới 4 file liên tiếp. Máy CI chạy song song nhiều suite dễ vượt mức
// mặc định 5s của jest → nới hẳn cho nhóm test này, không phải test chậm bất thường.
jest.setTimeout(30_000);

// PNG 1x1 trong suốt — đủ hợp lệ để pdfkit nhúng làm ảnh chân dung.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function card(name: string, position: any) {
  return {
    employee_name: name,
    employee_team: 'Team Content',
    employee_id: 'VCB-001',
    position,
    processed_image_data: TINY_PNG,
  };
}

function buildService() {
  const httpService: any = { get: jest.fn(), post: jest.fn() };
  const configService: any = {
    get: jest.fn((key: string, def?: string) => (key === 'AI_SERVICE_URL' ? 'http://ai.test:8001' : def)),
  };
  return new IdPhotoService(httpService, configService, {} as any, {} as any);
}

describe('IdPhotoService.buildBatchPdfBuffer', () => {
  it('mảng rỗng → BadRequestException', async () => {
    await expect(buildService().buildBatchPdfBuffer([])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('N người → 1 buffer PDF hợp lệ, đúng N trang', async () => {
    const buf = await buildService().buildBatchPdfBuffer([
      card('Nguyễn Văn A', 'NEW_STAFF_1_3M'),
      card('Trần Thị B', 'LEADER'),
      card('Lê Văn C', 'BOD'),
    ]);

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 5).toString('latin1')).toBe('%PDF-');
    // pdfkit ghi cây trang: << /Type /Pages /Count N ... >>
    expect(buf.toString('latin1')).toMatch(/\/Type\s*\/Pages[\s\S]*?\/Count\s+3/);
  });

  it('1 người → PDF 1 trang, ra kết quả nhỏ hơn PDF 3 trang', async () => {
    const one = await buildService().buildBatchPdfBuffer([card('Một Người', 'MANAGER')]);
    const three = await buildService().buildBatchPdfBuffer([
      card('A', 'MANAGER'),
      card('B', 'MANAGER'),
      card('C', 'MANAGER'),
    ]);
    expect(one.toString('latin1')).toMatch(/\/Count\s+1/);
    expect(three.length).toBeGreaterThan(one.length);
  });
});
