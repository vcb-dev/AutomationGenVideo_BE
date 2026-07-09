# Tính năng Điểm Danh Buổi Họp (Attendance)

## 1. Mục đích
Ghi nhận điểm danh thành viên team trước/trong buổi họp tuần, hiển thị thống kê Có mặt/Vắng mặt trong tab Thống kê. Phạm vi: chỉ 4 team Việt Nam K1-K4 (không áp dụng Global/nước ngoài - chưa validate cứng ở Backend, rủi ro thấp, chấp nhận được).

## 2. Schema

**MeetingSession** - 1 buổi họp của 1 team/1 tuần:
- Unique theo (team_id, period_id) - mỗi team chỉ có 1 session/tuần
- scheduled_at: giờ họp cụ thể (không suy ra từ period, để tính LATE chính xác)
- is_finalized, finalized_at, finalized_by_id: cơ chế chốt buổi họp

**AttendanceRecord** - điểm danh 1 người trong 1 session:
- Unique theo (session_id, user_id) - dùng upsert, không tạo trùng
- status: PRESENT | ABSENT | ON_LEAVE | LATE
- note: bắt buộc khi ON_LEAVE, không bắt buộc khi ABSENT
- marked_by_id: ai là người set giá trị cuối (tự điểm danh hay Manager sửa)

**MeetingSessionLog** - lịch sử mỗi lần finalize/reopen (ai, khi nào)

## 3. Phân quyền

| Hành động | Member | Manager/Leader | Admin |
|---|---|---|---|
| Tạo buổi họp | ❌ | ✅ chỉ team mình | ✅ mọi team |
| Tự điểm danh | ✅ chỉ chính mình | ✅ | ✅ |
| Sửa người khác / Bulk update | ❌ | ✅ chỉ team mình | ✅ |
| Chốt buổi họp (finalize) | ❌ | ✅ chỉ team mình | ✅ |
| Mở lại (reopen) | ❌ | ✅ CHỈ trong cùng ngày đã chốt (giờ VN) | ✅ luôn luôn |
| Xem lịch sử cả team (bảng ma trận) | ❌ | ✅ chỉ team mình | ✅ mọi team |
| Xem lịch sử cá nhân | ✅ chỉ chính mình | ✅ member team mình | ✅ mọi người |

## 4. Rule quan trọng cần nhớ

1. user_id của self check-in LUÔN lấy từ JWT (req.user.id), không nhận từ body - chặn điểm danh giùm người khác.
2. Member tự điểm danh phải thuộc đúng team của session đang điểm danh.
3. Field `team` của User lưu dạng chuỗi phân tách dấu phẩy (VD: "Team K1, MEDIA, Scale Data") - PHẢI parse bằng split(',') + trim(), KHÔNG dùng substring match (tránh "K1" khớp nhầm "K10" nếu sau này có team đó).
4. So sánh ngày để mở lại (reopen) dùng luxon + timezone Asia/Ho_Chi_Minh, KHÔNG dùng Date mặc định của JS (tránh lệch ngày do server chạy múi giờ khác).
5. Bulk update dùng transaction - 1 item lỗi thì rollback toàn bộ.
6. Gọi lại /finalize khi đã chốt sẵn phải báo lỗi rõ ràng, không âm thầm ghi đè finalized_at/finalized_by_id cũ.
7. Route /attendance/bulk phải khai báo TRƯỚC route /attendance/:userId trong controller (tránh bug route bị "nuốt" bởi tham số động).

## 5. Các bug đã gặp và bài học

1. Prisma Client generate với --no-engine (yêu cầu Prisma Accelerate) gây lỗi login - không liên quan điểm danh, do cấu hình cũ của dự án.
2. Guard so sánh sai kiểu dữ liệu (tên team dạng chuỗi vs UUID) → luôn chặn nhầm mọi người, không phân biệt role.
3. Route bulk bị route :userId "nuốt" do khai báo sai thứ tự.
4. useCallback/useEffect với dependency là hàm không bọc useRef → gây vòng lặp gọi API vô hạn khi đổi team lúc đang bị lỗi 403.
5. State chọn tuần bị dùng CHUNG giữa tab Báo cáo và khu vực Điểm danh → đổi tuần bên này ảnh hưởng ngầm bên kia. Đã tách state độc lập.

## 6. Việc còn treo (không gấp)
- Backend chưa validate cứng team phải thuộc K1-K4 (chấp nhận rủi ro thấp).
