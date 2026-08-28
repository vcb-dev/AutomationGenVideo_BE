import { MANUAL_ASSET_STATUSES, manualStatusBlockReason } from '../asset-status-rules';

/**
 * Đổi trạng thái máy BẰNG TAY được tới đâu.
 *
 * Luật gọn: sửa tay chỉ được SIẾT, không được NỚI. Siết nhầm thì bước kiểm tra gỡ lại được;
 * nới nhầm thì không bước nào phía sau bắt được.
 */

describe('MANUAL_ASSET_STATUSES', () => {
  it('đúng ba giá trị, không hơn', () => {
    expect(MANUAL_ASSET_STATUSES).toEqual(['PENDING_INSPECTION', 'BROKEN', 'LOST']);
  });
});

describe('manualStatusBlockReason — những trạng thái sửa tay được', () => {
  it('đưa máy về bàn kiểm tra thì được', () => {
    expect(manualStatusBlockReason('AVAILABLE', 'PENDING_INSPECTION')).toBeNull();
  });

  it('đánh dấu máy hỏng thì được', () => {
    expect(manualStatusBlockReason('AVAILABLE', 'BROKEN')).toBeNull();
  });

  it('đánh dấu máy mất thì được', () => {
    // Không nghiệp vụ nào sinh ra Mất — đây là lối duy nhất, bịt là không ghi nhận được.
    expect(manualStatusBlockReason('AVAILABLE', 'LOST')).toBeNull();
  });
});

describe('manualStatusBlockReason — những trạng thái phải qua cửa riêng', () => {
  it('không tự đặt Sẵn sàng, phải qua màn kiểm tra', () => {
    // Đặt tay là đi vòng qua BR-42: máy trả về bị trầy sẽ lên kệ mà chưa ai xem lại.
    expect(manualStatusBlockReason('POST_RETURN_CHECK', 'AVAILABLE')).toMatch(/kiểm tra/i);
  });

  it('không tự đặt Đang mượn, phải qua bàn giao', () => {
    // Khai máy đã giao mà không có biên bản thì lúc mất không ai chịu trách nhiệm.
    expect(manualStatusBlockReason('AVAILABLE', 'ON_LOAN')).toMatch(/bàn giao/i);
  });

  it('không tự đặt Bảo trì, phải qua màn kiểm tra', () => {
    // Chỗ nguy nhất: phép tính khả dụng đọc BẢNG LỆNH BẢO TRÌ chứ không đọc cột trạng thái.
    // Đặt tay thì máy nằm ở xưởng mà vẫn hiện rảnh trong mọi khoảng tương lai.
    expect(manualStatusBlockReason('AVAILABLE', 'UNDER_MAINTENANCE')).toMatch(/kiểm tra/i);
  });

  it('không tự đặt Kiểm tra sau trả, cái đó sinh từ luồng trả', () => {
    expect(manualStatusBlockReason('AVAILABLE', 'POST_RETURN_CHECK')).not.toBeNull();
  });

  it('không tự đặt Đã thanh lý, đã có nút xoá riêng', () => {
    expect(manualStatusBlockReason('AVAILABLE', 'DISPOSED')).toMatch(/xo[áa]/i);
  });

  it('giá trị lạ cũng bị chặn', () => {
    expect(manualStatusBlockReason('AVAILABLE', 'KHONG_CO_THAT')).not.toBeNull();
  });
});

describe('manualStatusBlockReason — máy đang ở ngoài', () => {
  it('máy đang mượn thì chỉ được đánh dấu Mất', () => {
    // Thứ duy nhất có thể xảy ra với chiếc máy không bao giờ quay về.
    expect(manualStatusBlockReason('ON_LOAN', 'LOST')).toBeNull();
  });

  it('máy đang mượn thì không đánh dấu hỏng từ xa được', () => {
    // Trầy, thiếu phụ kiện, hỏng — ghi lúc NHẬN TRẢ, vì đó là chỗ duy nhất sinh phiếu sự cố
    // và quy trách nhiệm cho người đứng tên phiếu.
    expect(manualStatusBlockReason('ON_LOAN', 'BROKEN')).toMatch(/nhận trả/i);
  });

  it('máy đang mượn thì không kéo về bàn kiểm tra được', () => {
    expect(manualStatusBlockReason('ON_LOAN', 'PENDING_INSPECTION')).not.toBeNull();
  });
});

describe('manualStatusBlockReason — không đổi gì', () => {
  it('đặt lại đúng trạng thái đang có thì không chặn', () => {
    // Form gửi kèm trạng thái cũ là chuyện thường; coi đó là vi phạm thì không ai sửa nổi
    // model hay serial của một chiếc máy đang mượn.
    expect(manualStatusBlockReason('ON_LOAN', 'ON_LOAN')).toBeNull();
    expect(manualStatusBlockReason('AVAILABLE', 'AVAILABLE')).toBeNull();
  });
});
