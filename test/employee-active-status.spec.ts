import { isActiveEmployeeStatusValue } from '../src/modules/lark-sync/lark.service';

/**
 * Chức năng: xác định nhân sự còn đang làm việc hay đã nghỉ, để loại người đã nghỉ khỏi bảng hiệu
 * suất — nếu không, tỷ lệ nộp báo cáo của team bị kéo xuống bởi những người không còn đi làm.
 *
 * Vì sao đáng một file riêng: hàm này trước đây nằm lọt bên trong getUserActivityReports nên không
 * bài test nào chạm tới được, trong khi nó quyết định AI xuất hiện trên bảng. Nó cũng từng khớp
 * theo chuỗi con (`includes('off')`), nghĩa là một status hợp lệ như "Back Office" sẽ làm nhân sự
 * biến mất khỏi bảng mà không có thông báo gì.
 *
 * Số liệu đối chiếu trên DB thật (2026-09-18): 98 tài khoản `is_active`, trong đó 17 status `OFF`
 * → còn đúng 81 người hiện trên bảng.
 */
describe('Nhân sự còn đang làm việc hay đã nghỉ', () => {
    describe('Đã nghỉ / bị khoá — phải loại khỏi bảng', () => {
        it.each([
            ['OFF', 'giá trị thật đang có trên DB, 17 tài khoản'],
            ['off', 'thường'],
            ['Off', 'hoa thường lẫn lộn'],
            ['Nghỉ việc', 'có dấu tiếng Việt'],
            ['nghi viec', 'không dấu'],
            ['Đã nghỉ', 'chữ Đ hoa'],
            ['Khoá tài khoản', 'bị khoá'],
            ['khoa tai khoan', 'không dấu'],
            ['ON - OFF', 'có cả hai từ thì vẫn tính là nghỉ'],
        ])('%s (%s) → đã nghỉ', (status) => {
            expect(isActiveEmployeeStatusValue(status)).toBe(false);
        });
    });

    describe('Đang làm việc — phải giữ trên bảng', () => {
        it.each([
            ['on', 'giá trị thật đang có trên DB, 45 tài khoản'],
            ['ON', 'hoa'],
            ['Đang hoạt động', 'giá trị thật, 15 tài khoản'],
            ['Leader', 'giá trị thật, 2 tài khoản'],
        ])('%s (%s) → đang làm', (status) => {
            expect(isActiveEmployeeStatusValue(status)).toBe(true);
        });

        it('để TRỐNG thì coi là đang làm — DB thật có 18 tài khoản status null và họ đều đi làm', () => {
            expect(isActiveEmployeeStatusValue(null)).toBe(true);
            expect(isActiveEmployeeStatusValue(undefined)).toBe(true);
            expect(isActiveEmployeeStatusValue('')).toBe(true);
            expect(isActiveEmployeeStatusValue('   ')).toBe(true);
        });
    });

    describe('Bẫy khớp chuỗi con — lý do file test này tồn tại', () => {
        it.each([
            ['Back Office', 'chứa "off" nhưng là phòng ban, không phải nghỉ việc'],
            ['Officer', 'chức danh'],
            ['office', 'một từ, vẫn không phải "off"'],
            ['Nghiên cứu', 'chứa "nghi" trong "nghiên"'],
            ['Khoản mục', 'chứa "khoa" trong "khoản"'],
        ])('%s (%s) → vẫn là đang làm', (status) => {
            expect(isActiveEmployeeStatusValue(status)).toBe(true);
        });
    });
});
