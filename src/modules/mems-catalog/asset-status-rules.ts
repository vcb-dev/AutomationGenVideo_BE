/**
 * Đổi trạng thái máy BẰNG TAY được tới đâu.
 *
 * Cố ý KHÔNG chạm Prisma, giống `availability.ts` và `return-rules.ts` bên mems-borrow.
 *
 * Luật gọn: sửa tay chỉ được SIẾT, không được NỚI. Siết nhầm — kéo một chiếc máy tốt về bàn
 * kiểm tra — thì bước kiểm tra gỡ lại được. Nới nhầm thì không bước nào phía sau bắt được, vì
 * mọi cửa canh của MEMS đều nằm ở lối vào chứ không rà lại sau.
 *
 * Vì sao bốn trạng thái kia không cho đặt tay:
 *   - `AVAILABLE`         đi vòng qua BR-42, máy trả về bị trầy sẽ lên kệ mà chưa ai xem lại
 *   - `ON_LOAN`           khai máy đã giao mà không có biên bản, lúc mất không ai chịu trách nhiệm
 *   - `UNDER_MAINTENANCE` phép tính khả dụng đọc BẢNG lệnh bảo trì chứ không đọc cột trạng thái;
 *                         đặt tay thì máy nằm ở xưởng mà vẫn hiện rảnh trong mọi khoảng tương lai
 *   - `POST_RETURN_CHECK` nghĩa của nó là "vừa trả về", đặt cho máy không vừa trả là nói sai
 *   - `DISPOSED`          đã có nút Xoá, vào bằng hai cửa thì một cửa sẽ quên mất phần kiểm tra
 */

/** Ba trạng thái người dùng đặt tay được. Cả ba đều làm máy KÉM khả dụng đi. */
export const MANUAL_ASSET_STATUSES = ['PENDING_INSPECTION', 'BROKEN', 'LOST'] as const;

/** Cửa đúng của từng trạng thái không cho đặt tay — câu này hiện thẳng cho người dùng. */
const PROPER_DOOR: Record<string, string> = {
  AVAILABLE: 'Máy chỉ trở lại Sẵn sàng qua màn Kiểm tra.',
  ON_LOAN: 'Máy chỉ chuyển sang Đang mượn qua màn Bàn giao.',
  UNDER_MAINTENANCE:
    'Đưa máy về Chờ kiểm tra rồi kết luận Bảo trì ở màn Kiểm tra — đó là chỗ duy nhất sinh kèm lệnh bảo trì, thiếu nó thì máy nằm ở xưởng mà vẫn hiện là rảnh.',
  POST_RETURN_CHECK: 'Kiểm tra sau trả chỉ sinh ra từ luồng nhận trả thiết bị.',
  DISPOSED: 'Dùng nút Xoá thiết bị để thanh lý.',
};

/**
 * Lý do KHÔNG cho đổi sang trạng thái này. Trả null nghĩa là được phép.
 *
 * Máy đang ở ngoài thì chỉ đánh dấu Mất được — thứ duy nhất có thể xảy ra với chiếc máy không
 * bao giờ quay về. Trầy, thiếu phụ kiện, hỏng đều ghi lúc nhận trả, vì đó là chỗ duy nhất sinh
 * phiếu sự cố và quy trách nhiệm cho người đứng tên phiếu.
 */
export function manualStatusBlockReason(
  currentStatus: string,
  nextStatus: string,
): string | null {
  // Form gửi kèm trạng thái cũ là chuyện thường. Coi đó là vi phạm thì không ai sửa nổi model
  // hay serial của một chiếc máy đang mượn.
  if (nextStatus === currentStatus) return null;

  if (currentStatus === 'ON_LOAN' && nextStatus !== 'LOST') {
    return 'Máy đang được mượn. Ghi nhận tình trạng lúc nhận trả — chỉ đánh dấu Mất được từ đây.';
  }

  if (!(MANUAL_ASSET_STATUSES as readonly string[]).includes(nextStatus)) {
    return (
      PROPER_DOOR[nextStatus] ?? `Không đặt tay trạng thái ${nextStatus} được.`
    );
  }

  return null;
}
