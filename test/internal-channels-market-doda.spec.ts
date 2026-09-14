import { Prisma } from '@prisma/client';
import {
  MARKETS,
  laThiTruongHopLe,
  marketFilter,
  DODA_CHANNEL_PATTERN,
  DODA_CAPTION_PATTERN,
} from '../src/modules/scraper-aggregate/content-filters';

describe('Internal Channels Market Classification - Đồ Da (doda)', () => {
  const COT_CHU = Prisma.sql`v.caption`;
  const COT_KENH = Prisma.sql`mp.name`;

  const chu = (s: Prisma.Sql) => s.strings.join('?');
  const value = (s: Prisma.Sql) => s.values;

  describe('MARKETS and laThiTruongHopLe', () => {
    it('chứa đủ 3 thị trường: vn, global và doda', () => {
      expect(MARKETS).toContain('vn');
      expect(MARKETS).toContain('global');
      expect(MARKETS).toContain('doda');
    });

    it('laThiTruongHopLe xác thực chính xác không phân biệt hoa thường', () => {
      expect(laThiTruongHopLe('doda')).toBe(true);
      expect(laThiTruongHopLe('DoDa')).toBe(true);
      expect(laThiTruongHopLe('DODA')).toBe(true);
      expect(laThiTruongHopLe('vn')).toBe(true);
      expect(laThiTruongHopLe('VN')).toBe(true);
      expect(laThiTruongHopLe('global')).toBe(true);
      expect(laThiTruongHopLe('GLOBAL')).toBe(true);
      expect(laThiTruongHopLe('unknown')).toBe(false);
      expect(laThiTruongHopLe('')).toBe(false);
    });
  });

  describe('marketFilter - doda', () => {
    it('trả về biểu thức SQL khớp DODA_CHANNEL_PATTERN và DODA_CAPTION_PATTERN khi có cotKenh', () => {
      const sql = marketFilter(COT_CHU, 'doda', COT_KENH);
      expect(sql).not.toBeNull();
      const sqlStr = chu(sql!);
      expect(sqlStr).toContain('COALESCE');
      expect(sqlStr).toContain('~*');
      expect(value(sql!)).toContain(DODA_CHANNEL_PATTERN);
      expect(value(sql!)).toContain(DODA_CAPTION_PATTERN);
    });

    it('trả về biểu thức SQL khớp DODA_CAPTION_PATTERN khi không truyền cotKenh', () => {
      const sql = marketFilter(COT_CHU, 'doda');
      expect(sql).not.toBeNull();
      const sqlStr = chu(sql!);
      expect(sqlStr).toContain('COALESCE');
      expect(sqlStr).toContain('~*');
      expect(value(sql!)).toContain(DODA_CAPTION_PATTERN);
      expect(value(sql!)).not.toContain(DODA_CHANNEL_PATTERN);
    });
  });

  describe('marketFilter - vn và global loại trừ Đồ Da', () => {
    it('nhánh vn bắt tiếng Việt và loại trừ Đồ Da (AND NOT isDoda)', () => {
      const sql = marketFilter(COT_CHU, 'vn', COT_KENH);
      expect(sql).not.toBeNull();
      const sqlStr = chu(sql!);
      expect(sqlStr).toContain('~*');
      expect(sqlStr).toContain('AND NOT');
      expect(value(sql!)).toContain(DODA_CHANNEL_PATTERN);
      expect(value(sql!)).toContain(DODA_CAPTION_PATTERN);
    });

    it('nhánh global bắt không dấu tiếng Việt và loại trừ Đồ Da (!~* và AND NOT isDoda)', () => {
      const sql = marketFilter(COT_CHU, 'global', COT_KENH);
      expect(sql).not.toBeNull();
      const sqlStr = chu(sql!);
      expect(sqlStr).toContain('!~*');
      expect(sqlStr).toContain('AND NOT');
      expect(value(sql!)).toContain(DODA_CHANNEL_PATTERN);
      expect(value(sql!)).toContain(DODA_CAPTION_PATTERN);
    });
  });

  describe('Regex Matching Verification on Real Channels & Content', () => {
    const channelRegex = new RegExp(DODA_CHANNEL_PATTERN, 'i');
    const captionRegex = new RegExp(DODA_CAPTION_PATTERN, 'i');

    it('khớp chính xác các kênh và page thuộc mảng Đồ Da', () => {
      const dodaChannels = [
        'Nhạn Nhạn - Thợ Da Thủ Công Vân Phong Các',
        'Nhạn Nhạn - Thợ Da Vân Phong Các',
        'Nhạn Nhạn - Xưởng Đồ Da',
        'Nhạn Nhạn - Vân Phong Các',
        'Nhạn Nhạn - Xưởng Da Vân Phong Các',
        'Chị Nhạn - Đồ Da Thủ Công',
        'Nhạn Nhạn - Thợ da thủ công',
        'Vân Phong Các',
        'Nyan Leather Craft ศิลปะเครื่องหนัง',
        'nyan.leathercraft',
        'nhannhan.xuongdathucong',
        'nhannhan.thodathucong',
        'nhannhan.dodavanphongcac',
        'chinhandoda',
      ];

      for (const ch of dodaChannels) {
        expect(channelRegex.test(ch)).toBe(true);
      }
    });

    it('KHÔNG khớp nhầm với các kênh vàng bạc / trang sức / kim hoàn', () => {
      const jewelryChannels = [
        'HuyK Chế Tác',
        'HuyK - Chế Tác Trang Sức VCB',
        'Huyk thợ kim hoàn trang sức',
        'HuyK Trang Sức Đá Quý',
        'HuyK Viễn Chí Bảo',
        'Hiền Muội - Viễn Chí Bảo',
        'Chung Học Mài Đá',
        'NamblingJewelry',
        'Quà Tặng Vàng Phong Thủy - Viễn Chí Bảo',
        'Nam Bạc Thái - Viễn Chí Bảo',
        'huyk_kimhoann',
        'huyknghenhantrangsuc',
      ];

      for (const ch of jewelryChannels) {
        expect(channelRegex.test(ch)).toBe(false);
      }
    });

    it('khớp chính xác các caption đồ da và không khớp nhầm bài trang sức', () => {
      expect(captionRegex.test('VŨ khí của người thợ da thủ công ( đục lỗ khâu)')).toBe(true);
      expect(captionRegex.test('Sản phẩm hoàn thiện tại xưởng da #doda #dathat')).toBe(true);
      expect(captionRegex.test('Tác phẩm mới của chị nhạn')).toBe(true);
      expect(captionRegex.test('Quy trình may ví da thủ công')).toBe(true);

      // Bài viết trang sức kim hoàn chứa từ "nhẫn", "đá" không bị khớp nhầm vào đồ da
      expect(captionRegex.test('Nhẫn kim tiền vàng tây #vangtay #huyk')).toBe(false);
      expect(captionRegex.test('Đá quý phong thủy cho người mệnh mộc #daquy')).toBe(false);
      expect(captionRegex.test('Dây chuyền bạc thái tinh xảo')).toBe(false);
    });
  });
});
