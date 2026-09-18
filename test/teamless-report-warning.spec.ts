import { LarkService } from '../src/modules/lark-sync/lark.service';

/**
 * Chức năng: nộp báo cáo khi tài khoản chưa thuộc team nào thì phải được cảnh báo ngay.
 *
 * Vì sao đáng một file riêng: mọi bảng điều khiển đều gom số THEO TEAM. Người không có team nộp
 * báo cáo vẫn được lưu đúng vào DB, nhưng không xuất hiện ở bất kỳ thẻ team hay màn hiệu suất
 * nào. Đã xác nhận trên production có tài khoản rơi vào trạng thái này. Không cảnh báo thì người
 * nộp tưởng hệ thống nuốt mất dữ liệu — và đó chính là lỗi vừa được báo.
 */
describe('Cảnh báo khi nộp báo cáo mà chưa thuộc team', () => {
  // Hàm thuần, không chạm DB — gọi thẳng qua prototype để khỏi phải dựng cả LarkService.
  const buildWarning = (team?: string | null): string | undefined =>
    (LarkService.prototype as any).buildTeamlessWarning.call({}, team);

  it('không có team thì trả về cảnh báo', () => {
    const w = buildWarning(null);

    expect(w).toBeDefined();
    expect(w).toContain('chưa thuộc team nào');
    // Phải nói rõ dữ liệu ĐÃ lưu, tránh người dùng nộp lại nhiều lần vì tưởng thất bại.
    expect(w).toContain('Đã lưu báo cáo');
  });

  it('chuỗi rỗng hoặc chỉ toàn khoảng trắng cũng tính là chưa có team', () => {
    expect(buildWarning('')).toBeDefined();
    expect(buildWarning('   ')).toBeDefined();
    expect(buildWarning(undefined)).toBeDefined();
  });

  it('có team thì KHÔNG cảnh báo — không làm phiền đa số người dùng', () => {
    expect(buildWarning('Team K1')).toBeUndefined();
    expect(buildWarning('  Team K1  ')).toBeUndefined();
    expect(buildWarning('Team SG, Team HN')).toBeUndefined();
  });
});
