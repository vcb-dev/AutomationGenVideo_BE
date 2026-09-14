import {
  PHOTO_TOKEN_TTL_MS,
  createPhotoToken,
  verifyPhotoToken,
  withPhotoToken,
} from '../photo-url-token';

/**
 * Chức năng: chữ ký có hạn cho đường dẫn ảnh thiết bị.
 *
 * Vì sao đáng một file test riêng: route ảnh buộc phải `@Public` (thẻ `<img>` không gửi được
 * header Authorization), nên chữ ký này là thứ DUY NHẤT còn canh cửa. Nới một chút là ảnh serial
 * thiết bị của công ty ai có link cũng xem được; siết sai là hỏng toàn bộ ảnh trên mọi màn.
 */

const SECRET = 'bi-mat-dung-de-ky';
const FILE = 'CAM-001_1788486941422_tc1f62.jpg';
const NOW = 1_800_000_000_000;

describe('createPhotoToken / verifyPhotoToken', () => {
  it('token vừa ký thì mở được đúng file đó', () => {
    const token = createPhotoToken(FILE, SECRET, NOW);

    expect(verifyPhotoToken(FILE, token, SECRET, NOW)).toBe(true);
  });

  it('token của file này KHÔNG mở được file khác', () => {
    // Nếu không buộc tên file vào chữ ký thì một link hợp lệ trở thành chìa khoá cho cả kho ảnh.
    const token = createPhotoToken(FILE, SECRET, NOW);

    expect(verifyPhotoToken('CAM-002_1788486941422_aa11bb.jpg', token, SECRET, NOW)).toBe(false);
  });

  it('hết hạn thì không mở được nữa', () => {
    const token = createPhotoToken(FILE, SECRET, NOW);

    expect(verifyPhotoToken(FILE, token, SECRET, NOW + PHOTO_TOKEN_TTL_MS + 1)).toBe(false);
  });

  it('còn trong hạn thì vẫn mở được', () => {
    const token = createPhotoToken(FILE, SECRET, NOW);

    expect(verifyPhotoToken(FILE, token, SECRET, NOW + PHOTO_TOKEN_TTL_MS - 1000)).toBe(true);
  });

  it('đổi bí mật là mọi token cũ mất hiệu lực', () => {
    const token = createPhotoToken(FILE, SECRET, NOW);

    expect(verifyPhotoToken(FILE, token, 'bi-mat-khac', NOW)).toBe(false);
  });

  it('tự nới hạn trong token cũng không qua được', () => {
    // Hạn nằm trong chuỗi được ký, nên sửa nó là chữ ký hỏng theo.
    const token = createPhotoToken(FILE, SECRET, NOW);
    const chuKy = token.split('.')[1];
    const tokenBiSua = `${NOW + PHOTO_TOKEN_TTL_MS * 10}.${chuKy}`;

    expect(verifyPhotoToken(FILE, tokenBiSua, SECRET, NOW)).toBe(false);
  });

  it('token rỗng, thiếu hoặc dị dạng đều bị từ chối, không nổ', () => {
    for (const token of ['', undefined, null, 'khong-co-dau-cham', '.abc', 'abc.', 'x.y']) {
      expect(verifyPhotoToken(FILE, token as any, SECRET, NOW)).toBe(false);
    }
  });

  it('hạn không phải số thì từ chối', () => {
    expect(verifyPhotoToken(FILE, 'mai-mai.abcdef', SECRET, NOW)).toBe(false);
  });
});

describe('withPhotoToken', () => {
  it('gắn token vào đường dẫn tương đối của máy chủ này', () => {
    const signed = withPhotoToken(`/api/mems/photos/${FILE}`, SECRET, NOW);

    expect(signed).toContain(`/api/mems/photos/${FILE}?t=`);
    const token = signed.split('?t=')[1];
    expect(verifyPhotoToken(FILE, token, SECRET, NOW)).toBe(true);
  });

  it('URL Google Drive giữ nguyên, không ký', () => {
    // Ảnh trên Drive không đi qua route này; ký vào chỉ làm bẩn đường dẫn.
    const url = 'https://drive.google.com/uc?id=abc';

    expect(withPhotoToken(url, SECRET, NOW)).toBe(url);
  });

  it('đường dẫn đã có tham số thì nối bằng dấu &', () => {
    const signed = withPhotoToken(`/api/mems/photos/${FILE}?v=2`, SECRET, NOW);

    expect(signed).toContain('?v=2&t=');
  });

  it('chuỗi rỗng trả về nguyên vẹn, không dựng URL rác', () => {
    expect(withPhotoToken('', SECRET, NOW)).toBe('');
  });
});
