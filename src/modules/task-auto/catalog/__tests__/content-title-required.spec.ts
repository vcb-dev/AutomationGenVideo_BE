import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  CreateContentDto,
  CreateTeamContentDto,
  CreateEditorContentDto,
} from '../dto/catalog.dto';

// CreateContentDto: title bắt buộc. Team/Editor: bắt buộc khi tạo mới (không có source_content_id).
describe('DTO tạo content — bắt buộc nhập tiêu đề', () => {
  const errorsOn = async (dto: object, field: string) => {
    const errs = await validate(dto);
    return errs.some((e) => e.property === field);
  };

  describe('CreateContentDto (kho tổng)', () => {
    it('thiếu title → lỗi validate ở field title', async () => {
      const dto = plainToInstance(CreateContentDto, { brand_type: 'DO_DA' });
      expect(await errorsOn(dto, 'title')).toBe(true);
    });

    it('title rỗng "" → lỗi validate ở field title', async () => {
      const dto = plainToInstance(CreateContentDto, { brand_type: 'DO_DA', title: '' });
      expect(await errorsOn(dto, 'title')).toBe(true);
    });

    it('có title → không còn lỗi ở field title', async () => {
      const dto = plainToInstance(CreateContentDto, { brand_type: 'DO_DA', title: 'Kịch bản A' });
      expect(await errorsOn(dto, 'title')).toBe(false);
    });
  });

  describe.each([
    ['CreateTeamContentDto', CreateTeamContentDto],
    ['CreateEditorContentDto', CreateEditorContentDto],
  ] as const)('%s (có nguồn hoặc tạo mới)', (_name, Dto) => {
    it('tạo mới (không source_content_id) mà thiếu title → lỗi validate ở field title', async () => {
      const dto = plainToInstance(Dto, { brand_type: 'DO_DA' });
      expect(await errorsOn(dto, 'title')).toBe(true);
    });

    it('copy từ kho khác (có source_content_id) mà thiếu title → KHÔNG lỗi ở field title', async () => {
      const dto = plainToInstance(Dto, { brand_type: 'DO_DA', source_content_id: 'src-1' });
      expect(await errorsOn(dto, 'title')).toBe(false);
    });

    it('tạo mới kèm title → không lỗi ở field title', async () => {
      const dto = plainToInstance(Dto, { brand_type: 'DO_DA', title: 'Kịch bản A' });
      expect(await errorsOn(dto, 'title')).toBe(false);
    });
  });
});
