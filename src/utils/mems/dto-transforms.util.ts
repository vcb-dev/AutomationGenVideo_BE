import { Transform } from 'class-transformer';

/** Ô lọc để trống gửi chuỗi rỗng — coi như không gửi, đừng ném 400. */
export const EmptyStringToUndefined = () =>
  Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value));

/** Ô select rỗng gửi chuỗi rỗng — đổi về null để service phân biệt "xoá giá trị" với "không gửi". */
export const EmptyStringToNull = () =>
  Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? null : value));
