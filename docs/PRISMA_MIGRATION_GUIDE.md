# Quy trình đổi database (Prisma) — bắt buộc cho mọi thành viên

## Vì sao phải làm đúng

CI/CD production chạy:

```bash
npx prisma migrate deploy
```

Lệnh này **chỉ apply** các folder:

```text
prisma/migrations/<timestamp>_ten_goi_nho/migration.sql
```

| Loại file | CI có chạy? |
|-----------|-------------|
| `prisma/migrations/20260724..._add_xxx/migration.sql` | Có |
| `prisma/migrations/manual_*.sql` | **Không** |

Nếu chỉ sửa `schema.prisma` (hoặc chỉ thêm `manual_*.sql`) rồi merge `main`:

- CI vẫn có thể **xanh**
- DB production **không** có bảng/cột mới
- App runtime lỗi kiểu: `The table public.xxx does not exist`

Ví dụ đã xảy ra: model `TaskContentApproval` có trong schema + `manual_task_content_approvals.sql`, nhưng thiếu migration Prisma → thiếu bảng `task_content_approvals` trên prod.

---

## Quy trình mỗi lần thêm / sửa bảng hoặc cột

### 1. Sửa schema

Chỉnh `prisma/schema.prisma` (thêm model, thêm field, đổi index, …).

### 2. Tạo migration Prisma

```bash
cd AutomationGenVideo_BE
npx prisma migrate dev --name add_ten_bang_hoac_cot
```

Ví dụ tên gợi nhớ:

- `add_task_content_approvals`
- `add_user_phone`
- `alter_tasks_add_priority`

Prisma tự tạo folder timestamp + file `migration.sql`. **Không cần** tự nghĩ format ngày giờ phức tạp.

### 3. Commit đúng thứ cần có

Commit **cả hai**:

- `prisma/schema.prisma`
- folder `prisma/migrations/<timestamp>_.../` vừa tạo

### 4. Merge vào `main`

Push / mở PR → merge `main` → GitHub Actions:

1. Build & push Docker
2. `prisma migrate deploy` (tạo bảng/cột trên DB production)
3. Redeploy Railway

---

## Checklist trước khi merge PR

- [ ] Đã đổi `schema.prisma`?
- [ ] Đã chạy `npx prisma migrate dev --name ...`?
- [ ] PR có folder `prisma/migrations/.../migration.sql` mới?
- [ ] **Không** chỉ dựa vào file `manual_*.sql` để expect CI tạo bảng?

Thiếu migration mới → **không merge**.

---

## Không làm

- Không chỉ sửa `schema.prisma` rồi push `main`
- Không tạo `manual_*.sql` rồi kỳ vọng CI/CD apply
- Không dùng `prisma db push` trên production
- Không sửa tay migration đã merge lên `main` (trừ khi có quy trình hotfix riêng)

---

## Nếu `migrate dev` lỗi (shadow DB / lịch sử lệch)

Repo từng có migration history phân mảnh. Khi đó:

```bash
# Tạo SQL diff từ migrations hiện có → schema hiện tại
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/diff.sql
```

Sau đó tạo folder migration mới, copy nội dung SQL vào `migration.sql`, review kỹ, rồi:

```bash
npx prisma migrate deploy
```

(trên DB local/staging trước; production do CI làm sau khi merge `main`).

Hoặc hỏi lead trước khi tự apply lên production.

---

## Tóm tắt một câu

> **Đổi schema → `prisma migrate dev --name ...` → commit migration → merge `main` → CI tự deploy DB.**

File `manual_*.sql` chỉ để one-off / tham khảo, **không** thay migration Prisma.
