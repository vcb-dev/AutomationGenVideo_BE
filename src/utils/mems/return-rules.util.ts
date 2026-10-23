/**
 * Quy tắc kết luận khi nhận lại thiết bị (BR-42).
 *
 * Cố ý KHÔNG chạm Prisma, giống `availability.ts`: mọi trường hợp biên test được trong vài
 * mili giây, và tầng service chỉ còn việc ghi xuống DB.
 */

/** Thang tình trạng theo mức xấu dần. Thứ tự này là toàn bộ ý nghĩa của "tệ đi". */
const CONDITION_RANK = ['GOOD', 'USED', 'NEEDS_CHECK', 'IN_MAINTENANCE', 'BROKEN'];

const rank = (condition: string) => {
  const index = CONDITION_RANK.indexOf(condition);
  // Giá trị lạ coi như xấu nhất: thà bắt kiểm tra thừa còn hơn cho máy không rõ tình trạng về kệ.
  return index === -1 ? CONDITION_RANK.length : index;
};

export function conditionWorsened(before: string, after: string): boolean {
  return rank(after) > rank(before);
}

export interface ReturnStatusInput {
  conditionBefore: string;
  conditionAfter: string;
  missingAccessoryCount: number;
}

/**
 * Máy về thẳng kệ hay phải qua bàn kiểm tra.
 *
 * Thiếu phụ kiện cũng bắt kiểm tra dù thân máy nguyên vẹn: thiếu pin hay sạc thì chiếc máy đó
 * chưa cho mượn tiếp được, để nó ở Sẵn sàng là hứa với người sau một thứ không giao nổi.
 */
export function resolveReturnStatus(
  input: ReturnStatusInput,
): 'AVAILABLE' | 'POST_RETURN_CHECK' {
  if (conditionWorsened(input.conditionBefore, input.conditionAfter)) {
    return 'POST_RETURN_CHECK';
  }
  return input.missingAccessoryCount > 0 ? 'POST_RETURN_CHECK' : 'AVAILABLE';
}
