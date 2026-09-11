import {
  CROP_SCALE_MAX,
  CROP_SCALE_MIN,
  clampCropOffset,
  clampCropScale,
  computeCropLayout,
  maxCropOffset,
} from '../id-photo-crop.util';

/**
 * Chức năng: toán học "Điều chỉnh vị trí ảnh trong khung tròn" — dùng chung cho preview FE
 * (crop-math.ts, bản sao 1-1) và PDF thật BE (drawIdCardPage). Chỉ test PHẦN TÍNH TOÁN thuần,
 * không test kéo thả UI (theo đúng yêu cầu).
 */
describe('id-photo-crop.util', () => {
  describe('clampCropScale', () => {
    it('giữ nguyên giá trị trong khoảng [1,3]', () => {
      expect(clampCropScale(1.5)).toBe(1.5);
    });
    it('kẹp về MIN/MAX khi vượt biên', () => {
      expect(clampCropScale(0.2)).toBe(CROP_SCALE_MIN);
      expect(clampCropScale(10)).toBe(CROP_SCALE_MAX);
    });
    it('null/undefined/NaN → mặc định 1 (đúng hành vi ảnh cũ chưa có crop)', () => {
      expect(clampCropScale(null)).toBe(1);
      expect(clampCropScale(undefined)).toBe(1);
      expect(clampCropScale(NaN)).toBe(1);
    });
  });

  describe('computeCropLayout — mặc định (scale=1, offset=0) PHẢI khớp hệt pdfkit cover cũ', () => {
    it('ảnh vuông: phủ đúng khít khung, không dư viền', () => {
      const l = computeCropLayout(1000, 1000, null);
      expect(l).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    });

    it('ảnh ngang (rộng hơn cao): cao=1 (khít), rộng > 1 (tràn 2 bên, bị crop), căn giữa', () => {
      const l = computeCropLayout(2000, 1000, undefined); // r = 2
      expect(l.height).toBeCloseTo(1, 10);
      expect(l.width).toBeCloseTo(2, 10);
      // căn giữa: x = 0.5 - width/2
      expect(l.x).toBeCloseTo(0.5 - 1, 10);
      expect(l.y).toBeCloseTo(0, 10);
    });

    it('ảnh dọc (cao hơn rộng): rộng=1 (khít), cao > 1 (tràn trên/dưới), căn giữa', () => {
      const l = computeCropLayout(1000, 2000, {}); // r = 0.5
      expect(l.width).toBeCloseTo(1, 10);
      expect(l.height).toBeCloseTo(2, 10);
      expect(l.x).toBeCloseTo(0, 10);
      expect(l.y).toBeCloseTo(0.5 - 1, 10);
    });
  });

  describe('maxCropOffset / clampCropOffset — yêu cầu (5): không cho hở viền trắng', () => {
    it('ảnh vuông tại scale=1: KHÔNG kéo được (đã khít tuyệt đối, mọi lệch tâm đều hở viền)', () => {
      const max = maxCropOffset(1000, 1000, 1);
      expect(max).toEqual({ x: 0, y: 0 });
      const c = clampCropOffset(1000, 1000, 1, 0.3, -0.3);
      expect(c).toEqual({ offsetX: 0, offsetY: 0 });
    });

    it('ảnh ngang tại scale=1: kéo được dọc theo TRỤC TRÀN (X), không kéo được trục khít (Y)', () => {
      const max = maxCropOffset(2000, 1000, 1); // width0=2 → maxX=(2-1)/2=0.5; height0=1 → maxY=0
      expect(max.x).toBeCloseTo(0.5, 10);
      expect(max.y).toBe(0);
    });

    it('zoom lên thì biên độ kéo tăng theo', () => {
      const max1 = maxCropOffset(1000, 1000, 1);
      const max2 = maxCropOffset(1000, 1000, 2); // width=height=2 → max=(2-1)/2=0.5
      expect(max1).toEqual({ x: 0, y: 0 });
      expect(max2).toEqual({ x: 0.5, y: 0.5 });
    });

    it('offset vượt biên bị kẹp về đúng biên (không được vượt quá, giữ đúng dấu)', () => {
      const c = clampCropOffset(1000, 1000, 2, 5, -5);
      expect(c).toEqual({ offsetX: 0.5, offsetY: -0.5 });
    });

    it('offset NaN/không hợp lệ → coi như 0, không NaN lan truyền', () => {
      const c = clampCropOffset(1000, 1000, 2, NaN, undefined);
      expect(c).toEqual({ offsetX: 0, offsetY: 0 });
    });

    it('ảnh 0x0 / âm (dữ liệu hỏng) không NaN/Infinity — coi như ảnh vuông an toàn', () => {
      const l = computeCropLayout(0, 0, { offsetX: 10, offsetY: 10, scale: 5 });
      expect(Number.isFinite(l.x)).toBe(true);
      expect(Number.isFinite(l.y)).toBe(true);
      expect(Number.isFinite(l.width)).toBe(true);
      expect(Number.isFinite(l.height)).toBe(true);
    });
  });

  describe('computeCropLayout — luôn phủ kín khung [0,1]x[0,1] dù transform thế nào (quét ngẫu nhiên)', () => {
    it('mọi tổ hợp offset/scale hợp lệ đều cho x<=0<=1<=x+width và y<=0<=1<=y+height', () => {
      const sizes: Array<[number, number]> = [
        [1000, 1000],
        [1600, 900],
        [900, 1600],
        [3000, 400],
        [400, 3000],
      ];
      for (const [w, h] of sizes) {
        for (const scale of [1, 1.3, 2, 2.7, 3]) {
          for (const offsetX of [-5, -0.7, 0, 0.7, 5]) {
            for (const offsetY of [-5, -0.7, 0, 0.7, 5]) {
              const l = computeCropLayout(w, h, { offsetX, offsetY, scale });
              expect(l.x).toBeLessThanOrEqual(1e-9);
              expect(l.y).toBeLessThanOrEqual(1e-9);
              expect(l.x + l.width).toBeGreaterThanOrEqual(1 - 1e-9);
              expect(l.y + l.height).toBeGreaterThanOrEqual(1 - 1e-9);
            }
          }
        }
      }
    });
  });

  describe('reset "Đặt lại vị trí gốc"', () => {
    it('transform mặc định tái lập ĐÚNG layout ban đầu (idempotent)', () => {
      const a = computeCropLayout(1600, 900, undefined);
      const b = computeCropLayout(1600, 900, { offsetX: 0, offsetY: 0, scale: 1 });
      expect(a).toEqual(b);
    });
  });
});
