# Quy trình đổi database (Prisma)

Khi **thêm / sửa bảng hoặc cột** trong `prisma/schema.prisma`, bắt buộc tạo migration rồi mới merge `main`.

## Các bước

```bash
# 1. Sửa prisma/schema.prisma

# 2. Tạo migration
npx prisma migrate dev --name add_ten_bang_hoac_cot

# 3. Commit cả schema.prisma + folder prisma/migrations/... vừa tạo
# 4. Merge vào main → CI tự apply lên DB production
```

## Lưu ý

- CI chỉ chạy file `prisma/migrations/<timestamp>_*/migration.sql`
- File `manual_*.sql` **không** được CI apply
- Đổi schema mà không tạo migration → PR **không merge**
