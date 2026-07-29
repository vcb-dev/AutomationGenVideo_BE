/**
 * Giải link rút gọn của các nền tảng mạng xã hội về URL đầy đủ.
 *
 * Khi user share kênh từ app điện thoại, clipboard thường là link rút gọn
 * (vt.tiktok.com, v.douyin.com, xhslink.com, b23.tv...) — không chứa định danh
 * kênh nên mọi regex bóc ID ở controller đều fail. Hàm này follow redirect để
 * lấy URL thật trước khi bóc ID.
 *
 * Chỉ follow đúng các domain rút gọn đã biết (allowlist) — không follow URL bất
 * kỳ do user nhập, tránh biến BE thành công cụ SSRF quét mạng nội bộ.
 */
const SHORT_LINK_HOSTS = [
  'vt.tiktok.com',
  'vm.tiktok.com',
  'v.douyin.com',
  'xhslink.com',
  'youtu.be',
  'b23.tv',
  'fb.watch',
  'v.kuaishou.com',
];

export function isShortLink(raw: string): boolean {
  const lower = raw.toLowerCase();
  return SHORT_LINK_HOSTS.some((host) => lower.includes(host));
}

/**
 * Trả về URL đầy đủ sau khi follow redirect. Nếu input không phải link rút gọn
 * đã biết, hoặc resolve thất bại (mạng lỗi / link chết), trả lại nguyên input để
 * caller xử lý tiếp như cũ (báo lỗi rõ ràng ở tầng validate).
 */
export async function resolveShortLink(raw: string): Promise<string> {
  const input = raw.trim();
  if (!isShortLink(input)) return input;

  const url = /^https?:\/\//i.test(input) ? input : `https://${input}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      },
    });
    clearTimeout(timeout);
    return res.url || input;
  } catch {
    return input;
  }
}
