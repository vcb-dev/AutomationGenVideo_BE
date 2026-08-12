export const COOKIE_ACCESS = 'vcbi_at';
export const COOKIE_REFRESH = 'vcbi_rt';
export const COOKIE_CSRF = 'vcbi_csrf';
export const CSRF_HEADER = 'x-csrf-token';

// Path hẹp: trình duyệt chỉ đính cookie refresh khi gọi đúng nhóm endpoint auth, nên nó không bị
// gửi kèm hàng trăm request thường — ít bề mặt lộ hơn hẳn.
//
// PHẢI khớp setGlobalPrefix('api') trong main.ts. Bản mẫu tham chiếu ghi '/api/v1/auth'; bê nguyên
// sang đây thì cookie không bao giờ được gửi lên và mọi lần refresh đều 401.
export const REFRESH_COOKIE_PATH = '/api/auth';
