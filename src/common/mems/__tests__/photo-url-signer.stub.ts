import { MemsPhotoUrlSigner } from '../photo-url-signer.service';

/**
 * Bản thế thân của `MemsPhotoUrlSigner` cho test.
 *
 * Trả URL nguyên vẹn để mọi test đang so khớp đường dẫn ảnh không phải biết gì về token. Chữ ký
 * thật đã có file test riêng (`photo-url-token.spec.ts`) lo mọi ca biên, nên nhét nó vào đây chỉ
 * làm các test khác khó đọc mà không bắt thêm được lỗi nào.
 *
 * Không nằm trong `testRegex` (`*.spec.ts`) nên Jest không coi file này là một bộ test rỗng.
 */
export const photoUrlSignerStub = {
  sign: (url: string) => url,
  signAll: <T extends { url: string }>(photos: T[]) => photos,
  verify: () => true,
} as unknown as MemsPhotoUrlSigner;
