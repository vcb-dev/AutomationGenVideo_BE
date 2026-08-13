import { PATH_METADATA } from '@nestjs/common/constants';
import { VideoStreamController } from '../video-stream.controller';

/**
 * Ghim đường dẫn route của VideoStreamController — đây là HỢP ĐỒNG với FE, không phải chi
 * tiết nội bộ muốn đổi lúc nào cũng được.
 *
 * Vì sao cần test riêng cho một chuỗi tưởng như vô hại: một lượt tìm–thay "trang" → "tokenRow"
 * nhằm đổi tên biến đã nuốt luôn `@Get('trang-thai')` thành `@Get('tokenRow-thai')`. Biên dịch
 * vẫn sạch, toàn bộ test cũ vẫn xanh — vì không test nào chạm tới chuỗi đường dẫn — nhưng
 * FE gọi `/scraper/stream/trang-thai` (watch/page.tsx) sẽ ăn 404 ngay khi lên production.
 *
 * Test này so đúng chuỗi thay vì gọi qua HTTP: rẻ, chạy trong mili giây, và hỏng đúng chỗ
 * cần hỏng — sai đường dẫn thì đỏ ngay tại đây chứ không phải đợi người dùng báo.
 */
describe('đường dẫn route của VideoStreamController', () => {
  it('tiền tố controller giữ nguyên "scraper/stream"', () => {
    expect(Reflect.getMetadata(PATH_METADATA, VideoStreamController)).toBe('scraper/stream');
  });

  it('đường kiểm tra tình trạng giữ nguyên "trang-thai" — FE gọi thẳng đường này', () => {
    expect(Reflect.getMetadata(PATH_METADATA, VideoStreamController.prototype.trangThai)).toBe('trang-thai');
  });

  it('đường phát video giữ nguyên ":platform/:videoId"', () => {
    expect(Reflect.getMetadata(PATH_METADATA, VideoStreamController.prototype.stream)).toBe(
      ':platform/:videoId',
    );
  });
});
