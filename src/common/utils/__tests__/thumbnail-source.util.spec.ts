import {
  normalizeThumbnailSourceUrl,
  isUnsupportedThumbnailFormat,
  supportedThumbnailSql,
} from '../thumbnail-source.util';

/**
 * Chuẩn hoá URL ảnh nguồn trước khi tải về đẩy lên kho ảnh (Google Drive).
 *
 * Ba CDN hỏng theo ba kiểu khác nhau, đều đã đo bằng request thật:
 *   - rednotecdn (XiaoHongShu): nguyên URL trả 498 {"code":1007}; bỏ query string thì ra
 *     JPEG 390KB. Tham số sign=/t= là thứ gây lỗi.
 *   - kwimgs (Kuaishou): trả 200 kèm content-type image/kvif — định dạng riêng của Kuaishou,
 *     kho ảnh lẫn trình duyệt đều không đọc được. Đổi đuôi sang .jpg thì
 *     CDN trả 400, tức là không có đường vòng.
 *   - tiktokcdn: không chặn, chỉ là chữ ký x-expires hết hạn. Không sửa được bằng URL.
 */

describe('normalizeThumbnailSourceUrl', () => {
  it('bỏ query string của rednotecdn — đó là thứ làm CDN trả 498', () => {
    const url =
      'https://sns-i11.rednotecdn.com/spectrum/1040g0k032358cit1?imageView2/2/w/1440/format/webp&sign=abc&t=6a8d52a3';

    expect(normalizeThumbnailSourceUrl(url)).toBe(
      'https://sns-i11.rednotecdn.com/spectrum/1040g0k032358cit1',
    );
  });

  it('KHÔNG đụng vào query của CDN khác — chữ ký ở đó là bắt buộc', () => {
    // Bỏ x-signature của tiktokcdn là ăn 403 ngay, dù URL còn hạn.
    const tiktok =
      'https://p16-common-sign.tiktokcdn.com/tos/abc~tplv.jpeg?x-expires=1787572800&x-signature=8XRf';

    expect(normalizeThumbnailSourceUrl(tiktok)).toBe(tiktok);
  });

  it('URL rỗng thì trả lại nguyên trạng, không ném lỗi', () => {
    expect(normalizeThumbnailSourceUrl('')).toBe('');
  });
});

describe('isUnsupportedThumbnailFormat', () => {
  it('nhận .kvif của Kuaishou', () => {
    const url =
      'http://ws2.a.kwimgs.com/upic/2025/03/13/19/BMjAy_480p_Bd98b.kvif?tag=1-1787641297&clientCacheKey=3xex_480p.kvif';

    expect(isUnsupportedThumbnailFormat(url)).toBe(true);
  });

  it('ảnh thường thì không bị loại', () => {
    expect(isUnsupportedThumbnailFormat('https://cdn.example.com/a.jpg')).toBe(false);
    expect(isUnsupportedThumbnailFormat('https://cdn.example.com/a.webp?x=1')).toBe(false);
  });

  it('rỗng/null không tính là định dạng hỏng', () => {
    expect(isUnsupportedThumbnailFormat('')).toBe(false);
    expect(isUnsupportedThumbnailFormat(null)).toBe(false);
  });
});

describe('supportedThumbnailSql', () => {
  it('sinh điều kiện loại .kvif ngay từ truy vấn', () => {
    // Loại ở tầng SQL chứ không phải sau khi tải: 4312/6177 thumbnail Kuaishou là .kvif,
    // để lọt vào batch là vừa đốt quota vừa ngập log lỗi mỗi phút.
    const sql = supportedThumbnailSql('"thumbnail_url"');

    expect(sql).toContain('NOT LIKE');
    expect(sql).toContain('.kvif');
  });
});
