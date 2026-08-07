<!--
TIÊU ĐỀ PR phải nói rõ TỪNG chức năng, không viết chung chung.

  Tốt:  feat(task-auto): dashboard leader gộp đúng nhiều team của cùng 1 leader
  Tốt:  fix(lucky-spin): quay lại không trúng người đã nhận quà
  Xấu:  update code / fix bug / cập nhật task-auto

Một PR nhiều chức năng thì liệt kê từng cái ở mục "Chức năng trong PR này" bên dưới,
và mỗi chức năng phải có FILE UNIT TEST RIÊNG — không gộp nhiều chức năng vào một file.
-->

## Jira

- Ticket: <!-- VCBI-123 -->
- Link:

> Input và output của từng chức năng cập nhật trên Jira, không chép vào đây.
> Ghi ở đây link tới ticket đã cập nhật xong.

## Chức năng trong PR này

Mỗi chức năng một dòng, kèm đúng file test của riêng nó.

| # | Chức năng | File unit test |
|---|---|---|
| 1 |  | `src/modules/.../__tests__/....spec.ts` |
| 2 |  |  |

## Trước khi bấm "Ready for review"

- [ ] Tiêu đề PR nêu rõ từng chức năng, không viết chung chung
- [ ] Mỗi chức năng có **một file unit test riêng** trong `__tests__/` — không gộp
- [ ] Đã chạy `npm test` tại máy và **đọc kết quả**, toàn bộ xanh
- [ ] Input/output của từng chức năng đã cập nhật trên Jira
- [ ] Không có `prisma db push` trong PR (đổi schema thì phải là migration)

## Đã kiểm chứng thế nào

<!--
Dán output thật, đừng viết "đã test ok".
Ví dụ: kết quả `npm test`, hoặc lệnh curl kèm response nhận được.
-->

```
```
