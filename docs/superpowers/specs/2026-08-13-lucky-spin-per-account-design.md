# Vòng quay may mắn — mỗi tài khoản một vòng quay riêng

Ngày: 2026-08-13
Trạng thái: đã được người dùng duyệt

## Vấn đề

Hiện tại toàn công ty dùng chung một vòng quay. Ai đăng nhập cũng thấy cùng một danh sách nhân
sự, cùng kho quà, cùng lịch sử trúng thưởng — người này nhập Excel đè lên dữ liệu người kia.

Yêu cầu mới: **tài khoản nào đăng nhập thì dùng vòng quay của tài khoản đó**. Tài khoản A nhập
danh sách của A; tài khoản B đăng nhập vào không thấy gì của A và ngược lại.

Yêu cầu này đảo lại quyết định ngày 2026-08-03 ("dữ liệu dùng chung toàn công ty"). Người dùng
đã xác nhận rõ khi được hỏi lại.

## Vì sao hiện tại đang dùng chung

Cả 7 bảng `spin_*` đều treo vào `workspace_id` → `spin_workspaces`. Bảng đó chỉ có đúng 2 dòng,
khai cứng trong `lucky-spin.constants.ts` (`seci`, `tridao`), và không có cột nào gắn với user.

Điểm mấu chốt: **mọi truy vấn đều đi qua đúng một hàm** — `resolveWorkspaceId(slug)`. Cách ly
theo tài khoản vì vậy chỉ cần sửa chỗ đó, không phải sửa 30 endpoint.

## Thiết kế

### 1. Schema — thêm chủ sở hữu cho workspace

```prisma
model SpinWorkspace {
  slug     String   // "seci" — không còn @unique một mình
  owner_id String   @db.Uuid
  ...
  @@unique([slug, owner_id])
}
```

Không đặt khoá ngoại sang `User`, theo đúng lối đã dùng cho `created_by_id` ở các bảng lịch sử
(chú thích tại chỗ: "không đặt FK để khỏi sửa model User").

Bảy bảng con **không đổi gì**. Chúng đã tham chiếu `workspace_id`, nên khi mỗi tài khoản có
workspace riêng thì dữ liệu tự động tách theo tài khoản.

### 2. Migration — dữ liệu thật đang có

Số liệu đo được trên DB production ngày 2026-08-13:

| Vòng quay | Thành viên | Team | Quà | Lượt quay | Lần trúng |
|---|---|---|---|---|---|
| `seci` | 0 | 5 | 0 | 46 | 11 |
| `tridao` | 37 | 8 | 0 | 72 | 0 |

Toàn bộ gán cho **Bùi Minh Hiền** (`minhhienvienchibao@gmail.com`,
`7724cb0f-1666-46e3-b885-23cf97f20bdf`) — người thao tác gần nhất và nhiều thứ hai trên dữ liệu
này. Người dùng đã chọn phương án "gán cho một tài khoản chỉ định".

Không xoá dòng nào. Gán nhầm chủ thì sau này một câu `UPDATE` là đổi được, không phải làm lại
migration.

Thứ tự trong file migration:

1. `ALTER TABLE spin_workspaces ADD COLUMN owner_id uuid` (cho phép NULL tạm thời)
2. `UPDATE spin_workspaces SET owner_id = '<id Bùi Minh Hiền>'` — lấp dữ liệu cũ
3. `ALTER COLUMN owner_id SET NOT NULL`
4. `DROP CONSTRAINT` unique cũ trên `slug`, thêm `UNIQUE (slug, owner_id)`

Bước 2 phải nằm giữa 1 và 3, nếu không `SET NOT NULL` sẽ đổ vì các dòng cũ còn NULL.

### 3. Service — điểm chốt chặn

```
resolveWorkspaceId(slug)          →  resolveWorkspaceId(slug, ownerId)
```

Upsert đổi từ `where: { slug }` sang `where: { slug_owner_id: { slug, owner_id } }`. Tài khoản
mới lần đầu mở trang sẽ tự có workspace rỗng của mình — giữ nguyên tinh thần "không cần seed"
của thiết kế cũ.

Chín chỗ gọi phải truyền thêm `ownerId`:

| Nơi gọi | Đã có actor chưa |
|---|---|
| `claimControl`, `releaseControl`, `assertControl` | có sẵn |
| `getState`, `listFullHistory` | **chưa** — phải nhận thêm tham số |
| `assertTeamInWorkspace`, `assertMemberInWorkspace`, `assertGiftInWorkspace` | truyền xuống từ hàm gọi |

Ba hàm `assert*InWorkspace` là chỗ chặn quan trọng nhất về bảo mật: chúng là thứ ngăn tài khoản
A sửa/xoá team của tài khoản B bằng cách đoán id. Bỏ sót một hàm ở đây là thủng cách ly.

`ownerId` để kiểu `string` bắt buộc, không cho `undefined`. Cả controller đứng sau
`JwtAuthGuard` nên `req.user.id` luôn có; nếu thiếu thì ném lỗi ngay chứ không được lặng lẽ rơi
về workspace dùng chung.

### 4. Controller

`getState` và `listFullHistory` thêm `@Request() req` rồi truyền `actorOf(req).id` xuống. Các
endpoint còn lại đã có sẵn actor.

`listWorkspaces` không đổi — nó chỉ trả danh sách tên tĩnh từ constants, không đụng DB.

### 5. Khoá điều khiển

Mỗi tài khoản một workspace riêng thì không còn ai tranh quyền với ai: khoá chỉ có thể do chính
chủ giữ, và `assertControl` tự cấp khoá cho người ghi đầu tiên. Nghĩa là cơ chế này trở thành vô
hại nhưng vô dụng.

**Giữ nguyên cột và code ở BE** (xoá đi tốn một migration nữa mà không được gì), chỉ **ẩn nút
"Tiếp quản" bên FE** vì nó không còn tình huống nào để dùng.

### 6. Ngoài phạm vi lần này

- **Chia sẻ vòng quay cho người khác xem.** Người dùng có nhắc tới, nhưng cần thêm bảng phân
  quyền người-được-mời; tách ra làm sau để lần này ra nhanh đúng thứ đang cần.
- **Cho phép tự tạo/đặt tên vòng quay.** Vẫn giữ đúng 2 vòng quay cố định như hiện tại, mỗi tài
  khoản có bản riêng của cả hai.
- **Danh sách `REDUCED_ODDS_NAMES`.** Vẫn áp chung theo tên cho mọi tài khoản, không đổi.

## Kiểm thử

Theo quy trình PR của repo: một chức năng một file test riêng.

`src/modules/lucky-spin/__tests__/per-account-isolation.spec.ts`

| Ca kiểm thử | Kỳ vọng |
|---|---|
| Tài khoản A và B cùng mở slug `seci` | Sinh ra hai `workspace_id` khác nhau |
| A tạo thành viên, B gọi `getState` | B không thấy thành viên của A |
| B sửa/xoá team bằng đúng id team của A | Ném `NotFoundException`, không đụng được dữ liệu của A |
| A bốc một lượt quay, B đọc state | B không thấy lượt quay đang chạy của A |
| Cùng một tài khoản mở lại lần hai | Trả về đúng workspace cũ, không tạo thêm dòng |

## Rủi ro

| Rủi ro | Cách chặn |
|---|---|
| Chạy `prisma db push` làm mất ~60 bảng | Chỉ viết migration `<timestamp>_*/migration.sql`, tuyệt đối không `db push` |
| Sót một chỗ gọi `resolveWorkspaceId` → thủng cách ly | Đổi chữ ký hàm thành bắt buộc 2 tham số, trình biên dịch tự bắt hết 9 chỗ |
| Người dùng cũ đăng nhập thấy vòng quay trắng, tưởng mất dữ liệu | Báo trước cho họ; dữ liệu vẫn nằm ở tài khoản Bùi Minh Hiền |
